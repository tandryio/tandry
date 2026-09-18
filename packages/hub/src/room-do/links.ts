import { tierOf, type NotifyFrame, type Presence, type StateFrame, type Unread } from "@tandryio/protocol";
import type { MemberRow } from "./schema";

interface Attachment {
  memberId: string;
  wakeable: boolean;
  busy: boolean;
  /** Set just before the Hub closes the socket, so presence stops counting it at once. */
  gone?: boolean;
}

/**
 * Presence and notification, answered from the connections the room holds.
 * Nothing here is written to storage. The newest link of a member wins; that
 * decides who is told, and it is not a lock.
 */
export class Links {
  constructor(private readonly state: DurableObjectState, private readonly pullLiveMs: number) {}

  private sockets(memberId: string): { socket: WebSocket; attachment: Attachment }[] {
    return this.state.getWebSockets(memberId)
      .map((socket) => ({ socket, attachment: socket.deserializeAttachment() as Attachment | null }))
      .filter((entry): entry is { socket: WebSocket; attachment: Attachment } =>
        !!entry.attachment && !entry.attachment.gone && entry.socket.readyState === WebSocket.OPEN);
  }

  accept(socket: WebSocket, memberId: string): void {
    this.close(memberId, 4001, "superseded");
    this.state.acceptWebSocket(socket, [memberId]);
    socket.serializeAttachment({ memberId, wakeable: false, busy: false } satisfies Attachment);
  }

  memberOf(socket: WebSocket): string | null {
    return (socket.deserializeAttachment() as Attachment | null)?.memberId ?? null;
  }

  closedByHub(socket: WebSocket): boolean {
    return !!(socket.deserializeAttachment() as Attachment | null)?.gone;
  }

  report(socket: WebSocket, frame: StateFrame): void {
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (attachment) socket.serializeAttachment({ ...attachment, wakeable: frame.wakeable, busy: frame.busy ?? false });
  }

  close(memberId: string, code: number, reason: string): void {
    for (const { socket, attachment } of this.sockets(memberId)) {
      socket.serializeAttachment({ ...attachment, gone: true });
      try { socket.close(code, reason); } catch { /* already closing */ }
    }
  }

  notify(memberId: string, unread: Unread): void {
    const frame: NotifyFrame = { t: "notify", ...unread };
    for (const { socket } of this.sockets(memberId)) {
      try { socket.send(JSON.stringify(frame)); } catch { /* a lost notice is repeated on reconnect */ }
    }
  }

  presence(member: Pick<MemberRow, "id" | "host" | "last_active_at">, now: number): Presence {
    const tier = tierOf(member.host);
    if (tier === "pull")
      return { state: now - member.last_active_at < this.pullLiveMs ? "live" : "dormant", tier, wakeable: false, lastActiveAt: member.last_active_at };
    const live = this.sockets(member.id);
    return {
      state: live.length ? "live" : "dormant", tier,
      wakeable: live.some(({ attachment }) => attachment.wakeable),
      busy: live.some(({ attachment }) => attachment.busy),
      lastActiveAt: live.length ? now : member.last_active_at,
    };
  }
}
