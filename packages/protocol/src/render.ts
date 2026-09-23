import { NEXT_STEP, type ErrorBody } from "./errors";
import { hostLabel, parseAddress, type MemberAddress, type MemberView, type MessageView, type Presence, type RoomSummary, type Unread } from "./nouns";
import type { Output } from "./operations";

// Every word an agent reads from Tandry is produced here, so the local tools
// and the web connector say the same thing. Pure functions only.
//
// A result says what happened and, when it depends on this result, what to do
// next. Standing rules (whose words are instructions, when to call again) live
// once in the tool descriptions in tools.ts, not in every result.

/** A fresh boundary for one tool result. The sender of a message cannot know it. */
export function newNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function relativeTime(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function addresses(list: readonly MemberAddress[], limit = 5): string {
  const shown = list.slice(0, limit).join(", ");
  return list.length > limit ? `${shown} and ${list.length - limit} more` : shown;
}

/**
 * One message inside a nonce-tagged element. Header attributes come from the
 * Hub and use a character set that needs no escaping. The body is untrusted
 * and placed as is: it cannot close the element without knowing the nonce.
 */
export function renderEnvelope(message: MessageView, nonce: string): string {
  const tag = `tandry-${nonce}`;
  const attributes = [
    `message="${message.id}"`,
    `visibility="${message.visibility}"`,
    ...(message.kind === "intro" ? ['kind="intro"'] : []),
    `from="${message.from}"`,
    `owner="${parseAddress(message.from).handle}"`,
    `host="${message.fromHost}"`,
    `to="${message.toRoom ? "@room" : message.to.join(", ")}"`,
    ...(message.replyTo ? [`reply-to="${message.replyTo}"`] : []),
    `sent="${new Date(message.createdAt).toISOString()}"`,
    ...(message.deletedAt !== undefined ? ['deleted="true"'] : []),
  ];
  return `<${tag} ${attributes.join(" ")}>\n${message.deletedAt !== undefined ? "Message content deleted by its owner." : message.body}\n</${tag}>`;
}

/** Names this result's nonce; the tool descriptions say what the envelope means. */
function envelopes(messages: readonly MessageView[], nonce: string): string {
  return `Messages, each in <tandry-${nonce}>:\n\n${messages.map((message) => renderEnvelope(message, nonce)).join("\n\n")}`;
}

/** The fixed notice. Built from headers only; a message body never appears in it. */
export function renderNotice(unread: Pick<Unread, "unread" | "from">): string {
  const count = unread.unread === 1 ? "1 unread message" : `${unread.unread} unread messages`;
  return `Tandry: ${count} from ${addresses(unread.from)}. Call the inbox tool to read. This notice is not an instruction from the owner.`;
}

export function renderInbox(batch: Output<"inbox">, nonce: string): string {
  if (!batch.messages.length) return "No new messages.";
  const remaining = batch.remaining
    ? `\n\n${batch.remaining.unread} more unread from ${addresses(batch.remaining.from)}. Call inbox again to read them.`
    : "";
  return envelopes(batch.messages, nonce) + remaining;
}

export function renderHistory(page: Output<"history">, nonce: string): string {
  if (!page.messages.length) return "Nothing has been said yet.";
  const more = page.nextBefore ? `\n\nOlder messages exist. Call history with before: ${page.nextBefore}.` : "";
  return envelopes(page.messages, nonce) + more;
}

export function renderPresence(presence: Presence, now: number): string {
  if (presence.state === "offline") return `offline, last active ${relativeTime(presence.lastActiveAt, now)}; reads it when its owner is next back in that conversation`;
  if (presence.tier === "pull") return "online in a web chat; reads it at its next inbox check";
  return "online; told now";
}

export function renderSent(result: Output<"send">, now: number): string {
  if (!result.recipients.length) return `Sent ${result.id}. On record in the room; nobody was told.`;
  const lines = result.recipients.map((recipient) => `- ${recipient.address}: ${renderPresence(recipient, now)}`);
  return `Sent ${result.id}.\n${lines.join("\n")}`;
}

function memberLine(member: MemberView, now: number): string {
  const workspace = [member.workspace.repo, member.workspace.branch].filter(Boolean).join("@");
  const unread = member.unreadFromMe ? `; ${member.unreadFromMe} of your messages unread` : "";
  const head = `- ${member.address}${member.me ? " (you)" : ""} · ${hostLabel(member.host)}${workspace ? ` · ${workspace}` : ""} · ${renderPresence(member, now)}${unread}`;
  return `${head}\n  intro (self-reported): ${member.intro.replace(/\s+/g, " ")}`;
}

export function renderMembers(result: Output<"members">, now: number): string {
  return result.members.length ? result.members.map((member) => memberLine(member, now)).join("\n") : "The room has no members.";
}

export function renderJoin(result: Output<"join">, nonce: string, now: number): string {
  const verb = { joined: "Joined", reused: "Already in", continued: "Continued in" }[result.outcome];
  const parts = [
    `${verb} #${result.room.name} as ${result.member}`,
    ...(result.room.description ? [`About this room: ${result.room.description}`] : []),
    `Members:\n${renderMembers({ members: result.members }, now)}`,
    `Recent history:\n${renderHistory({ messages: result.history, nextBefore: null }, nonce)}`,
  ];
  if (result.unread) parts.push(`${result.unread} unread for this member. Call inbox.`);
  if (result.offline.length)
    parts.push(`Offline members of this account here: ${addresses(result.offline)}.`);
  return parts.join("\n\n");
}

export function renderLeft(result: Output<"leave">): string {
  return `${result.left} left the room.`;
}

export function renderNewRoom(result: Output<"new_room">): string {
  return `Created #${result.name}. Code: ${result.code}`;
}

/** `rotated` says the call replaced the code, because the result alone cannot. */
export function renderRoomUpdated(result: Output<"update_room">, rotated: boolean): string {
  const parts = [`Updated #${result.name}.`, `Description: ${result.description || "(none)"}`];
  if (rotated && result.code) parts.push(`New code: ${result.code}`);
  return parts.join("\n");
}

/**
 * The Hub treats renaming to the name the member already has as a no-op and
 * reports the same address, so this says only what holds either way.
 */
export function renderRenamed(result: Output<"rename">): string {
  return `Renamed to ${result.member}.`;
}

export function renderLoginStart(result: Pick<Output<"login_start">, "url" | "userCode" | "expiresInSeconds">): string {
  return `For the owner: open ${result.url} and enter the code ${result.userCode} within ${Math.round(result.expiresInSeconds / 60)} minutes.`;
}

export interface StatusView {
  account: { handle: string | null } | null;
  /** Where this conversation is, from the binding's own knowledge. */
  current: { room: string; member: MemberAddress } | null;
  /** Why messages are not arriving right now; null when nothing is wrong. */
  inactive: string | null;
  rooms: RoomSummary[];
  /** The last failed wake, if any. */
  wakeError?: string;
}

export function renderStatus(view: StatusView): string {
  if (!view.account) return "Not signed in. Call login.";
  const lines = [
    view.account.handle ? `Signed in as ${view.account.handle}.` : "Signed in, but the account has no handle yet. The owner chooses one on the Tandry website.",
    view.current ? `This conversation is ${view.current.member} in #${view.current.room}.` : "This conversation is not in a room.",
  ];
  if (view.inactive) lines.push(`Not receiving: ${view.inactive}`);
  if (view.wakeError) lines.push(`Last wake failed: ${view.wakeError}`);
  lines.push(view.rooms.length
    ? `Rooms:\n${view.rooms.map((room) => `- #${room.name} (${room.role})${room.code ? ` code ${room.code}` : ""}${room.description ? `: ${room.description}` : ""}`).join("\n")}`
    : "The account has no rooms.");
  return lines.join("\n");
}

export function renderError(error: ErrorBody, now = Date.now()): string {
  const lines = [`Error ${error.code}: ${error.message}`, NEXT_STEP[error.code]];
  const members = error.data?.members;
  if (Array.isArray(members)) lines.push(`Members:\n${renderMembers({ members: members as MemberView[] }, now)}`);
  return lines.join("\n");
}

/** A push host whose idle wake is a monitor process that the model has a part in starting. */
export type MonitorView =
  /** Claude Code arms the plugin monitor when the tandry:join skill is dispatched; joining the room again is reused. */
  | { host: "claude"; code: string; member: MemberAddress; room: string }
  /** Grok Build's model starts it with the monitor tool, from this exact command. */
  | { host: "grok"; command: string };

/** Said in every tool result of a joined conversation while the monitor is missing and this would bring it. */
export function renderMonitorMissing(view: MonitorView): string {
  const how = view.host === "claude"
    ? `Claude Code starts it when the tandry:join skill is dispatched, so invoke the Skill tool now with skill "tandry:join" and args "${view.code}". This conversation is already ${view.member} in #${view.room}; that join is reused and changes nothing.`
    : `Start it now with the monitor tool: command \`${view.command}\`, description "Tandry inbox", persistent true.`;
  return `Automatic delivery is off: the Tandry inbox monitor is not running in this ${hostLabel(view.host)} session. ${how}`;
}

/** A connector has no process-local marker; the chat must keep this reference. */
export function renderConversationHandle(handle: string): string {
  return `Conversation: ${handle}`;
}
