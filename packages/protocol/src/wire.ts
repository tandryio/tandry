import { z } from "zod";
import { ErrorBody, HTTP_STATUS, TandryError, type Result } from "./errors";
import { ConversationKey, RoomId, Unread } from "./nouns";
import { operations, type Input, type OperationName, type Output } from "./operations";

/** The Hub accepts the current version and the one before it. */
export const PROTOCOL_VERSION = 1;
export const OLDEST_SUPPORTED_PROTOCOL = 1;

export const LINK_PATH = "/v1/link";
export function operationPath(name: OperationName): string {
  return `/v1/${name}`;
}

export const HEADERS = {
  protocol: "Tandry-Protocol",
  room: "Tandry-Room",
  host: "Tandry-Host",
  conversation: "Tandry-Conversation",
} as const;

/**
 * Who is calling and from where. Operation input goes in the body; this goes
 * in headers, so operations and the link upgrade share one encoding.
 */
export interface CallContext {
  /** Device token. The website sends its session cookie instead. */
  token?: string;
  room?: RoomId;
  conversation?: ConversationKey;
}

export function contextHeaders(context: CallContext): Record<string, string> {
  return {
    [HEADERS.protocol]: String(PROTOCOL_VERSION),
    ...(context.token ? { Authorization: `Bearer ${context.token}` } : {}),
    ...(context.room ? { [HEADERS.room]: context.room } : {}),
    ...(context.conversation
      ? { [HEADERS.host]: context.conversation.host, [HEADERS.conversation]: context.conversation.hostConversationId }
      : {}),
  };
}

export interface ReceivedContext {
  protocol: number;
  room?: RoomId;
  conversation?: ConversationKey;
}

/** The Hub's side of contextHeaders. Throws invalid_input on malformed headers. */
export function readContext(header: (name: string) => string | null | undefined): ReceivedContext {
  const protocol = Number(header(HEADERS.protocol) ?? PROTOCOL_VERSION);
  if (!Number.isInteger(protocol) || protocol < 0) throw new TandryError("invalid_input", "Malformed protocol version");
  const room = header(HEADERS.room);
  const host = header(HEADERS.host);
  const hostConversationId = header(HEADERS.conversation);
  const parsedRoom = room ? RoomId.safeParse(room) : undefined;
  if (parsedRoom && !parsedRoom.success) throw new TandryError("invalid_input", "Malformed room ID");
  const conversation = host || hostConversationId ? ConversationKey.safeParse({ host, hostConversationId }) : undefined;
  if (conversation && !conversation.success) throw new TandryError("invalid_input", "Malformed conversation reference");
  return { protocol, room: parsedRoom?.data, conversation: conversation?.data };
}

export function encodeCall<K extends OperationName>(name: K, context: CallContext, input: Input<K>) {
  return {
    method: "POST" as const,
    path: operationPath(name),
    headers: { "Content-Type": "application/json", ...contextHeaders(context) },
    body: JSON.stringify(input),
  };
}

const Envelope = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: ErrorBody }),
]);

/** Returns the operation's output, or throws the TandryError the Hub answered with. */
export function decodeResult<K extends OperationName>(name: K, status: number, json: unknown): Output<K> {
  const envelope = Envelope.safeParse(json);
  if (!envelope.success) throw new TandryError("unavailable", `The Hub answered ${status} without a Tandry result`);
  if (!envelope.data.ok) throw TandryError.from(envelope.data.error);
  const output = operations[name].output.safeParse(envelope.data.result);
  if (!output.success) throw new TandryError("unavailable", `The Hub's ${name} result does not match this protocol version`);
  return output.data as Output<K>;
}

/** Only these are worth retrying; every operation is idempotent. */
export function isRetryable(status: number): boolean {
  return status >= 500;
}

export function httpStatus(result: Result<unknown>): number {
  return result.ok ? 200 : HTTP_STATUS[result.error.code];
}

// ---- room link -----------------------------------------------------------

/** Process → Hub. Only the shell knows whether its means of waking works right now. */
export const StateFrame = z.object({
  t: z.literal("state"),
  wakeable: z.boolean(),
  busy: z.boolean().optional(),
  reason: z.string().max(200).optional(),
});
export type StateFrame = z.infer<typeof StateFrame>;

/** Hub → process. Headers only: a count, a position, and who from. */
export const NotifyFrame = Unread.extend({ t: z.literal("notify") });
export type NotifyFrame = z.infer<typeof NotifyFrame>;

export const Frame = z.discriminatedUnion("t", [StateFrame, NotifyFrame]);
export type Frame = z.infer<typeof Frame>;

/**
 * The link's heartbeat, as bare text rather than frames: the Hub answers it
 * with a WebSocket auto-response, which does not wake a sleeping room.
 */
export const LINK_PING = "ping";
export const LINK_PONG = "pong";

export const CLOSE_CODES = {
  /** The same conversation connected elsewhere. Stop notifying, do not reconnect. */
  superseded: 4001,
  /** Another conversation continued this member. Delete the joined marker. */
  rebound: 4002,
  /** The member left or was removed. Delete the joined marker. */
  not_in_room: 4003,
} as const;
export type TerminalClose = keyof typeof CLOSE_CODES;

export function terminalClose(code: number): TerminalClose | null {
  const entry = Object.entries(CLOSE_CODES).find(([, value]) => value === code);
  return entry ? (entry[0] as TerminalClose) : null;
}
