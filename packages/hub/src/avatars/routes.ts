import type { Context } from "hono";
import { originAllowed } from "../bindings/http";
import { principal } from "../auth/principal";
import { allowAvatarUpload } from "../auth/rate-limit";
import type { Env } from "../env";
import type { HubApp } from "../hub";
import {
  AVATAR_ROUTE,
  avatarResponse,
  imageType,
  MAX_AVATAR_BYTES,
  publicBase,
  putAvatar,
} from "./avatars";

type AvatarContext = Context<{ Bindings: Env }>;

/** POST /api/avatar: the raw picture, already squared and shrunk by the browser. */
async function upload(c: AvatarContext): Promise<Response> {
  if (!originAllowed(c.env, c.req.raw))
    return c.json({ error: "Origin not allowed" }, 403);
  const bucket = c.env.PUBLIC_BUCKET;
  if (!bucket)
    return c.json(
      {
        error: "This Hub stores no pictures",
        code: "AVATAR_STORAGE_UNCONFIGURED",
      },
      503,
    );
  const who = await principal(c.env, c.req.raw);
  if (!who)
    return c.json(
      { error: "Sign in to Tandry first", code: "UNAUTHORIZED" },
      401,
    );
  if (!(await allowAvatarUpload(c.env.AUTH_DB, who.accountId)))
    return c.json({ error: "Too many attempts", code: "RATE_LIMITED" }, 429);

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_AVATAR_BYTES)
    return c.json(
      { error: "The picture is too large", code: "AVATAR_TOO_LARGE" },
      413,
    );
  const contentType = imageType(bytes);
  if (!contentType)
    return c.json(
      {
        error: "Choose a PNG, JPEG, GIF or WebP image",
        code: "AVATAR_INVALID",
      },
      400,
    );

  const image = await putAvatar(
    bucket,
    c.env.AUTH_DB,
    who.accountId,
    bytes,
    contentType,
    Date.now(),
    publicBase(c.env.PUBLIC_BASE_URL),
  );
  c.header("Cache-Control", "no-store");
  return c.json({ image });
}

/**
 * Account pictures: one route to store them, one to serve them. Reading needs
 * no credential — an avatar is shown to everyone in a room — so the key alone
 * is the capability, and it is random.
 */
export function avatarRoutes(app: HubApp) {
  app.post(AVATAR_ROUTE, upload);
  app.get(`${AVATAR_ROUTE}/:id`, (c) =>
    c.env.PUBLIC_BUCKET
      ? avatarResponse(c.env.PUBLIC_BUCKET, c.req.param("id"), c.req.raw)
      : c.notFound(),
  );
}
