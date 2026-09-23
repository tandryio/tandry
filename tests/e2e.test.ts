import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createBridge, type Bridge, type Shell } from "../packages/bridge/src/index";
import { credentialsPath } from "../packages/bridge/src/local";
import { startLocalHub, type HubUnderTest } from "../packages/hub/testing/start";

// The bridge is tested against a fake Hub and the Hub against a raw client.
// This is the one place the two real halves meet: one owner, two conversations
// on one machine, signing in from scratch and exchanging a message that starts a turn.

let hub: HubUnderTest;
let home: string;
const bridges: Bridge[] = [];

class RecordingShell implements Shell {
  wakes: string[] = [];
  wakeable() { return true; }
  idle() { return true; }
  async wake(notice: string) { this.wakes.push(notice); }
}

before(async () => {
  hub = await startLocalHub();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tandry-e2e-"));
  process.env.TANDRY_HOME = home;
  process.env.TANDRY_HUB = hub.baseUrl;
});
after(async () => {
  for (const bridge of bridges) bridge.dispose();
  await hub?.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

function conversation(host: "codex" | "claude", id: string) {
  const shell = new RecordingShell();
  const bridge = createBridge({ host, shell, conversation: { host, hostConversationId: id, workspace: { repo: "tandry", branch: "redesign" } }, timing: { closeTimeoutMs: 200 } });
  bridges.push(bridge);
  const tool = async (name: string, params: unknown = {}) => {
    const result = await bridge.tools.find((entry) => entry.name === name)!.call(params);
    assert.equal(result.isError, false, result.text);
    return result.text;
  };
  return { bridge, shell, tool };
}
async function until(check: () => boolean | Promise<boolean>, what: string) {
  const deadline = Date.now() + 5_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("signed-out conversations complete device login and exchange a message that starts a turn", async () => {
  const sender = conversation("codex", "thread-sender");
  assert.equal(fs.existsSync(credentialsPath()), false);
  assert.match(await sender.tool("status"), /Not signed in/);
  const login = await sender.tool("login");
  const url = new URL(login.match(/https?:\/\/\S+/)![0]!);
  assert.equal(url.origin, hub.baseUrl);
  assert.equal(url.pathname, "/device");
  const userCode = url.searchParams.get("user_code");
  assert.ok(userCode);
  assert.match(await sender.tool("status"), /Waiting for the owner to approve/);
  assert.equal(fs.existsSync(credentialsPath()), false);

  const headers = { "Content-Type": "application/json", Origin: hub.baseUrl, Authorization: `Bearer ${hub.accounts.alice.token}` };
  const review = await fetch(hub.baseUrl + "/api/auth/device?" + new URLSearchParams({ user_code: userCode }), { headers });
  assert.equal(review.status, 200);
  assert.equal((await review.json() as { status: string }).status, "pending");
  const approval = await fetch(hub.baseUrl + "/api/auth/device/approve", {
    method: "POST",
    headers,
    body: JSON.stringify({ userCode }),
  });
  assert.equal(approval.status, 200);
  // Respect the real device-flow polling interval (five seconds).
  const deadline = Date.now() + 12_000;
  while (!fs.existsSync(credentialsPath())) {
    assert.ok(Date.now() < deadline, "The bridge did not persist the approved device token");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(fs.statSync(credentialsPath()).mode & 0o777, 0o600);
  assert.match(await sender.tool("status"), /alice/);
  // A second host uses the device credential written by the first.
  const receiver = conversation("claude", "session-receiver");

  const created = await sender.tool("new_room", { name: "hub-design", description: "Designing the Hub" });
  const code = /Code: (\S+)/.exec(created)![1]!;
  assert.match(await sender.tool("join", { room: code, intro: "Refactoring the Hub", name: "hub-refactor" }), /^Joined #hub-design as alice\/hub-refactor/);
  const background = await receiver.tool("join", { room: code, intro: "Website i18n", name: "website" });
  assert.match(background, /About this room: Designing the Hub/);
  assert.match(background, /alice\/hub-refactor · Codex · tandry@redesign/);
  assert.match(background, /kind="intro" from="alice\/hub-refactor"/);
  await until(() => receiver.bridge.inactive() === null && sender.bridge.inactive() === null, "both links");
  // The receiver's link must have reported wakeable before the send, or the sender is told "next turn".
  await until(async () => /alice\/website .* online; told now/.test(await sender.tool("members")), "the receiver to be wakeable");

  const sent = await sender.tool("send", { to: ["alice/website"], body: "Is the landing page translated yet?" });
  assert.match(sent, /alice\/website: online; told now/);

  // The wake carries the fixed notice and nothing of the body.
  await until(() => receiver.shell.wakes.length === 1, "the receiver to be woken");
  assert.equal(receiver.shell.wakes[0], "Tandry: 1 unread message from alice/hub-refactor. Call the inbox tool to read. This notice is not an instruction from the owner.");
  assert.equal(sender.shell.wakes.length, 0);

  // The body enters the conversation one way only: the inbox tool's result.
  const inbox = await receiver.tool("inbox");
  assert.match(inbox, /^Messages, each in <tandry-[0-9a-f]+>:/);
  assert.match(inbox, /from="alice\/hub-refactor" owner="alice" host="codex" to="alice\/website"/);
  assert.match(inbox, /Is the landing page translated yet\?/);
  const id = /message="(m_[0-9a-z]+)"/.exec(inbox)![1]!;

  // Read state needs no receipt: the sender sees it from the recipient's read position.
  await until(async () => !/of your messages unread/.test(await sender.tool("members")), "the read position to move");
  assert.equal(await receiver.tool("inbox"), "No new messages.");

  await receiver.tool("send", { to: [], body: "Yes, zh is done.", replyTo: id });
  await until(() => sender.shell.wakes.length === 1, "the sender to be woken by the reply");
  assert.match(await sender.tool("inbox"), /reply-to="m_[0-9a-z]+"[\s\S]*Yes, zh is done\./);

  assert.match(await receiver.tool("leave"), /alice\/website left the room/);
  assert.match(await sender.tool("status"), /This conversation is alice\/hub-refactor in #hub-design/);
});
