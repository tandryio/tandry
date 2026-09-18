import { Handle, type AccountId } from "@tandryio/protocol";
import type { Env } from "../env";
import { authFor } from "./auth";

/**
 * Who is calling, after the credential has been checked. The three kinds of
 * credential — website session, device token, connector OAuth token — are
 * indistinguishable past this point. Authorization is always by accountId.
 */
export type Principal = {
  accountId: AccountId;
  handle: Handle | null;
} & ({
  via: "session" | "device";
  /** The Better Auth session behind the credential. A Device is a session created by the device flow. */
  sessionId: string;
} | { via: "connector"; sessionId?: never });

export async function principal(env: Env, request: Request): Promise<Principal | null> {
  const session = await authFor(env).api.getSession({ headers: request.headers });
  if (!session) return null;
  const handle = Handle.safeParse((session.user as { handle?: string | null }).handle);
  return {
    accountId: session.user.id,
    handle: handle.success ? handle.data : null,
    via: request.headers.get("Authorization")?.startsWith("Bearer ") ? "device" : "session",
    sessionId: session.session.id,
  };
}
