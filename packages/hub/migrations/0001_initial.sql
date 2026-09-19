-- Initial public schema for the first release.

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
CREATE TABLE usageWindow (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resetsAt INTEGER NOT NULL);

-- The room directory. Membership, messages and read state live in each room's Durable Object.
CREATE TABLE rooms (id TEXT PRIMARY KEY, owner_account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE INDEX rooms_owner ON rooms(owner_account_id);
-- List-page index only: which rooms hold a member of this account. The room is authoritative.
CREATE TABLE joined_rooms (account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, PRIMARY KEY (account_id, room_id));

-- Better Auth 1.7.4 JWT and OAuth provider tables.

CREATE TABLE "jwks" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "publicKey" TEXT NOT NULL,
  "privateKey" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "expiresAt" INTEGER,
  "alg" TEXT,
  "crv" TEXT
);

CREATE TABLE "oauthClient" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL UNIQUE,
  "clientSecret" TEXT,
  "clientDiscoveryId" TEXT,
  "disabled" INTEGER,
  "skipConsent" INTEGER,
  "enableEndSession" INTEGER,
  "subjectType" TEXT,
  "scopes" TEXT,
  "clientCredentialsScopes" TEXT,
  "userId" TEXT REFERENCES "user"("id") ON DELETE CASCADE,
  "createdAt" INTEGER,
  "updatedAt" INTEGER,
  "name" TEXT,
  "uri" TEXT,
  "icon" TEXT,
  "contacts" TEXT,
  "tos" TEXT,
  "policy" TEXT,
  "softwareId" TEXT,
  "softwareVersion" TEXT,
  "softwareStatement" TEXT,
  "redirectUris" TEXT NOT NULL,
  "postLogoutRedirectUris" TEXT,
  "backchannelLogoutUri" TEXT,
  "backchannelLogoutSessionRequired" INTEGER,
  "tokenEndpointAuthMethod" TEXT,
  "applicationType" TEXT,
  "jwks" TEXT,
  "jwksUri" TEXT,
  "grantTypes" TEXT,
  "responseTypes" TEXT,
  "requirePKCE" INTEGER,
  "dpopBoundAccessTokens" INTEGER,
  "referenceId" TEXT,
  "metadata" TEXT
);

CREATE INDEX "oauthClient_userId" ON "oauthClient" ("userId");

CREATE TABLE "oauthResource" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "accessTokenTtl" INTEGER,
  "refreshTokenTtl" INTEGER,
  "signingAlgorithm" TEXT,
  "signingKeyId" TEXT,
  "allowedScopes" TEXT,
  "customClaims" TEXT,
  "dpopBoundAccessTokensRequired" INTEGER,
  "disabled" INTEGER,
  "createdAt" INTEGER,
  "updatedAt" INTEGER,
  "policyVersion" INTEGER,
  "metadata" TEXT
);

CREATE TABLE "oauthClientResource" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "resourceId" TEXT NOT NULL REFERENCES "oauthResource"("identifier") ON DELETE CASCADE,
  "metadata" TEXT,
  "createdAt" INTEGER
);

CREATE INDEX "oauthClientResource_clientId" ON "oauthClientResource" ("clientId");

CREATE INDEX "oauthClientResource_resourceId" ON "oauthClientResource" ("resourceId");

CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId" ON "oauthClientResource" ("clientId", "resourceId");

CREATE TABLE "oauthRefreshToken" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "sessionId" TEXT REFERENCES "session"("id") ON DELETE SET NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "referenceId" TEXT,
  "authorizationCodeId" TEXT,
  "resources" TEXT,
  "requestedUserInfoClaims" TEXT,
  "expiresAt" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "revoked" INTEGER,
  "rotatedAt" INTEGER,
  "rotationReplayResponse" TEXT,
  "rotationReplayExpiresAt" INTEGER,
  "authTime" INTEGER,
  "confirmation" TEXT,
  "scopes" TEXT NOT NULL
);

CREATE INDEX "oauthRefreshToken_clientId" ON "oauthRefreshToken" ("clientId");

CREATE INDEX "oauthRefreshToken_sessionId" ON "oauthRefreshToken" ("sessionId");

CREATE INDEX "oauthRefreshToken_userId" ON "oauthRefreshToken" ("userId");

CREATE INDEX "oauthRefreshToken_authorizationCodeId" ON "oauthRefreshToken" ("authorizationCodeId");

CREATE TABLE "oauthAccessToken" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "sessionId" TEXT REFERENCES "session"("id") ON DELETE SET NULL,
  "userId" TEXT REFERENCES "user"("id") ON DELETE CASCADE,
  "referenceId" TEXT,
  "authorizationCodeId" TEXT,
  "resources" TEXT,
  "requestedUserInfoClaims" TEXT,
  "refreshId" TEXT REFERENCES "oauthRefreshToken"("id") ON DELETE CASCADE,
  "expiresAt" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "revoked" INTEGER,
  "confirmation" TEXT,
  "scopes" TEXT NOT NULL
);

CREATE INDEX "oauthAccessToken_clientId" ON "oauthAccessToken" ("clientId");

CREATE INDEX "oauthAccessToken_sessionId" ON "oauthAccessToken" ("sessionId");

CREATE INDEX "oauthAccessToken_userId" ON "oauthAccessToken" ("userId");

CREATE INDEX "oauthAccessToken_authorizationCodeId" ON "oauthAccessToken" ("authorizationCodeId");

CREATE INDEX "oauthAccessToken_refreshId" ON "oauthAccessToken" ("refreshId");

CREATE TABLE "oauthConsent" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "userId" TEXT REFERENCES "user"("id") ON DELETE CASCADE,
  "referenceId" TEXT,
  "resources" TEXT,
  "requestedUserInfoClaims" TEXT,
  "scopes" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);

CREATE INDEX "oauthConsent_clientId" ON "oauthConsent" ("clientId");

CREATE INDEX "oauthConsent_userId" ON "oauthConsent" ("userId");

CREATE TABLE "oauthClientAssertion" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "expiresAt" INTEGER NOT NULL
);
