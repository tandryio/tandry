import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { agentFor } from './net';
import { authHeaders } from './auth';
import {
  ServerMessage,
  type AgentInfo,
  type ClientMessage,
  type InboundMessage,
  type SessionStatus,
} from '@agent-room/protocol';

export interface HubClientOptions {
  hub: string;
  room: string;
  hello: Omit<Extract<ClientMessage, { type: 'hello' }>, 'type'>;
  log: (...a: unknown[]) => void;
}

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

interface Pending {
  resolve: (m: ServerMessage) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Long-lived WebSocket to the TeamRoom. Reconnects with backoff and replays
 * hello (same ref) so the hub resumes our identity and flushes queued mail.
 */
export class HubClient extends EventEmitter {
  name = '';
  self?: AgentInfo;
  ref: string;
  connected = false;
  reliable = false;
  superseded = false;
  unauthorized = false;
  private reconnectTimer?: NodeJS.Timeout;
  private awaitingPong = false;
  /** set when the hub says the room does not exist / expired; no reconnects after that */
  roomGone = false;
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private backoff = 1000;
  private closed = false;
  private pingTimer: NodeJS.Timeout | null = null;
  private status: SessionStatus;
  private visible: boolean;

  constructor(private opts: HubClientOptions) {
    super();
    this.ref = opts.hello.ref;
    this.status = opts.hello.status ?? 'idle';
    this.visible = opts.hello.visible ?? true;
  }

  connect() {
    if (this.closed || this.roomGone) return;
    const url = new URL('/ws', this.opts.hub);
    url.searchParams.set('room', this.opts.room);
    const agent = agentFor(url);
    if (agent) this.opts.log('connecting via proxy');
    const ws = new WebSocket(url, { agent, headers: authHeaders(), handshakeTimeout: 10_000 });
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws || this.closed) return;
      this.awaitingPong = false;
      this.opts.log('connected, sending hello');
      this.raw({ type: 'hello', ...this.opts.hello, reliable: 1, status: this.status, visible: this.visible });
      this.pingTimer = setInterval(() => {
        if (this.awaitingPong) { ws.terminate(); return; }
        this.awaitingPong = true;
        this.raw({ type: 'ping' });
      }, 30_000);
    });
    ws.on('message', (data) => { if (this.ws === ws && !this.closed) this.onMessage(data.toString()); });
    ws.on('close', (code, reason) => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.reliable = false;
      this.rejectPending('connection closed; delivery receipt may have been lost');
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.emit('disconnected');
      if (code === 4000) { this.superseded = true; return; } // superseded by a newer socket of ours
      if (code === 4003) { this.unauthorized = true; return; }
      if (code === 4004) {
        this.roomGone = true;
        this.opts.log('room expired, giving up');
        return;
      }
      if (!this.closed) {
        this.opts.log(`closed (${code} ${reason}), reconnecting in ${this.backoff}ms`);
        this.reconnectTimer = setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30_000);
      }
    });
    // Bun's ws shim warns at registration and never emits this Node-only event.
    // Its failed handshakes use error/close; keep those handlers active below.
    if (!process.versions.bun) {
    ws.on('unexpected-response', (_req, res) => {
      if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 409) {
        this.unauthorized = true; this.closed = true;
        this.opts.log('access denied: sign in, choose your @handle, and join an account-owned room');
      }
        if (res.statusCode === 404) {
          this.roomGone = true;
          this.closed = true;
          this.opts.log(`room ${this.opts.room} does not exist or has expired`);
        }
        res.resume();
        ws.terminate();
      });
    }
    ws.on('error', (e) => this.opts.log('ws error', e.message));
  }

  close() {
    this.closed = true;
    this.connected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.rejectPending('connection closed');
    this.ws?.terminate();
  }

  setStatus(status: SessionStatus) {
    this.status = status;
    this.raw({ type: 'status', status });
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.raw({ type: 'visibility', visible });
  }

  setName(name: string) { this.opts.hello.name = name; }

  async rename(name: string) {
    const res = await this.request({ type: 'rename', name });
    if (res.type !== 'renamed') throw new Error(res.type === 'error' ? res.message : 'unexpected reply');
    this.name = res.name;
    if (this.self) this.self.name = res.name;
    this.setName(res.name);
    return res.name;
  }

  async list(): Promise<AgentInfo[]> {
    const res = await this.request({ type: 'list' });
    if (res.type === 'agents') {
      this.self = res.agents.find(a => a.ref === this.ref) ?? this.self;
      return res.agents;
    }
    throw new Error(res.type === 'error' ? res.message : 'unexpected reply');
  }

  async send(to: string, body: string, notifyWhenIdle?: boolean, messageId?: string) {
    const res = await this.request({ type: 'send', to, body, notifyWhenIdle, messageId });
    if (res.type === 'sent') return res;
    if (res.type === 'error') {
      const e = new Error(res.message) as Error & { code?: string; candidates?: AgentInfo[] };
      e.code = res.code;
      e.candidates = res.candidates;
      throw e;
    }
    throw new Error('unexpected reply');
  }

  ack(id: string) { if (this.reliable) this.raw({ type: 'ack', ids: [id] }); }

  private rejectPending(reason: string) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    this.pending.clear();
  }

  // ---- internals ----------------------------------------------------------

  private request(msg: DistributiveOmit<Extract<ClientMessage, { reqId: string }>, 'reqId'>): Promise<ServerMessage> {
    if (!this.connected) return Promise.reject(new Error('not connected to hub'));
    const reqId = Math.random().toString(36).slice(2, 10);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error('hub timeout'));
      }, 10_000);
      this.pending.set(reqId, { resolve, reject, timer });
      this.raw({ ...msg, reqId } as ClientMessage);
    });
  }

  private raw(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(text: string) {
    let value: unknown;
    try { value = JSON.parse(text); } catch { return this.opts.log('invalid server JSON'); }
    const parsed = ServerMessage.safeParse(value);
    if (!parsed.success) return this.opts.log('bad server message', parsed.error.message);
    const m = parsed.data;
    switch (m.type) {
      case 'welcome':
        this.name = m.name;
        this.self = m.self;
        this.connected = true;
        this.reliable = m.reliable === 1;
        this.backoff = 1000;
        this.emit('welcome', m);
        for (const msg of m.pending) this.emit('message', msg as InboundMessage);
        return;
      case 'message':
        return void this.emit('message', m.message);
      case 'idle-notice':
        return void this.emit('idle-notice', m);
      case 'pong':
        this.awaitingPong = false;
        return;
      default: {
        const p = 'reqId' in m && m.reqId ? this.pending.get(m.reqId) : undefined;
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(m.reqId!);
          p.resolve(m);
        } else if (m.type === 'error') {
          this.opts.log('hub error', m.code, m.message);
        }
      }
    }
  }
}
