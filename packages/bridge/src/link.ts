import WebSocket from "ws";
import { Frame, LINK_PATH, TandryError, contextHeaders, terminalClose, type CallContext, type ErrorCode, type StateFrame, type Unread } from "@tandryio/protocol";
import { agentFor, createOps } from "./ops";

/** Why a link ended for good. A close code from the Hub, or a rejected upgrade. */
export type LinkEnd = "superseded" | "rebound" | "not_in_room" | "upgrade_required" | "not_logged_in";

export interface LinkOptions {
  hub: string;
  context: () => CallContext;
  state: () => StateFrame;
  onNotify(unread: Unread): void;
  onEnd(reason: LinkEnd, message?: string): void;
  reconnectDelaysMs: readonly number[];
  closeTimeoutMs: number;
}

const REJECTIONS: Partial<Record<ErrorCode, LinkEnd>> = {
  not_in_room: "not_in_room", upgrade_required: "upgrade_required", not_logged_in: "not_logged_in",
};

/**
 * The room link: one WebSocket per conversation, carrying only notices in and
 * state out. Connected means live. An ordinary drop is retried with backoff
 * and the Hub replays the notice on reconnect; operations keep working over
 * HTTP meanwhile. A terminal close code or a rejected upgrade ends it.
 */
export class Link {
  private socket: WebSocket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private stopped = false;
  connected = false;

  constructor(private readonly options: LinkOptions) {}

  start(): void {
    if (this.stopped || this.socket) return;
    const url = this.options.hub.replace(/^http/, "ws") + LINK_PATH;
    const context = this.options.context();
    // Bun 1.3.14's built-in ws warns on registering
    // unexpected-response and never supplies the rejected HTTP response.
    const bun = !!process.versions.bun;
    let opened = false;
    let checking: Promise<void> | undefined;
    const socket = new WebSocket(url, {
      headers: contextHeaders(context), agent: agentFor(url), handshakeTimeout: 15_000,
      // Some servers keep the TCP connection long after their close frame; the code has arrived by then.
      closeTimeout: this.options.closeTimeoutMs,
    } as WebSocket.ClientOptions);
    this.socket = socket;
    const checkRejection = () => { checking ??= this.checkRejection(socket, context); };
    socket.on("open", () => { opened = true; this.connected = true; this.attempt = 0; this.reportState(); });
    socket.on("message", (data) => {
      let json: unknown;
      try { json = JSON.parse(String(data)); } catch { return; }
      const frame = Frame.safeParse(json);
      if (frame.success && frame.data.t === "notify") this.options.onNotify({ unread: frame.data.unread, upTo: frame.data.upTo, from: frame.data.from });
    });
    if (!bun) socket.on("unexpected-response", (_request, response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        let error: { code?: ErrorCode; message?: string } = {};
        try { error = (JSON.parse(text) as { error?: typeof error }).error ?? {}; } catch { /* not ours */ }
        const end = error.code && REJECTIONS[error.code];
        this.dropped(socket, end ? { reason: end, message: error.message } : null);
      });
      response.on("error", () => this.dropped(socket, null));
    });
    socket.on("close", (code) => {
      const reason = terminalClose(code);
      if (bun && !opened && !reason) checkRejection();
      else this.dropped(socket, reason ? { reason } : null);
    });
    socket.on("error", () => {
      if (bun && !opened) checkRejection();
      // Node supplies close or unexpected-response; an established Bun link closes.
    });
  }

  private async checkRejection(socket: WebSocket, context: CallContext): Promise<void> {
    if (this.socket !== socket || this.stopped) return;
    let end: { reason: LinkEnd; message?: string } | null = null;
    try {
      // Only failed Bun handshakes need this read-only check. Members uses the
      // same auth, protocol and conversation membership checks as the room link,
      // without consuming inbox mail or opening another socket. Let the link's
      // existing backoff own retries if HTTP also fails or membership is valid.
      const call = createOps({ hub: this.options.hub, context: () => context, retryDelaysMs: [], timeoutMs: 15_000 });
      await call("members", {});
    } catch (error) {
      if (error instanceof TandryError) {
        const reason = REJECTIONS[error.code];
        if (reason) end = { reason, message: error.message };
      }
    }
    // dropped ignores a result from a socket that was replaced or disposed.
    this.dropped(socket, end);
  }

  private dropped(socket: WebSocket, end: { reason: LinkEnd; message?: string } | null): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.connected = false;
    try { socket.terminate(); } catch { /* already gone */ }
    if (this.stopped) return;
    if (end) { this.stopped = true; this.options.onEnd(end.reason, end.message); return; }
    const delays = this.options.reconnectDelaysMs;
    const delay = delays[Math.min(this.attempt++, delays.length - 1)]!;
    this.timer = setTimeout(() => { this.timer = null; this.start(); }, delay * (0.75 + Math.random() / 2));
    this.timer.unref?.();
  }

  reportState(): void {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(this.options.state()));
  }

  stop(): void {
    this.stopped = true;
    this.connected = false;
    if (this.timer) clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = null;
    try { socket?.terminate(); } catch { /* already gone */ }
  }
}
