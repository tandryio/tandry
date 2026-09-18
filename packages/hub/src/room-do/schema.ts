import type { AccountId, HostKind, RoomId } from "@tandryio/protocol";

/** One row is one continuous stay. After left_at is written the row never changes again. */
export interface MemberRow {
  id: string;
  account_id: AccountId;
  /** Snapshot at join. Handles cannot be renamed once claimed. */
  account_handle: string;
  name: string;
  intro: string;
  host: HostKind;
  host_conversation_id: string;
  workspace_repo: string;
  workspace_branch: string;
  /** Moves only by reading. */
  read_seq: number;
  joined_at: number;
  left_at: number | null;
  last_active_at: number;
  bucket_tokens: number;
  bucket_at: number;
  [column: string]: SqlStorageValue;
}

export interface MessageRow {
  seq: number;
  id: string;
  from_member: string;
  visibility: "room" | "dm";
  /** `,id,id,` — member IDs fixed at send time, delimited so instr() can match one. */
  to_members: string;
  to_room: number;
  reply_to: string | null;
  kind: "text" | "intro";
  body: string;
  meta: string | null;
  created_at: number;
  deleted_at: number | null;
  [column: string]: SqlStorageValue;
}

/** What the room knows about itself without a request: who owns it and how long it keeps messages. */
export interface RoomMeta {
  roomId: RoomId;
  ownerAccountId: AccountId;
  retentionDays: number | "unlimited";
}

/** Idempotent. Later versions add guarded ALTERs below and bump RoomMeta.schema. */
export function migrate(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS member (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, account_handle TEXT NOT NULL, name TEXT NOT NULL, intro TEXT NOT NULL,
      host TEXT NOT NULL, host_conversation_id TEXT NOT NULL, workspace_repo TEXT NOT NULL, workspace_branch TEXT NOT NULL,
      read_seq INTEGER NOT NULL, joined_at INTEGER NOT NULL, left_at INTEGER, last_active_at INTEGER NOT NULL,
      bucket_tokens REAL NOT NULL, bucket_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS member_address ON member(account_handle, name) WHERE left_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS member_conversation ON member(account_id, host, host_conversation_id) WHERE left_at IS NULL;
    CREATE TABLE IF NOT EXISTS message (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, from_member TEXT NOT NULL, visibility TEXT NOT NULL,
      to_members TEXT NOT NULL, to_room INTEGER NOT NULL, reply_to TEXT, kind TEXT NOT NULL, body TEXT NOT NULL, meta TEXT,
      created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS message_from ON message(from_member, seq);
    CREATE INDEX IF NOT EXISTS message_created ON message(created_at);
  `);
  const columns = sql.exec<{ name: string }>("PRAGMA table_info(message)").toArray();
  if (!columns.some((column) => column.name === "deleted_at")) sql.exec("ALTER TABLE message ADD COLUMN deleted_at INTEGER");
}

export function packMembers(ids: readonly string[]): string {
  return ids.length ? `,${ids.join(",")},` : "";
}

export function unpackMembers(packed: string): string[] {
  return packed ? packed.slice(1, -1).split(",") : [];
}
