import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { startLocalHub, type HubUnderTest, type TestAccount } from "../testing/start";

// A deployment that serves pictures from somewhere other than this Worker's own
// path. The base is never fetched here: what matters is what the Hub writes on
// the account, and that its own route still resolves the same key.
const BASE = "http://localhost:9/pictures";

let hub: HubUnderTest;
before(async () => { hub = await startLocalHub({ vars: { AVATAR_BASE_URL: BASE } }); });
after(async () => { await hub?.stop(); });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
function cookie(account: TestAccount) {
  const signature = createHmac("sha256", "only-for-local-tests-not-a-production-secret-1234").update(account.token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${account.token}.${signature}`)}`;
}
function storePicture(account: TestAccount) {
  return fetch(`${hub.baseUrl}/api/avatars`, {
    method: "POST", body: PNG,
    headers: { Origin: hub.baseUrl, "Content-Type": "image/png", Cookie: cookie(account) },
  });
}

test("a configured prefix is what the account records, and this Worker still serves the key", async () => {
  const alice = hub.accounts.alice;
  const { image } = (await (await storePicture(alice)).json()) as { image: string };
  assert.match(image, new RegExp(`^${BASE}/[0-9a-f]{32}$`));

  // The Worker's own path stays: rows written before a prefix existed, and this
  // one, open through it either way.
  const key = image.slice(`${BASE}/`.length);
  const served = await fetch(`${hub.baseUrl}/api/avatars/${key}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("Content-Type"), "image/png");
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), new Uint8Array(PNG));

  // Replacing still finds the object behind the prefixed URL and drops it.
  const replaced = (await (await storePicture(alice)).json()) as { image: string };
  assert.notEqual(replaced.image, image);
  assert.equal((await fetch(`${hub.baseUrl}/api/avatars/${key}`)).status, 404);
});
