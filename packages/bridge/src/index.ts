import { renderNotice, type CallContext, type ConversationRef, type HostKind, type RoomId } from "@tandryio/protocol";
import { readCredentials } from "./credentials";
import { inactive } from "./inactive";
import { Link, type LinkEnd } from "./link";
import { deleteMarker, hubUrl, readMarker, readRun, writeMarker, writeRun, type JoinedMarker } from "./local";
import { createOps } from "./ops";
import { createTools, type Session, type Tool } from "./tools";
import { UnreadState } from "./unread";
import { Waker } from "./wake";

/**
 * What a host's client implements. Only the shell knows whether its means of
 * starting a turn works right now, and whether the host is between turns.
 */
export interface Shell {
  wakeable(): boolean;
  idle(): boolean;
  /** Start or queue a turn whose content is only this notice. Reject on failure. Never interrupt a running turn. */
  wake(notice: string): Promise<void>;
  /** Why wakeable() is false right now, in one sentence for the agent; asked only then. A shell that cannot say leaves it out. */
  unwakeable?(): string | null;
}

export interface Bridge {
  /** Once. The same conversation again is a no-op; a different one throws: make a new bridge instead. */
  bind(conversation: ConversationRef): void;
  tools: Tool[];
  /** The notice a turn-boundary hook should inject now, or null. Each unread state is announced once, by wake or by this. */
  notice(): string | null;
  /** For hosts whose hooks are separate commands: a hook injected the run file's `notice` for this `key`. */
  announced(key: string): void;
  /** The shell's idle() or wakeable() changed. */
  hostChanged(): void;
  /** Why messages are not arriving right now, in one sentence; null when they are. */
  inactive(): string | null;
  dispose(): void;
}

export interface BridgeOptions {
  host: HostKind;
  shell: Shell;
  /** Hosts that know the conversation at startup pass it here; others call bind() later. */
  conversation?: ConversationRef;
  /** Keep ~/.tandry/run/<id> current for hosts whose hooks are separate commands. */
  runFile?: boolean;
  /** @internal Timing, shortened by the bridge's own tests. */
  timing?: Partial<Timing>;
}

interface Timing {
  retryDelaysMs: readonly number[];
  reconnectDelaysMs: readonly number[];
  wakeRetryDelaysMs: readonly number[];
  requestTimeoutMs: number;
  closeTimeoutMs: number;
  pingIntervalMs: number;
  pongTimeoutMs: number;
  loginPollFloorMs: number;
}

const TIMING: Timing = {
  retryDelaysMs: [300, 1_000, 3_000],
  reconnectDelaysMs: [1_000, 2_000, 5_000, 15_000, 30_000],
  wakeRetryDelaysMs: [1_000, 3_000, 9_000],
  requestTimeoutMs: 15_000,
  closeTimeoutMs: 2_000,
  pingIntervalMs: 30_000,
  pongTimeoutMs: 10_000,
  loginPollFloorMs: 2_000,
};

/**
 * One instance per conversation. It holds no messages: disposing it is closing
 * the link. A process that was never told to join makes no network request
 * and does not even read the credentials file.
 */
