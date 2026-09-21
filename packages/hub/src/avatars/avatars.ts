import { parseAddress, type MemberView } from "@tandryio/protocol";

/**
 * Account pictures in R2. The account row keeps the URL, not the bytes, so
 * `user.image` holds either one of ours or the one an identity provider gave
 * us; both are just a URL to whoever renders them.
 */
export const AVATAR_PATH = "/api/avatars/";
export const MAX_AVATAR_BYTES = 128 * 1024;

/** The key is random, so an object may be cached forever and never enumerated. */
const KEY = /^[0-9a-f]{32}$/;
/** An identity provider's picture arrives at whatever size it chose. */
const MAX_ADOPTED_BYTES = 512 * 1024;
const PROVIDER_TIMEOUT_MS = 5_000;
const IMMUTABLE = "public, max-age=31536000, immutable";
/** D1 allows 100 bound parameters, so a larger room is asked about in batches. */
const MAX_HANDLES = 100;
/** What `MemberView.avatar` admits; a longer value would fail the whole result. */
const MAX_AVATAR_URL = 512;

/**
 * What the bytes are, never what the upload claimed. Only raster formats are
 * accepted: an SVG served from our own origin would be a script.
 */
export function imageType(bytes: Uint8Array): string | null {
  const ascii = (offset: number, text: string) =>
    bytes.length >= offset + text.length &&
    [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  if (
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, i) => bytes[i] === byte,
    )
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (ascii(0, "GIF8")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

/**
 * Where pictures are publicly served, when that is somewhere other than this
 * Worker's own path. Its own route stays either way, so a row written before a
 * domain existed keeps resolving. An unusable value falls back to that route
 * rather than writing a URL nobody can open.
 */
export function avatarBase(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    return undefined;
  return url.origin + url.pathname.replace(/\/+$/, "");
}

function avatarUrl(base: string | undefined, key: string): string {
  return base ? `${base}/${key}` : AVATAR_PATH + key;
}

/** The key inside an image value this Hub stored, or null for anything else. */
function ownKey(
  image: string | null | undefined,
  base: string | undefined,
): string | null {
  if (!image) return null;
  for (const prefix of base ? [AVATAR_PATH, `${base}/`] : [AVATAR_PATH]) {
    if (!image.startsWith(prefix)) continue;
    const key = image.slice(prefix.length);
    if (KEY.test(key)) return key;
  }
  return null;
}

function newKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Store the picture and point the account at it. The object is written before
 * the row, so a failure between the two leaves an orphan and never a path that
 * resolves to nothing.
 */
export async function putAvatar(
  bucket: R2Bucket,
  db: D1Database,
  accountId: string,
  bytes: Uint8Array,
  contentType: string,
  now: number,
  base?: string,
): Promise<string> {
  const key = newKey();
  await bucket.put(key, bytes, {
    httpMetadata: { contentType, cacheControl: IMMUTABLE },
  });
  const previous = await db
    .prepare("SELECT image FROM user WHERE id=?")
    .bind(accountId)
    .first<{ image: string | null }>();
  const image = avatarUrl(base, key);
  await db
    .prepare("UPDATE user SET image=?, updatedAt=? WHERE id=?")
    .bind(image, now, accountId)
    .run();
  const stale = ownKey(previous?.image, base);
  // The new object is already live; a failed delete only leaves an orphan.
  if (stale && stale !== key) await bucket.delete(stale).catch(() => {});
  return image;
}

/** GET /api/avatars/:key. Public, immutable, and never executed by a browser. */
export async function avatarResponse(
  bucket: R2Bucket,
  key: string,
  request: Request,
): Promise<Response> {
  if (!KEY.test(key)) return new Response("Not found", { status: 404 });
  const object = await bucket.get(key, { onlyIf: request.headers });
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Cache-Control": IMMUTABLE,
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    // Bytes an account uploaded, served from the website's own origin.
    "Content-Security-Policy": "default-src 'none'; sandbox",
    ETag: object.httpEtag,
  });
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  headers.set(
    "Content-Type",
    object.httpMetadata?.contentType ?? "application/octet-stream",
  );
  return new Response(object.body, { headers });
}

/**
 * The picture of every account that owns one of these members. Observers only:
 * an agent reads names, not faces, so member lists on the wire to a
 * conversation stay exactly as the room wrote them.
 */
export async function withAvatars(
  db: D1Database,
  members: MemberView[],
): Promise<MemberView[]> {
  const handles = [
    ...new Set(members.map((member) => parseAddress(member.address).handle)),
  ];
  const images = new Map<string, string>();
  for (let i = 0; i < handles.length; i += MAX_HANDLES) {
    const batch = handles.slice(i, i + MAX_HANDLES);
    const rows = await db
      .prepare(
        `SELECT handle, image FROM user WHERE image IS NOT NULL AND handle IN (${batch.map(() => "?").join(",")})`,
      )
      .bind(...batch)
      .all<{ handle: string; image: string }>();
    // One provider URL past the limit would otherwise fail the whole result.
    for (const row of rows.results)
      if (row.image.length <= MAX_AVATAR_URL) images.set(row.handle, row.image);
  }
  return members.map((member) => {
    const avatar = images.get(parseAddress(member.address).handle);
    return avatar ? { ...member, avatar } : member;
  });
}

/** A picture held by someone else: an identity provider's, not one of ours. */
export function isForeign(
  image: string | null | undefined,
  base: string | undefined,
): image is string {
  return !!image && /^https?:\/\//.test(image) && !ownKey(image, base);
}

/**
 * Copy an identity provider's picture into our own storage. Left alone, every
 * member of every room the account joins would fetch it from the provider,
 * which tells the provider who is looking at whom.
 *
 * Best effort: on any failure the account keeps the provider's URL, which
 * still renders. Adoption is not retried, so a provider that was unreachable
 * at sign-up leaves that account showing the provider's picture.
 */
export async function adoptForeignAvatar(
  bucket: R2Bucket,
  db: D1Database,
  accountId: string,
  url: string,
  now: number,
  base?: string,
): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ADOPTED_BYTES) return;
  // Also what we serve it as: the provider's own header is worth no more here
  // than the bytes themselves, and R2 needs a content type either way.
  const contentType = imageType(bytes);
  if (!contentType) return;

  const key = newKey();
  await bucket.put(key, bytes, {
    httpMetadata: { contentType, cacheControl: IMMUTABLE },
  });
  // Only while the account still points at the URL we fetched: a picture the
  // owner uploaded in the meantime is the newer answer and wins.
  const written = await db
    .prepare("UPDATE user SET image=?, updatedAt=? WHERE id=? AND image=?")
    .bind(avatarUrl(base, key), now, accountId, url)
    .run();
  if (!written.meta.changes) await bucket.delete(key).catch(() => {});
}
