import os from "node:os";
import {
  TandryError, newId, newNonce, normalizeCode, renderError, renderHistory, renderInbox, renderJoin, renderLeft, renderLoginStart,
  renderMembers, renderNewRoom, renderSent, renderStatus, toolInputSchema, tools,
  type ConversationRef, type Output, type RoomSummary, type ToolName, type ToolParams,
} from "@tandryio/protocol";
import { deleteCredentials, readCredentials, writeCredentials, type Credentials } from "./credentials";
import type { JoinedMarker } from "./local";
import type { Ops } from "./ops";

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(params: unknown): Promise<{ text: string; isError: boolean }>;
}

/** What the tools need of the bridge that owns them: where the conversation stands, and how to move it. */
export interface Session {
  hub: string;
  ops: Ops;
  conversation(): ConversationRef | null;
  marker(): JoinedMarker | null;
  /** Joined: remember the room and go online. */
  enter(marker: JoinedMarker): void;
  /** No longer in the room: drop the marker and the link. */
  forget(): void;
  /** Credentials appeared: go online if this conversation is in a room. */
  signedIn(): void;
  signedOut(): void;
  /** A batch was written into a tool result. */
  handedOver(batch: Output<"inbox">): void;
  inactive(): string | null;
  wakeError(): string | null;
  disposed(): boolean;
  loginPollFloorMs: number;
}

