import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { tools } from "@tandryio/protocol";
import { startLocalHub, type HubUnderTest } from "../testing/start";
import { connectorAuthorization, connectorGrant } from "../testing/oauth";
import { mcpRequest, mcpTool } from "../testing/mcp";

let hub: HubUnderTest;
before(async () => { hub = await startLocalHub(); });
after(async () => { await hub?.stop(); });

test("MCP challenges use the public HTTPS origin behind an HTTP proxy", async () => {
  const local = await startLocalHub({ vars: { BETTER_AUTH_URL: "https://connector.example.test" } });
  try {
    const response = await fetch(`${local.baseUrl}/mcp`, { method: "POST", headers: { "X-Forwarded-Host": "attacker.example.test" } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("WWW-Authenticate"), 'Bearer resource_metadata="https://connector.example.test/.well-known/oauth-protected-resource/mcp", scope="tandry"');
    await response.body?.cancel();
  } finally {
    await local.stop();
  }
});

test("MCP verifies tokens without fetching its own public origin, and keeps DPoP binding", async () => {
  // In production the public origin routes through the website Worker; the Hub
  // must verify the tokens it signed without a network hop back to itself.
  const local = await startLocalHub({ vars: { BETTER_AUTH_URL: "https://connector.example.test" } });
  try {
    const grant = await connectorGrant(local, local.accounts.alice);
    const discovered = await mcpRequest(local, grant.access_token, "server/discover");
    assert.deepEqual(discovered.supportedVersions, ["2026-07-28"]);
    assert.match((await mcpTool(local, grant.access_token, "status")).text, /alice/);
    const asDpop = await fetch(`${local.baseUrl}/mcp`, { method: "POST", headers: { Authorization: `DPoP ${grant.access_token}` } });
    assert.equal(asDpop.status, 401);
    assert.match(asDpop.headers.get("WWW-Authenticate")!, /^DPoP .*error="invalid_token"/);
    await asDpop.body?.cancel();
  } finally {
    await local.stop();
  }
});

test("discovery and challenges point to this resource; sessions cannot authorize MCP", async () => {
  const metadata = await fetch(`${hub.baseUrl}/.well-known/oauth-protected-resource/mcp`).then((r) => r.json()) as Record<string, unknown>;
  assert.equal(metadata.resource, `${hub.baseUrl}/mcp`);
  const issuer = await fetch(`${hub.baseUrl}/.well-known/oauth-authorization-server/api/auth`).then((r) => r.json()) as Record<string, unknown>;
  assert.deepEqual(issuer.code_challenge_methods_supported, ["S256"]);
  for (const token of ["", hub.accounts.alice.token, "invalid.jwt.token"]) {
    const response = await fetch(`${hub.baseUrl}/mcp`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal(response.status, 401);
    if (!token) assert.match(response.headers.get("WWW-Authenticate")!, /oauth-protected-resource/);
    await response.body?.cancel();
  }
  assert.equal((await fetch(`${hub.baseUrl}/mcp`)).status, 405);
});

test("OAuth works in workerd across sign-in, consent, PKCE, refresh and revocation", async () => {
  const grant = await connectorGrant(hub, hub.accounts.alice, undefined, false);
  const list = await mcpRequest(hub, grant.access_token, "tools/list");
  assert.deepEqual(list.tools.map((tool: { name: string }) => tool.name), Object.values(tools).filter((tool) => tool.connector).map((tool) => tool.name));
  const annotations = Object.fromEntries(list.tools.map((tool: { name: string; annotations: unknown }) => [tool.name, tool.annotations]));
  assert.deepEqual(annotations.history, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
  assert.deepEqual(annotations.inbox, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
  assert.equal(annotations.join.destructiveHint, true);
  assert.equal(annotations.leave.destructiveHint, true);
  assert.match((await mcpTool(hub, grant.access_token, "status")).text, /alice/);
  const legacy = await mcpRequest(hub, grant.access_token, "tools/list", {}, false);
  assert.deepEqual(legacy.tools.map((tool: { name: string }) => tool.name), list.tools.map((tool: { name: string }) => tool.name));
  const refreshed = await grant.exchange({ grant_type: "refresh_token", refresh_token: grant.refresh_token, resource: grant.resource });
  const tokens = await refreshed.json() as { access_token: string; refresh_token: string };
  assert.equal(refreshed.status, 200, JSON.stringify(tokens));
  assert.match((await mcpTool(hub, tokens.access_token, "status")).text, /alice/);
  const revoked = await fetch(`${hub.baseUrl}/api/auth/oauth2/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: grant.clientId, token: tokens.refresh_token, token_type_hint: "refresh_token" }) });
  assert.equal(revoked.status, 200);
  await revoked.body?.cancel();
  assert.equal((await grant.exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, resource: grant.resource })).status, 400);
  const replay = await grant.exchange(grant.tokenBody);
  assert.equal(replay.status, 400);
  await replay.body?.cancel();
});

test("consent may be denied; signed authorization parameters cannot be changed", async () => {
  const flow = await connectorAuthorization(hub, hub.accounts.alice);
  const tampered = new URLSearchParams(flow.consentUrl.search);
  tampered.set("redirect_uri", "https://attacker.example.test/callback");
  assert.equal((await flow.consent(true, tampered.toString())).response.status, 400);
  const { response, decision } = await flow.consent(false);
  assert.equal(response.status, 200);
  assert.equal(new URL(decision.url).searchParams.get("error"), "access_denied");
});

test("the token endpoint rejects the wrong PKCE verifier and resource", async () => {
  for (const changed of ["code_verifier", "resource"] as const) {
    const flow = await connectorAuthorization(hub, hub.accounts.alice);
    const { decision } = await flow.consent(true);
    const code = new URL(decision.url).searchParams.get("code")!;
    const response = await flow.exchange({ grant_type: "authorization_code", code, redirect_uri: flow.redirectUri,
      code_verifier: flow.verifier, resource: flow.resource, [changed]: changed === "resource" ? "https://other.example.test/mcp" : "wrong".repeat(10) });
    assert.equal(response.status, changed === "code_verifier" ? 401 : 400, await response.text());
  }
});

test("MCP rejects a signed token without its scope and a token with forged account claims", async () => {
  const noScope = await connectorGrant(hub, hub.accounts.alice, "offline_access");
  const denied = await fetch(`${hub.baseUrl}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${noScope.access_token}` } });
  assert.equal(denied.status, 403);
  assert.match(denied.headers.get("WWW-Authenticate")!, /insufficient_scope/);
  await denied.body?.cancel();
  const parts = noScope.access_token.split(".");
  const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
  claims.sub = hub.accounts.bob.id;
  parts[1] = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const forged = await fetch(`${hub.baseUrl}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${parts.join(".")}` } });
  assert.equal(forged.status, 401);
  await forged.body?.cancel();
});
