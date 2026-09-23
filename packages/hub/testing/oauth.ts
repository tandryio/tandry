import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { HubUnderTest, TestAccount } from "./start";

/** Exercises the public OAuth endpoints with synthetic accounts, including explicit consent. */
export async function connectorAuthorization(hub: HubUnderTest, account: TestAccount, scope = "tandry offline_access", signedIn = true) {
  const redirectUri = "https://connector.example.test/callback";
  const resource = `${hub.publicUrl}/mcp`;
  const jsonHeaders = { "Content-Type": "application/json" };
  const registration = await fetch(`${hub.baseUrl}/api/auth/oauth2/register`, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ client_name: "Test Connector", redirect_uris: [redirectUri], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "tandry offline_access" }),
  });
  const client = await registration.json() as { client_id: string };
  assert.equal(registration.status, 201, JSON.stringify(client));
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code",
    scope, resource, state: randomBytes(16).toString("hex"),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  const headers = { ...jsonHeaders, Authorization: `Bearer ${account.token}`, Origin: hub.publicUrl };
  const authorization = await fetch(`${hub.baseUrl}/api/auth/oauth2/authorize?${query}`, { headers: signedIn ? headers : jsonHeaders, redirect: "manual" });
  const redirect = authorization.headers.get("Location") ?? (await authorization.json() as { url: string }).url;
  const consentUrl = new URL(redirect, hub.baseUrl);
  assert.equal(consentUrl.pathname, "/connect", redirect);
  async function consent(accept: boolean, oauthQuery = consentUrl.search.slice(1)) {
    const response = await fetch(`${hub.baseUrl}/api/auth/oauth2/consent`, {
      method: "POST", headers, body: JSON.stringify({ accept, oauth_query: oauthQuery }),
    });
    const decision = await response.json() as { url: string };
    return { response, decision };
  }
  const exchange = (body: Record<string, string>) => fetch(`${hub.baseUrl}/api/auth/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.client_id, ...body }),
  });
  return { consent, exchange, clientId: client.client_id, resource, verifier, redirectUri, query, consentUrl };
}

export async function connectorGrant(hub: HubUnderTest, account: TestAccount, scope?: string, signedIn = true) {
  const flow = await connectorAuthorization(hub, account, scope, signedIn);
  const { response: consent, decision } = await flow.consent(true);
  assert.equal(consent.status, 200, JSON.stringify(decision));
  const callback = new URL(decision.url);
  assert.equal(callback.searchParams.get("state"), flow.query.get("state"));
  const code = callback.searchParams.get("code");
  assert.ok(code, callback.toString());
  const tokenBody = { grant_type: "authorization_code", code, code_verifier: flow.verifier, redirect_uri: flow.redirectUri, resource: flow.resource };
  const response = await flow.exchange(tokenBody);
  const tokens = await response.json() as { access_token: string; refresh_token: string };
  assert.equal(response.status, 200, JSON.stringify(tokens));
  assert.ok(tokens.access_token);
  return { ...tokens, ...flow, tokenBody };
}
