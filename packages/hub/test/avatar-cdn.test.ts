import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { startLocalHub, type HubUnderTest, type TestAccount } from "../testing/start";

// A deployment that publishes the bucket on its own domain, where an object's
// key is the whole path, scope included. The base is never fetched here: what
// matters is what the Hub writes on the account, and that its own route
// resolves the same object.
const BASE = "https://pictures.test";

let hub: HubUnderTest;
before(async () => { hub = await startLocalHub({ vars: { PUBLIC_BASE_URL: BASE } }); });
after(async () => { await hub?.stop(); });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
function cookie(account: TestAccount) {
  const signature = createHmac("sha256", "only-for-local-tests-not-a-production-secret-1234").update(account.token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${account.token}.${signature}`)}`;
}
function storePicture(account: TestAccount) {
  return fetch(`${hub.baseUrl}/api/avatar`, {
    method: "POST", body: PNG,
    headers: { Origin: hub.baseUrl, "Content-Type": "image/png", Cookie: cookie(account) },
  });
}

test("a published bucket is what the account records, and the Worker addresses the same object", async () => {
  const alice = hub.accounts.alice;
  const { image } = (await (await storePicture(alice)).json()) as { image: string };
  assert.match(image, new RegExp(`^${BASE}/avatar/[0-9a-f]{32}$`));

  // Both bases name the same object: the key, scope included, is the path.
  const id = image.slice(`${BASE}/avatar/`.length);
  const served = await fetch(`${hub.baseUrl}/api/avatar/${id}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("Content-Type"), "image/png");
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), new Uint8Array(PNG));

  // Replacing still finds the object behind the published URL and drops it.
  const replaced = (await (await storePicture(alice)).json()) as { image: string };
  assert.notEqual(replaced.image, image);
  assert.equal((await fetch(`${hub.baseUrl}/api/avatar/${id}`)).status, 404);
});
