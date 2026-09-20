import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The only module that knows the layout of ~/.tandry. Hooks and monitors
// import this entry alone, so it must stay free of network and SDK imports:
// a hook runs on every tool call and its startup has to be cheap.

export const DEFAULT_HUB = "https://hub.tandry.io";

export function home(): string {
  return process.env.TANDRY_HOME ?? path.join(os.homedir(), ".tandry");
}

export function hubUrl(): string {
  return (process.env.TANDRY_HUB ?? DEFAULT_HUB).replace(/^ws/, "http").replace(/\/+$/, "");
}

const safe = (id: string) => encodeURIComponent(id);
export const credentialsPath = () => path.join(home(), "credentials.json");
export const markerPath = (host: string, hostConversationId: string) => path.join(home(), "joined", safe(host), safe(hostConversationId));
export const runPath = (hostConversationId: string) => path.join(home(), "run", safe(hostConversationId));
export const byPidPath = (pid: number) => path.join(home(), "run", "by-pid", String(pid));

export function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; }
}

/** Atomic, so a hook never reads a half-written file. */
export function writeJson(file: string, value: unknown, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode });
  fs.renameSync(temporary, file);
}

export function remove(file: string): void {
  fs.rmSync(file, { force: true });
}

/**
 * Written when this conversation's own join succeeds. Its presence alone
 * decides whether a starting process goes online, and which room it links to.
 */
export interface JoinedMarker {
  room: string;
  roomName: string;
  /**
   * Normalized code that admits to this room; lets a repeated join of the same
   * room through. join writes the code it presented, update_room refreshes it
   * after the owner rotates it.
   */
  code: string;
  member: string;
}
export const readMarker = (host: string, id: string) => readJson<JoinedMarker>(markerPath(host, id));
export const writeMarker = (host: string, id: string, marker: JoinedMarker) => writeJson(markerPath(host, id), marker);
export const deleteMarker = (host: string, id: string) => remove(markerPath(host, id));

/**
 * For hosts whose hooks are separate short-lived commands. Written by the
 * process holding the link, read by hooks and the monitor.
 */
export interface RunFile {
  unread: number;
  upTo: number;
  /** Names the unread state. A hook that injects `notice` reports this key back through `bridge.announced`. */
  key: string | null;
  /** What a turn-boundary hook should inject now: null when nothing is unread, or this state was already announced. */
  notice: string | null;
  /** Incremented each time the idle conversation should be woken; the monitor prints `wakeNotice` when it sees that. */
  wake: number;
  wakeNotice: string | null;
  wakeAt: number;
}
export const readRun = (id: string) => readJson<RunFile>(runPath(id));
export const writeRun = (id: string, run: RunFile) => writeJson(runPath(id), run);

/** Repository and branch, read from the environment. Attested: never supplied by the agent. */
export function readWorkspace(cwd: string): { repo: string; branch: string } {
  let directory = path.resolve(cwd);
  for (;;) {
    const git = path.join(directory, ".git");
    if (fs.existsSync(git)) {
      let head = "";
      try {
        const stat = fs.statSync(git);
        // A worktree's .git is a file pointing at the real directory.
        const gitDir = stat.isFile() ? path.resolve(directory, fs.readFileSync(git, "utf8").replace(/^gitdir:\s*/, "").trim()) : git;
        head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
      } catch { /* not readable: report the repository without a branch */ }
      return { repo: path.basename(directory).slice(0, 200), branch: head.startsWith("ref: refs/heads/") ? head.slice(16, 216) : "" };
    }
    const parent = path.dirname(directory);
    if (parent === directory) return { repo: path.basename(path.resolve(cwd)).slice(0, 200), branch: "" };
    directory = parent;
  }
}
