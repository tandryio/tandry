import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import {
  decodeResult, encodeCall, newId,
  type CallContext, type Input, type OperationName, type Output,
} from "@tandryio/protocol";
import { startLocalHub, type HubUnderTest, type TestAccount } from "../testing/start";

let hub: HubUnderTest;
before(async () => { hub = await startLocalHub(); });
after(async () => { await hub?.stop(); });

function cookie(account: TestAccount) {
  const signature = createHmac("sha256", "only-for-local-tests-not-a-production-secret-1234").update(account.token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${account.token}.${signature}`)}`;
}
async function call<K extends OperationName>(account: TestAccount, op: K, input: Input<K>, context: CallContext = {}): Promise<Output<K>> {
  const request = encodeCall(op, context, input);
  const response = await fetch(hub.baseUrl + request.path, {
    ...request, headers: { ...request.headers, Cookie: cookie(account), Origin: hub.baseUrl },
  });
  return decodeResult(op, response.status, await response.json());
}
function updateUser(account: TestAccount, body: Record<string, unknown>) {
  return fetch(`${hub.baseUrl}/api/auth/update-user`, {
    method: "POST", body: JSON.stringify(body),
    headers: { Origin: hub.baseUrl, "Content-Type": "application/json", Cookie: cookie(account) },
  });
}
async function room() {
  const { alice, bob } = hub.accounts;
  const created = await call(alice, "new_room", { id: newId("r"), name: "Pictures", description: "Who sees what" });
  const context = { room: created.id };
  for (const [account, host] of [[alice, "codex"], [bob, "claude"]] as const)
    await call(account, "join", { code: created.code, intro: "Here", name: "main", workspace: { repo: "tandry", branch: "main" } },
      { ...context, conversation: { host, hostConversationId: crypto.randomUUID() } });
  return context;
}

test("the profile update cannot choose a picture; only an upload or a provider writes one", async () => {
  const { alice, bob } = hub.accounts;
  const context = await room();
  assert.equal((await updateUser(bob, { image: "https://tracker.example/pixel.png" })).status, 400);
  assert.equal((await updateUser(bob, { name: "Bob", image: `data:image/webp;base64,${"A".repeat(4000)}` })).status, 400);
  assert.equal((await updateUser(bob, { name: "Bob" })).status, 200);
  const { members } = await call(alice, "members", {}, context);
  assert.equal(members.find((member) => member.address === "bob/main")?.avatar, undefined);
});
