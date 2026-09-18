-- The room directory. Membership, messages and read state live in each room's Durable Object.
CREATE TABLE rooms (id TEXT PRIMARY KEY, owner_account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE INDEX rooms_owner ON rooms(owner_account_id);
-- List-page index only: which rooms hold a member of this account. The room is authoritative.
CREATE TABLE joined_rooms (account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, PRIMARY KEY (account_id, room_id));