/** The nine tools an agent sees. Each is one or more operations plus the local bookkeeping around them. */
export function createTools(session: Session): Tool[] {
  const { hub, ops } = session;
  let lastRead: Promise<unknown> = Promise.resolve();
  let login: { url: string; userCode: string; expiresInSeconds: number; error?: string } | null = null;

  const needConversation = (): ConversationRef => {
    const conversation = session.conversation();
    if (!conversation) throw new TandryError("not_in_room", "The host has not given this conversation's ID yet, so it cannot take part in a room. Only top-level conversations can join.");
    return conversation;
  };
  const needRoom = (): JoinedMarker => {
    needConversation();
    const marker = session.marker();
    if (!marker) throw new TandryError("not_in_room", "This conversation has not joined a room");
    return marker;
  };
  const needLogin = (): Credentials => {
    const credentials = readCredentials(hub);
    if (!credentials) throw new TandryError("not_logged_in", "This machine is not signed in to Tandry");
    return credentials;
  };
  /** The Hub says this conversation backs no member any more: drop the local marker too. */
  async function inRoom<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof TandryError && error.code === "not_in_room") session.forget();
      throw error;
    }
  }

  function pollLogin(deviceCode: string, intervalSeconds: number, expiresInSeconds: number): void {
    const deadline = Date.now() + expiresInSeconds * 1000;
    const delay = Math.max(session.loginPollFloorMs, intervalSeconds * 1000);
    const tick = async () => {
      if (session.disposed() || !login) return;
      if (Date.now() > deadline) { login = { ...login, error: "The sign-in code expired. Call login again." }; return; }
      try {
        const result = await ops("login_status", { deviceCode, label: os.hostname().slice(0, 100) });
        if (result.state === "approved") { writeCredentials({ hub, token: result.token, account: result.account }); login = null; session.signedIn(); return; }
        if (result.state !== "pending") { login = { ...login, error: result.state === "denied" ? "The owner denied the sign-in." : "The sign-in code expired. Call login again." }; return; }
      } catch { /* keep polling until the deadline */ }
      setTimeout(tick, delay).unref?.();
    };
    setTimeout(tick, delay).unref?.();
  }

  const implementations: { [K in ToolName]: (params: ToolParams<K>) => Promise<string> } = {
    async login({ action }) {
      if (action === "logout") {
        if (readCredentials(hub)) await ops("logout", {}).catch(() => {});
        deleteCredentials();
        session.signedOut();
        return "Signed out. This machine's device token was revoked.";
      }
      const account = readCredentials(hub)?.account;
      if (account) return `Already signed in${account.handle ? ` as ${account.handle}` : ""}.`;
      const started = await ops("login_start", {});
      login = { url: started.url, userCode: started.userCode, expiresInSeconds: started.expiresInSeconds };
      pollLogin(started.deviceCode, started.intervalSeconds, started.expiresInSeconds);
      return renderLoginStart(started);
    },

    async status() {
      const credentials = readCredentials(hub);
      if (!credentials) return login ? `${login.error ?? "Waiting for the owner to approve."}\n${login.error ? "" : renderLoginStart(login)}`.trim() : renderStatus({ account: null, current: null, inactive: null, rooms: [] });
      let rooms: RoomSummary[] = [];
      let account = credentials.account;
      try {
        const result = await ops("status", {});
        rooms = result.rooms;
        account = result.account;
        if (account.handle !== credentials.account.handle) writeCredentials({ ...credentials, account });
      } catch (error) {
        if (error instanceof TandryError && error.code === "not_logged_in") { deleteCredentials(); return renderStatus({ account: null, current: null, inactive: null, rooms: [] }); }
        throw error;
      }
      const marker = session.marker();
      const wakeError = session.wakeError();
      return renderStatus({
        account, rooms,
        current: marker ? { room: marker.roomName, member: marker.member } : null,
        inactive: session.inactive(),
        ...(wakeError ? { wakeError } : {}),
      });
    },

    async new_room(params) {
      needLogin();
      return renderNewRoom(await ops("new_room", { id: newId("r"), ...params }));
    },

    async join(params) {
      const ref = needConversation();
      needLogin();
      const code = normalizeCode(params.room);
      // A conversation is in one room at a time. This is local policy, checked
      // against the marker; nothing on the Hub depends on it.
      const marker = session.marker();
      if (marker && marker.code !== code)
        throw new TandryError("already_in_room", `This conversation is already ${marker.member} in #${marker.roomName}`);
      const result = await ops("join", { code: params.room, intro: params.intro, name: params.name, as: params.as, workspace: ref.workspace });
      session.enter({ room: result.room.id, roomName: result.room.name, code, member: result.member });
      return renderJoin(result, newNonce(), Date.now());
    },

    async leave() {
      needRoom();
      try {
        const result = await ops("leave", {});
        session.forget();
        return renderLeft(result);
      } catch (error) {
        // A retried leave finds the member already gone. The outcome is the same.
        if (error instanceof TandryError && error.code === "not_in_room") { session.forget(); return "This conversation is no longer in the room."; }
        throw error;
      }
    },

    async members() {
      needRoom();
      return renderMembers(await inRoom(() => ops("members", {})), Date.now());
    },

    async send(params) {
      needRoom();
      const result = await inRoom(() => ops("send", { id: newId("m"), to: params.to, body: params.body, dm: params.dm ?? false, replyTo: params.replyTo }));
      return renderSent(result, Date.now());
    },

    async inbox() {
      needRoom();
      // inbox and read are serialized: the next inbox waits for the previous read.
      await lastRead;
      const batch = await inRoom(() => ops("inbox", {}));
      const text = renderInbox(batch, newNonce());
      // Handed over means written into a tool result. From here the position may
      // move; if `read` is lost, the same messages simply come back next time.
      if (batch.upTo) lastRead = ops("read", { upTo: batch.upTo }).catch(() => {});
      session.handedOver(batch);
      return text;
    },

    async history(params) {
      needRoom();
      return renderHistory(await inRoom(() => ops("history", params)), newNonce());
    },
  };

  return (Object.keys(tools) as ToolName[]).map((name) => ({
    name,
    description: tools[name].description,
    inputSchema: toolInputSchema(name, "local"),
    async call(params: unknown) {
      try {
        const parsed = tools[name].params.safeParse(params ?? {});
        if (!parsed.success) throw new TandryError("invalid_input", parsed.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; "));
        return { text: await implementations[name](parsed.data as never), isError: false };
      } catch (error) {
        if (error instanceof TandryError) return { text: renderError(error.toBody()), isError: true };
        return { text: `Tandry failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    },
  }));
}
