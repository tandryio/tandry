import {
  normalizeCode,
  type AccountId,
  type RoomId,
  type RoomSummary,
} from "@tandryio/protocol";

export interface RoomRow {
  id: RoomId;
  ownerAccountId: AccountId;
  name: string;
  description: string;
  code: string;
}

const COLUMNS =
  "id, owner_account_id AS ownerAccountId, name, description, code";
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;
const CODE_GROUP_LENGTH = 4;

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(
    bytes,
    (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
  ).join("");
}

export function displayCode(code: string): string {
  return `${code.slice(0, CODE_GROUP_LENGTH)}-${code.slice(CODE_GROUP_LENGTH)}`;
}

/** Accounts' rooms in D1: the catalogue and the joined index. Low-frequency writes. */
export function directory(db: D1Database) {
  function roomById(id: RoomId): Promise<RoomRow | null> {
    return db
      .prepare(`SELECT ${COLUMNS} FROM rooms WHERE id=?`)
      .bind(id)
      .first<RoomRow>();
  }

  return {
    roomById,

    roomByCode(code: string): Promise<RoomRow | null> {
      return db
        .prepare(`SELECT ${COLUMNS} FROM rooms WHERE code=?`)
        .bind(normalizeCode(code))
        .first<RoomRow>();
    },

    async ownedCount(owner: AccountId): Promise<number> {
      const row = await db
        .prepare("SELECT count(*) AS n FROM rooms WHERE owner_account_id=?")
        .bind(owner)
        .first<{ n: number }>();
      return row?.n ?? 0;
    },

    /** Idempotent on `id`: a retry returns the room the first attempt created. */
    async createRoom(
      owner: AccountId,
      room: { id: RoomId; name: string; description: string },
      now: number,
    ): Promise<RoomRow> {
      await db
        .prepare(
          `INSERT INTO rooms (id, owner_account_id, name, description, code, created_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO NOTHING`,
        )
        .bind(room.id, owner, room.name, room.description, newCode(), now)
        .run();
      return (await roomById(room.id))!;
    },

    async updateRoom(
      id: RoomId,
      patch: { name?: string; description?: string; rotateCode?: boolean },
    ): Promise<RoomRow> {
      await db
        .prepare(
          `UPDATE rooms SET
           name=coalesce(?,name),
           description=coalesce(?,description),
           code=coalesce(?,code)
         WHERE id=?`,
        )
        .bind(
          patch.name ?? null,
          patch.description ?? null,
          patch.rotateCode ? newCode() : null,
          id,
        )
        .run();
      return (await roomById(id))!;
    },

    /** Rooms the account owns, and rooms where it has a member. */
    async roomsOf(account: AccountId): Promise<RoomSummary[]> {
      const rows = await db
        .prepare(
          `SELECT ${COLUMNS} FROM rooms WHERE owner_account_id=?1
         UNION
         SELECT ${COLUMNS} FROM rooms
         WHERE id IN (SELECT room_id FROM joined_rooms WHERE account_id=?1)
         ORDER BY name`,
        )
        .bind(account)
        .all<RoomRow>();
      return rows.results.map((row) => summary(row, account));
    },

    /** Rewritten idempotently by join and leave. The room itself is authoritative. */
    async setJoined(
      account: AccountId,
      room: RoomId,
      joined: boolean,
    ): Promise<void> {
      const sql = joined
        ? "INSERT INTO joined_rooms (account_id, room_id) VALUES (?,?) ON CONFLICT DO NOTHING"
        : "DELETE FROM joined_rooms WHERE account_id=? AND room_id=?";
      await db.prepare(sql).bind(account, room).run();
    },
  };
}

export type Directory = ReturnType<typeof directory>;

export function summary(row: RoomRow, viewer: AccountId): RoomSummary {
  const owner = row.ownerAccountId === viewer;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    role: owner ? "owner" : "member",
    ...(owner ? { code: displayCode(row.code) } : {}),
  };
}
