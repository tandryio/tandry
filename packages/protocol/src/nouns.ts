import { z } from "zod";

// ---- identifiers ---------------------------------------------------------

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/** Time-ordered identifier: 10 characters of milliseconds, 16 of randomness. */
export function newId<P extends "r" | "m" | "mb" | "c">(prefix: P, now = Date.now()): `${P}_${string}` {
  let time = "";
  for (let i = 0, t = now; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  const random = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => CROCKFORD[byte % 32]).join("");
  return `${prefix}_${time}${random}`;
}

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-z]{8,40}$`));

export const AccountId = z.string().min(1).max(128);
export type AccountId = z.infer<typeof AccountId>;
export const RoomId = id("r");
export type RoomId = z.infer<typeof RoomId>;
export const MessageId = id("m");
export type MessageId = z.infer<typeof MessageId>;
export const MemberId = id("mb");
export type MemberId = z.infer<typeof MemberId>;

/** What a conversation presents to join. Compared after normalizeCode. */
export const RoomCode = z.string().trim().min(4).max(32);
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// ---- addresses -----------------------------------------------------------

export const Handle = z.string().regex(/^[a-z][a-z0-9_]{2,23}$/);
export type Handle = z.infer<typeof Handle>;

/**
 * Lowercase letters, digits and inner hyphens. The narrow character set is
 * what lets names appear unescaped in envelope attributes.
 */
export const MemberName = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/);
export type MemberName = z.infer<typeof MemberName>;

/** `<account-handle>/<member-name>`: the only address. Unique within a room. */
export const MemberAddress = z.string().regex(/^[a-z][a-z0-9_]{2,23}\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/);
export type MemberAddress = z.infer<typeof MemberAddress>;

export const ROOM_ADDRESS = "@room";

export function formatAddress(handle: Handle, name: MemberName): MemberAddress {
  return `${handle}/${name}`;
}

export function parseAddress(address: MemberAddress): { handle: Handle; name: MemberName } {
  const slash = address.indexOf("/");
  return { handle: address.slice(0, slash), name: address.slice(slash + 1) };
}

/** Turns free text proposed by an agent into a valid member name, or null. */
export function toMemberName(raw: string): MemberName | null {
  const name = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return name || null;
}

// ---- hosts ---------------------------------------------------------------

export const HostKind = z.enum(["claude", "codex", "grok", "kimi", "pi", "opencode", "dsh", "claude-web", "chatgpt-web", "web"]);
export type HostKind = z.infer<typeof HostKind>;

export const Tier = z.enum(["push", "pull"]);
export type Tier = z.infer<typeof Tier>;

const PULL_HOSTS: ReadonlySet<HostKind> = new Set(["claude-web", "chatgpt-web", "web"]);

/** The tier is a property of the host kind, never reported by a client. */
export function tierOf(host: HostKind): Tier {
  return PULL_HOSTS.has(host) ? "pull" : "push";
}

const HOST_LABELS: Record<HostKind, string> = {
  claude: "Claude Code", codex: "Codex", grok: "Grok Build", kimi: "Kimi Code", pi: "pi", opencode: "opencode", dsh: "dsh",
  "claude-web": "Claude web", "chatgpt-web": "ChatGPT web", web: "web chat",
};
export function hostLabel(host: HostKind): string {
  return HOST_LABELS[host];
}

// ---- conversations -------------------------------------------------------

/** The host's own identifier for a transcript. Visible ASCII so it can travel in a header. */
export const HostConversationId = z.string().regex(/^[\x21-\x7e]{1,200}$/);
export type HostConversationId = z.infer<typeof HostConversationId>;

/** Identifies the calling conversation. Travels in headers, never in operation input. */
export const ConversationKey = z.object({ host: HostKind, hostConversationId: HostConversationId });
export type ConversationKey = z.infer<typeof ConversationKey>;

/** Read from the environment by the bridge; attested, never supplied by the agent. */
export const Workspace = z.object({ repo: z.string().max(200), branch: z.string().max(200) });
export type Workspace = z.infer<typeof Workspace>;

export type ConversationRef = ConversationKey & { workspace: Workspace };

// ---- presence ------------------------------------------------------------

export const MemberState = z.enum(["online", "offline"]);
export type MemberState = z.infer<typeof MemberState>;

/** What a sender can know about a recipient's ability to receive right now. */
export const Presence = z.object({
  state: MemberState,
  tier: Tier,
  /** Only meaningful for an online push member. */
  wakeable: z.boolean(),
  /** Reported by a connected push host; absent for pull hosts. */
  busy: z.boolean().optional(),
  lastActiveAt: z.number(),
});
export type Presence = z.infer<typeof Presence>;

// ---- views ---------------------------------------------------------------

export const Visibility = z.enum(["room", "dm"]);
export type Visibility = z.infer<typeof Visibility>;

export const MessageKind = z.enum(["text", "intro"]);
export type MessageKind = z.infer<typeof MessageKind>;

/** Routing hints only. The Hub never interprets the body. */
export const Meta = z.record(z.string().max(64), z.string().max(256)).refine((meta) => Object.keys(meta).length <= 8, "At most 8 entries");
export type Meta = z.infer<typeof Meta>;

/** A message as any reader sees it. Every header is visible to every reader. */
export const MessageView = z.object({
  id: MessageId,
  seq: z.number().int().positive(),
  from: MemberAddress,
  fromHost: HostKind,
  visibility: Visibility,
  /** The recipients fixed at send time. */
  to: z.array(MemberAddress),
  /** True when the sender wrote `@room`; `to` then holds the members at that moment. */
  toRoom: z.boolean(),
  replyTo: MessageId.optional(),
  kind: MessageKind,
  body: z.string(),
  meta: Meta.optional(),
  createdAt: z.number(),
  /** Content removed by its owner; headers remain until retention expiry. */
  deletedAt: z.number().optional(),
});
export type MessageView = z.infer<typeof MessageView>;

export const HistoryMessage = MessageView.extend({
  /** Observer-only: the sender belongs to this account. */
  owned: z.boolean().optional(),
  recipients: z.array(z.object({
    address: MemberAddress,
    state: z.enum(["unread", "read", "replied", "left"]),
  })).optional(),
});
export type HistoryMessage = z.infer<typeof HistoryMessage>;

export const MemberView = Presence.extend({
  address: MemberAddress,
  host: HostKind,
  workspace: Workspace,
  intro: z.string(),
  joinedAt: z.number(),
  /** Messages the caller's member sent that this member has not read. Zero for observers. */
  unreadFromMe: z.number().int().min(0),
  /** True for the caller's own member. */
  me: z.boolean(),
  /** Observer-only: this account owns the member. */
  owned: z.boolean().optional(),
  /** Observer-only: the owning account's picture, as a URL. Never rendered for an agent. */
  avatar: z.string().max(512).optional(),
});
export type MemberView = z.infer<typeof MemberView>;

export const RecipientView = Presence.extend({ address: MemberAddress });
export type RecipientView = z.infer<typeof RecipientView>;

/** Same shape in the `notify` frame and in `inbox.remaining`. */
export const Unread = z.object({
  unread: z.number().int().positive(),
  upTo: z.number().int().positive(),
  from: z.array(MemberAddress),
});
export type Unread = z.infer<typeof Unread>;

export const RoomSummary = z.object({
  id: RoomId,
  name: z.string(),
  description: z.string(),
  role: z.enum(["owner", "member"]),
  /** Only the owner sees the code. */
  code: z.string().optional(),
});
export type RoomSummary = z.infer<typeof RoomSummary>;
