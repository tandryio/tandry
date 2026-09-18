import { z } from "zod";

export const ErrorCode = z.enum([
  "invalid_input",
  "not_logged_in",
  "handle_required",
  "forbidden",
  "no_such_room",
  "already_in_room",
  "not_in_room",
  "no_such_member",
  "no_such_message",
  "name_taken",
  "limit_reached",
  "rate_limited",
  "upgrade_required",
  "unavailable",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  /** Whatever the next step needs: the current member list, the current room. */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export class TandryError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TandryError";
  }
  toBody(): ErrorBody {
    return { code: this.code, message: this.message, ...(this.data ? { data: this.data } : {}) };
  }
  static from(body: ErrorBody): TandryError {
    return new TandryError(body.code, body.message, body.data);
  }
}

/** Errors travel as values between the Worker, the room and the bindings. */
export type Result<T> = { ok: true; result: T } | { ok: false; error: ErrorBody };

export function fail(code: ErrorCode, message: string, data?: Record<string, unknown>): { ok: false; error: ErrorBody } {
  return { ok: false, error: { code, message, ...(data ? { data } : {}) } };
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  not_logged_in: 401,
  handle_required: 403,
  forbidden: 403,
  no_such_room: 404,
  already_in_room: 409,
  not_in_room: 409,
  no_such_member: 404,
  no_such_message: 404,
  name_taken: 409,
  limit_reached: 409,
  rate_limited: 429,
  upgrade_required: 426,
  unavailable: 503,
};

/** The next step an agent should take, appended to every rendered error. */
export const NEXT_STEP: Record<ErrorCode, string> = {
  invalid_input: "Fix the arguments and call the tool again.",
  not_logged_in: "Call login, show the owner the URL and code, and wait for them to approve.",
  handle_required: "Ask the owner to open the Tandry website and choose an account handle, then try again.",
  forbidden: "This account may not do that. Report it to the owner.",
  no_such_room: "Ask the owner for the room code. Do not guess one and do not create a replacement room.",
  already_in_room: "This conversation is already in a room. Call leave first, or ask the owner to fork the conversation in the host and join from the fork.",
  not_in_room: "This conversation is not in the room, was continued elsewhere, or was removed. Call join.",
  no_such_member: "Pick the recipient from the current member list below.",
  no_such_message: "The message being replied to does not exist or is not readable by this member.",
  name_taken: "Choose another member name.",
  limit_reached: "A plan limit was reached. Report it to the owner.",
  rate_limited: "Stop sending and report to the owner.",
  upgrade_required: "Ask the owner to update the Tandry plugin.",
  unavailable: "The Hub could not be reached. Retrying the same call is safe.",
};
