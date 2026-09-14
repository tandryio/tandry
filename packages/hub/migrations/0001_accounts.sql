CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, handle TEXT COLLATE NOCASE UNIQUE CHECK (handle IS NULL OR (length(handle) BETWEEN 3 AND 24 AND handle = lower(handle) AND handle NOT GLOB '*[^a-z0-9_]*' AND substr(handle,1,1) GLOB '[a-z]')), email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, expiresAt INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT);
CREATE INDEX session_user ON session(userId);
CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, accessToken TEXT, refreshToken TEXT, idToken TEXT, scope TEXT, password TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX account_user ON account(userId);
CREATE UNIQUE INDEX account_provider ON account(providerId, accountId);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX verification_identifier ON verification(identifier);
CREATE TABLE deviceCode (id TEXT PRIMARY KEY, deviceCode TEXT NOT NULL UNIQUE, userCode TEXT NOT NULL UNIQUE, userId TEXT, clientId TEXT, scope TEXT, status TEXT NOT NULL, expiresAt INTEGER NOT NULL, lastPolledAt INTEGER, pollingInterval INTEGER);
CREATE TABLE rateLimit (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL, lastRequest INTEGER NOT NULL);
-- Directory only. Room membership and authorization are authoritative inside the room DO.
CREATE TABLE roomDirectory (code TEXT NOT NULL, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, name TEXT NOT NULL, createdAt INTEGER NOT NULL, PRIMARY KEY (userId, code));
CREATE TABLE usageWindow (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resetsAt INTEGER NOT NULL);