export function createBridge(options: BridgeOptions): Bridge {
  const timing = { ...TIMING, ...options.timing };
  const hub = hubUrl();
  const unread = new UnreadState();
  let conversation: ConversationRef | null = null;
  let marker: JoinedMarker | null = null;
  let link: Link | null = null;
  let ended: { reason: LinkEnd; message?: string } | null = null;
  let disposed = false;

  /** Hosts whose hooks are separate commands read the unread state, and the wake signal, from the run file. */
  let woken: { count: number; notice: string | null; at: number } = { count: 0, notice: null, at: 0 };
  function publish(): void {
    if (!options.runFile || !conversation) return;
    const current = unread.current();
    try {
      writeRun(conversation.hostConversationId, {
        unread: current?.unread ?? 0, upTo: current?.upTo ?? 0, key: unread.key(), notice: waker.peek(),
        wake: woken.count, wakeNotice: woken.notice, wakeAt: woken.at,
      });
    } catch { /* a missing run file only costs a notice */ }
  }
  const shell: Shell = {
    wakeable: () => options.shell.wakeable(),
    idle: () => options.shell.idle(),
    async wake(notice) {
      await options.shell.wake(notice);
      // Written out when the waker marks this state announced, in the same
      // publish, so no hook sees the notice still on offer beside the wake.
      woken = { count: woken.count + 1, notice, at: Date.now() };
    },
  };
  const waker: Waker = new Waker(unread, shell, timing.wakeRetryDelaysMs, publish);
  unread.onChange(() => { publish(); waker.evaluate(); });

  const context = (): CallContext => ({
    token: readCredentials(hub)?.token,
    room: marker?.room as RoomId | undefined,
    conversation: conversation ? { host: conversation.host, hostConversationId: conversation.hostConversationId } : undefined,
  });
  const ops = createOps({ hub, context, retryDelaysMs: timing.retryDelaysMs, timeoutMs: timing.requestTimeoutMs });

  // ---- link ------------------------------------------------------------------

  function openLink(): void {
    if (disposed || !conversation || !marker) return;
    link?.stop();
    ended = null;
    waker.restart();
    link = new Link({
      hub, context,
      state: () => ({ t: "state", wakeable: options.shell.wakeable(), busy: !options.shell.idle() }),
      onNotify: (notice) => unread.notified(notice),
      onEnd(reason, message) {
        ended = { reason, message };
        waker.stop();
        // Continued elsewhere or removed: this conversation is no longer in the room.
        if (reason === "rebound" || reason === "not_in_room") forget();
      },
      reconnectDelaysMs: timing.reconnectDelaysMs,
      closeTimeoutMs: timing.closeTimeoutMs,
      pingIntervalMs: timing.pingIntervalMs,
      pongTimeoutMs: timing.pongTimeoutMs,
    });
    link.start();
  }

  function forget(): void {
    if (conversation) deleteMarker(conversation.host, conversation.hostConversationId);
    marker = null;
    link?.stop();
    link = null;
    unread.reset();
  }

  const session: Session = {
    hub, ops,
    conversation: () => conversation,
    marker: () => marker,
    enter(next) {
      marker = next;
      writeMarker(conversation!.host, conversation!.hostConversationId, next);
      unread.reset();
      openLink();
    },
    remark(patch) {
      // The Hub changed something about the room or the member. Only the
      // marker is stale: the link is keyed by member ID, which did not change,
      // and no mail has been read.
      if (!marker || !conversation) return;
      marker = { ...marker, ...patch };
      writeMarker(conversation.host, conversation.hostConversationId, marker);
    },
    forget,
    signedIn: openLink,
    signedOut: () => link?.stop(),
    handedOver(batch) { unread.handedOver(batch); waker.inboxRead(); },
    inactive: () => bridge.inactive(),
    wakeError: () => waker.lastError,
    disposed: () => disposed,
    loginPollFloorMs: timing.loginPollFloorMs,
  };

  const bridge: Bridge = {
    bind(next) {
      if (conversation) {
        if (conversation.hostConversationId === next.hostConversationId && conversation.host === next.host) return;
        throw new Error("A bridge is bound to one conversation. Dispose it and create another.");
      }
      conversation = next;
      // The marker alone decides whether this process goes online.
      marker = readMarker(next.host, next.hostConversationId);
      if (options.runFile) woken = { count: readRun(next.hostConversationId)?.wake ?? 0, notice: null, at: 0 };
      if (marker) openLink();
    },

    tools: createTools(session),

    notice: () => waker.notice(),

    announced: (key) => waker.announced(key),

    hostChanged() {
      link?.reportState();
      waker.evaluate();
    },

    inactive() {
      // Asked only by the status tool and by shells, never at startup, so reading credentials here is fine.
      return inactive({
        loggedIn: !!readCredentials(hub), bound: !!conversation, joined: !!marker, ended, connected: !!link?.connected,
        wakeable: options.shell.wakeable(), unwakeable: options.shell.unwakeable?.() ?? null,
      });
    },

    dispose() {
      disposed = true;
      waker.stop();
      link?.stop();
      link = null;
    },
  };

  if (options.conversation) bridge.bind(options.conversation);
  return bridge;
}

export type { ConversationRef, HostKind, MonitorView } from "@tandryio/protocol";
// Hosts whose monitor the model helps start append this to tool results; a client imports the protocol only through here.
export { renderMonitorMissing } from "@tandryio/protocol";
export type { Tool } from "./tools";
