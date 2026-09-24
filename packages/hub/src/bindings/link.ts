import { HTTP_STATUS, TandryError, readContext } from "@tandryio/protocol";
import type { Context } from "hono";
import { principal } from "../auth/principal";
import type { Env } from "../env";
import { roomStub } from "../operations/membership";
import { CALLER_HEADER } from "../room-do/room-do";
import type { Caller } from "../room-do/context";

/**
 * GET /v1/link. Checks the credential, then hands the upgrade to the room,
 * which runs the same membership check as any operation. Only notices and
 * state frames travel on a link; operations never do.
 */
export async function linkBinding(c: Context<{ Bindings: Env }>): Promise<Response> {
  try {
    const context = readContext((name) => c.req.header(name));
    const who = await principal(c.env, c.req.raw);
    if (!who) throw new TandryError("not_logged_in", "Sign in to Tandry first");
    if (!context.room || !context.conversation) throw new TandryError("invalid_input", "A room link needs a room and the calling conversation");
    // The website polls; nothing else may speak for its member.
    if (context.conversation.host === "website") throw new TandryError("forbidden", "A website member has no room link");
    const caller: Caller = { accountId: who.accountId, handle: who.handle, conversation: context.conversation, protocol: context.protocol };
    const headers = new Headers(c.req.raw.headers);
    headers.set(CALLER_HEADER, JSON.stringify(caller));
    return roomStub(c.env, context.room).fetch(new Request(c.req.raw, { headers }));
  } catch (error) {
    if (!(error instanceof TandryError)) throw error;
    return c.json({ ok: false, error: error.toBody() }, HTTP_STATUS[error.code] as 400);
  }
}
