import { once } from "node:events";
import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { HTTP_STATUS, LINK_PING, LINK_PONG, type ErrorBody, type MessageView, type Output, type Unread } from "@tandryio/protocol";

/**
 * A real local HTTP and WebSocket server speaking the wire protocol, scripted
 * by the test. The seam under test is the network itself, so retries,
 * reconnects and "no request at all" are observable facts.
 */
export interface FakeHub {
  url: string;
  /** TCP connections accepted since start: the measure of "went online at all". */
  connections: number;
  requests: { op: string; headers: http.IncomingHttpHeaders; input: Record<string, unknown> }[];
  links: WebSocket[];
  linkUpgrades: number;
  states: { wakeable: boolean; busy?: boolean }[];
  /** Heartbeats received. Like the real Hub, each is answered with a pong. */
  pings: number;
  /** The links open now stop answering, and stay open: a path that went dead without either end being told. */
  silence(): void;
  /** Answer the next call of `op` with this instead of the default. */
  respond(op: string, reply: Reply | Promise<Reply>): void;
  /** Accept the next call of `op`, then drop the connection without answering. */
  drop(op: string): void;
  rejectLinks(error: ErrorBody | null): void;
  notify(unread: Unread): void;
  closeLinks(code: number): void;
  inboxQueue: Output<"inbox">[];
  calls(op: string): number;
  stop(): Promise<void>;
}
type Reply = { ok: true; result: unknown } | { ok: false; error: ErrorBody };

export const message = (seq: number, body = `message ${seq}`): MessageView => ({
  id: `m_0000000000${String(seq).padStart(6, "0")}`, seq, from: "alice/api-review", fromHost: "codex", visibility: "room",
  to: ["henry/hub-refactor"], toRoom: false, kind: "text", body, createdAt: 1_789_000_000_000,
});

export async function startFakeHub(): Promise<FakeHub> {
  const scripted = new Map<string, (Reply | Promise<Reply> | "drop")[]>();
  let rejection: ErrorBody | null = null;
  const silent = new Set<WebSocket>();
  const defaults: Record<string, (input: Record<string, unknown>) => unknown> = {
    login_start: () => ({ url: "http://hub.test/device?code=ABCD", userCode: "ABCD", deviceCode: "device-code", intervalSeconds: 0, expiresInSeconds: 600 }),
    login_status: () => ({ state: "approved", token: "device-token", account: { id: "acct", handle: "henry" } }),
    logout: () => ({}),
    status: () => ({ account: { id: "acct", handle: "henry" }, rooms: [] }),
    new_room: (input) => ({ id: input.id, name: input.name, code: "4BCD-2QQF" }),
    update_room: (input) => ({ id: input.room, name: input.name ?? "hub-design", description: input.description ?? "design talk", role: "owner", code: input.rotateCode ? "ZZZZ-9999" : "4BCD-2QQF" }),
    rename: (input) => ({ member: `henry/${String(input.name)}` }),
    join: () => ({ room: { id: "r_0000000000room01", name: "hub-design", description: "" }, member: "henry/hub-refactor", outcome: "joined", members: [], history: [], unread: 0, offline: [] }),
    leave: () => ({ left: "henry/hub-refactor" }),
    members: () => ({ members: [] }),
    send: (input) => ({ id: input.id, seq: 1, recipients: [] }),
    inbox: () => hub.inboxQueue.shift() ?? { messages: [], upTo: 0, remaining: null },
    read: (input) => ({ readSeq: input.upTo }),
    history: () => ({ messages: [], nextBefore: null }),
  };

  const server = http.createServer((request, response) => {
    const op = request.url!.replace("/v1/", "");
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", async () => {
      const input = JSON.parse(body || "{}") as Record<string, unknown>;
      hub.requests.push({ op, headers: request.headers, input });
      const next = scripted.get(op)?.shift();
      if (next === "drop") { request.socket.destroy(); return; }
      const reply: Reply = (await next) ?? { ok: true, result: defaults[op]!(input) };
      response.writeHead(reply.ok ? 200 : HTTP_STATUS[reply.error.code], { "Content-Type": "application/json" });
      response.end(JSON.stringify(reply));
    });
  });
  server.on("connection", () => { hub.connections++; });

  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    hub.linkUpgrades++;
    if (rejection) {
      // Clients may reset the TCP connection while rejecting the handshake.
      socket.on("error", () => {});
      const body = JSON.stringify({ ok: false, error: rejection });
      socket.end(`HTTP/1.1 ${HTTP_STATUS[rejection.code]} Rejected\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (link) => {
      hub.links.push(link);
      link.on("message", (data) => {
        const text = String(data);
        if (text !== LINK_PING) { hub.states.push(JSON.parse(text)); return; }
        hub.pings++;
        if (!silent.has(link)) link.send(LINK_PONG);
      });
      link.on("close", () => { hub.links = hub.links.filter((open) => open !== link); });
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const hub: FakeHub = {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    connections: 0, requests: [], links: [], linkUpgrades: 0, states: [], pings: 0, inboxQueue: [],
    respond: (op, reply) => { scripted.set(op, [...(scripted.get(op) ?? []), reply]); },
    drop: (op) => { scripted.set(op, [...(scripted.get(op) ?? []), "drop"]); },
    rejectLinks: (error) => { rejection = error; },
    silence: () => { for (const link of hub.links) silent.add(link); },
    notify: (unread) => { for (const link of hub.links) link.send(JSON.stringify({ t: "notify", ...unread })); },
    closeLinks: (code) => { for (const link of hub.links) link.close(code); },
    calls: (op) => hub.requests.filter((request) => request.op === op).length,
    async stop() {
      for (const link of sockets.clients) link.terminate();
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
  return hub;
}
