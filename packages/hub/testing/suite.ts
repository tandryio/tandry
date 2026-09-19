import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import {
  CLOSE_CODES, HEADERS, LINK_PATH, TandryError, contextHeaders, decodeResult, encodeCall, newId,
  type ConversationKey, type Frame, type Input, type OperationName, type Output, type RoomId,
} from "@tandryio/protocol";
import type { HubUnderTest, TestAccount } from "./start";
import { connectorGrant } from "./oauth";
import { mcpTool } from "./mcp";

export type { HubUnderTest, StartOptions, TestAccount } from "./start";
export { startLocalHub } from "./start";

// Black box: everything below goes through the HTTP binding and the room link,
// using only the protocol package. Any composition of the Hub can run it.

interface Actor {
  account: TestAccount;
  room?: RoomId;
  conversation?: ConversationKey;
}

export function runHubSuite(start: () => Promise<HubUnderTest>): void {
  let hub: HubUnderTest;
  before(async () => { hub = await start(); });
  after(async () => { await hub?.stop(); });

  async function call<K extends OperationName>(actor: Actor, op: K, input: Input<K>, protocol?: number): Promise<Output<K>> {
    const request = encodeCall(op, { token: actor.account.token, room: actor.room, conversation: actor.conversation }, input);
    const response = await fetch(hub.baseUrl + request.path, {
      method: request.method, body: request.body,
      headers: { ...request.headers, ...(protocol === undefined ? {} : { [HEADERS.protocol]: String(protocol) }) },
    });
    return decodeResult(op, response.status, await response.json().catch(() => null));
  }

  const fails = (code: string) => (error: unknown) => error instanceof TandryError && error.code === code;
  const conversation = (host: ConversationKey["host"] = "codex"): ConversationKey => ({ host, hostConversationId: crypto.randomUUID() });
  const text = (actor: Actor, to: Input<"send">["to"], body: string, extra: Partial<Input<"send">> = {}) =>
    call(actor, "send", { id: newId("m"), to, body, ...extra });

  async function newRoom(owner: TestAccount = hub.accounts.alice) {
    return call({ account: owner }, "new_room", { id: newId("r"), name: "hub-design", description: "Designing the Hub" });
  }

  async function joined(account: TestAccount, code: string, name: string, extra: Partial<Input<"join">> = {}, key = conversation()): Promise<Actor & { address: string }> {
    const result = await call({ account, conversation: key }, "join", { code, intro: `Working on ${name}`, name, workspace: { repo: "tandry", branch: "main" }, ...extra });
    return { account, room: result.room.id, conversation: key, address: result.member };
  }

  function link(actor: Actor) {
    const socket = new WebSocket(hub.baseUrl.replace("http", "ws") + LINK_PATH, {
      headers: contextHeaders({ token: actor.account.token, room: actor.room, conversation: actor.conversation }),
      // Local workerd keeps the TCP connection for ten seconds after a Hub-initiated close.
      // ws supports closeTimeout; its type declarations do not list it yet.
      closeTimeout: 300,
    } as WebSocket.ClientOptions);
    const frames: Frame[] = [];
    const waiters: (() => void)[] = [];
    socket.on("message", (data) => { frames.push(JSON.parse(String(data))); waiters.splice(0).forEach((wake) => wake()); });
    const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
    const rejected = new Promise<number>((resolve) => socket.on("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0)));
    socket.on("error", () => {});
    return {
      frames, closed, rejected,
      opened: new Promise<void>((resolve, reject) => { socket.on("open", () => resolve()); socket.on("error", reject); }),
      state: (wakeable: boolean) => socket.send(JSON.stringify({ t: "state", wakeable })),
      async notify(count: number) {
        const deadline = Date.now() + 5_000;
        while (frames.filter((frame) => frame.t === "notify").length < count) {
          if (Date.now() > deadline) throw new Error(`Expected ${count} notify frames, got ${JSON.stringify(frames)}`);
          await Promise.race([new Promise<void>((resolve) => waiters.push(resolve)), new Promise((resolve) => setTimeout(resolve, 100))]);
        }
        return frames.filter((frame) => frame.t === "notify")[count - 1] as Extract<Frame, { t: "notify" }>;
      },
      close: () => socket.close(),
    };
  }
  const quiet = () => new Promise((resolve) => setTimeout(resolve, 300));

  test("pull chats have separate handles; credentials, not handles, authorize access", async () => {
    const room = await newRoom();
    const grant = await connectorGrant(hub, hub.accounts.alice);
    const bob = await connectorGrant(hub, hub.accounts.bob);
    const tool = (name: string, args: Record<string, unknown> = {}, token = grant.access_token) => mcpTool(hub, token, name, args);
    const join = async (name: string) => {
      const result = await tool("join", { room: room.code, name, intro: `Working on ${name}` });
      assert.equal(result.isError, false, result.text);
      return result.text.match(/^Conversation: (\S+)/)![1]!;
    };
    const a = await join("planning");
    const b = await join("research");
    assert.notEqual(a, b);
    const sender = await joined(hub.accounts.bob, room.code, "sender");
    await text(sender, ["alice/planning"], "Only planning sees this", { dm: true });
    assert.doesNotMatch((await tool("inbox", { conversation: b })).text, /Only planning/);
    assert.doesNotMatch((await tool("history", { conversation: b })).text, /Only planning/);
    assert.equal((await tool("inbox", { conversation: a }, bob.access_token)).isError, true);
    assert.equal((await tool("inbox", { conversation: "broken" })).isError, true);
    assert.match((await tool("inbox", { conversation: a })).text, /Only planning sees this/);
    assert.doesNotMatch((await tool("inbox", { conversation: a })).text, /Only planning/);
    assert.match((await tool("history", { conversation: a })).text, /Only planning sees this/);
    assert.equal((await call(sender, "members", {})).members.find((member) => member.address === "alice/planning")!.unreadFromMe, 0);
  });

  test("concurrent pull inbox calls consume a batch once; continuation retains unread and invalidates the old handle", async () => {
    const room = await newRoom();
    const { access_token: token } = await connectorGrant(hub, hub.accounts.alice);
    const tool = (name: string, args: Record<string, unknown>) => mcpTool(hub, token, name, args);
    const first = await tool("join", { room: room.code, name: "pull", intro: "Planning" });
    const conversation = first.text.match(/^Conversation: (\S+)/)![1]!;
    const sender = await joined(hub.accounts.bob, room.code, "sender");
    await text(sender, ["alice/pull"], "Concurrent batch");
    const reads = await Promise.all(Array.from({ length: 6 }, () => tool("inbox", { conversation })));
    assert.ok(reads.every((read) => !read.isError));
    assert.equal(reads.filter((read) => read.text.includes("Concurrent batch")).length, 1);
    await text(sender, ["alice/pull"], "Follows continuation");
    const resumed = await tool("join", { room: room.code, as: "pull", intro: "Continuing" });
    const next = resumed.text.match(/^Conversation: (\S+)/)![1]!;
    assert.notEqual(next, conversation);
    assert.equal((await tool("inbox", { conversation })).isError, true);
    assert.match((await tool("inbox", { conversation: next })).text, /Follows continuation/);
    assert.equal((await tool("send", { conversation: next, to: [sender.address], body: "Reply from web" })).isError, false);
    assert.ok((await call(sender, "inbox", {})).messages.some((message) => message.body === "Reply from web"));
    assert.equal((await tool("leave", { conversation: next })).isError, false);
    assert.equal((await tool("history", { conversation: next })).isError, true);
  });

  // ---- accounts and rooms --------------------------------------------------

  test("operations need a credential, a supported protocol and valid input", async () => {
    const stranger: Actor = { account: { id: "x", handle: "x", token: "not-a-session-token-at-all-0000000000" } };
    await assert.rejects(call(stranger, "status", {}), fails("not_logged_in"));
    await assert.rejects(call({ account: hub.accounts.alice }, "status", {}, 0), fails("upgrade_required"));
    await assert.rejects(call({ account: hub.accounts.alice }, "new_room", { id: "nope" as RoomId, name: "x", description: "" }), fails("invalid_input"));
  });

  test("new_room is idempotent on its ID, and rooms need an account handle", async () => {
    const input = { id: newId("r"), name: "retry", description: "" };
    const first = await call({ account: hub.accounts.alice }, "new_room", input);
    assert.deepEqual(await call({ account: hub.accounts.alice }, "new_room", input), first);
    await assert.rejects(call({ account: hub.accounts.bob }, "new_room", input), fails("invalid_input"));
    await assert.rejects(call({ account: hub.accounts.nohandle }, "new_room", { ...input, id: newId("r") }), fails("handle_required"));
    const { rooms } = await call({ account: hub.accounts.alice }, "status", {});
    assert.equal(rooms.filter((room) => room.id === first.id).length, 1);
    assert.equal(rooms.find((room) => room.id === first.id)?.code, first.code);
  });

  test("only the owner may edit a room; code rotation changes how new members join", async () => {
    const room = await newRoom();
    assert.match(room.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    const owner: Actor = { account: hub.accounts.alice };
    await assert.rejects(call({ account: hub.accounts.bob }, "update_room", { room: room.id, name: "stolen" }), fails("forbidden"));

    const renamed = await call(owner, "update_room", { room: room.id, name: "renamed", description: "" });
    assert.deepEqual(renamed, { id: room.id, name: "renamed", description: "", role: "owner", code: room.code });
    const rotated = await call(owner, "update_room", { room: room.id, rotateCode: true });
    assert.equal(rotated.name, "renamed");
    assert.equal(rotated.description, "");
    assert.ok(rotated.code && rotated.code !== room.code);
    await assert.rejects(joined(hub.accounts.bob, room.code, "old-code"), fails("no_such_room"));
    await joined(hub.accounts.bob, rotated.code.toLowerCase().replace("-", ""), "new-code");
  });

  test("join creates a member, posts its intro, and returns the room background", async () => {
    const room = await newRoom();
    await assert.rejects(joined(hub.accounts.bob, "ZZZZ-ZZZZ", "lost"), fails("no_such_room"));
    const alice = await joined(hub.accounts.alice, room.code, "hub-refactor");
    assert.equal(alice.address, "alice/hub-refactor");
    const key = conversation("claude");
    const bob = await call({ account: hub.accounts.bob, conversation: key }, "join", { code: room.code.toLowerCase(), intro: "Website i18n", name: "website", workspace: { repo: "tandry", branch: "i18n" } });
    assert.equal(bob.outcome, "joined");
    assert.equal(bob.room.description, "Designing the Hub");
    assert.deepEqual(bob.members.map((member) => [member.address, member.me]), [["alice/hub-refactor", false], ["bob/website", true]]);
    assert.deepEqual(bob.history.map((message) => [message.kind, message.from, message.to.length]), [["intro", "alice/hub-refactor", 0], ["intro", "bob/website", 0]]);
    assert.equal(bob.unread, 0);
    // Joining again from the same conversation reuses the member; the marker may have been lost.
    const again = await call({ account: hub.accounts.bob, conversation: key }, "join", { code: room.code, intro: "again", workspace: { repo: "tandry", branch: "i18n" } });
    assert.deepEqual([again.outcome, again.member], ["reused", "bob/website"]);
    // A name collision within the account gets a short suffix.
    assert.equal((await joined(hub.accounts.bob, room.code, "website")).address, "bob/website-2");
    assert.ok((await call({ account: hub.accounts.bob }, "status", {})).rooms.some((entry) => entry.id === room.id && entry.role === "member" && !entry.code));
  });

  // ---- sending, reading, authorization -------------------------------------

  test("addressing decides delivery; the room decides who else may read", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    const bob = await joined(hub.accounts.bob, room.code, "b");
    const carol = await joined(hub.accounts.bob, room.code, "c");
    const sent = await text(alice, ["bob/b"], "for bob, on the record");
    assert.deepEqual(sent.recipients.map((recipient) => [recipient.address, recipient.state]), [["bob/b", "offline"]]);
    const secret = await text(alice, ["bob/b"], "for bob only", { dm: true });

    const inbox = await call(bob, "inbox", {});
    assert.deepEqual(inbox.messages.map((message) => [message.body, message.visibility, message.to]), [
      ["for bob, on the record", "room", ["bob/b"]], ["for bob only", "dm", ["bob/b"]]]);
    assert.equal(inbox.upTo, secret.seq);
    assert.equal((await call(carol, "inbox", {})).messages.length, 0);
    // Carol was not told, but reads the public message in the history with its full headers. She never sees the dm.
    const seen = (await call(carol, "history", {})).messages.filter((message) => message.kind === "text");
    assert.deepEqual(seen.map((message) => [message.body, message.to]), [["for bob, on the record", ["bob/b"]]]);
    assert.equal((await call(alice, "history", {})).messages.filter((message) => message.kind === "text").length, 2);

    await assert.rejects(text(alice, [], "dm to nobody", { dm: true }), fails("invalid_input"));
    await assert.rejects(text(alice, ["bob/nobody"], "hello"), (error: unknown) =>
      fails("no_such_member")(error) && Array.isArray((error as TandryError).data?.members));
  });

  test("only the member a conversation backs may act as it", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    // Same account, another conversation; another account with the right conversation ID; an outsider with no member.
    await assert.rejects(text({ ...alice, conversation: conversation() }, [], "x"), fails("not_in_room"));
    await assert.rejects(text({ ...alice, account: hub.accounts.bob }, [], "x"), fails("not_in_room"));
    await assert.rejects(call({ account: hub.accounts.bob, room: alice.room }, "history", {}), fails("forbidden"));
    await assert.rejects(call({ account: hub.accounts.bob, room: newId("r") }, "history", {}), fails("not_in_room"));
    // The room's owner observes without a conversation, and cannot send that way.
    assert.ok((await call({ account: hub.accounts.alice, room: alice.room }, "members", {})).members.length === 1);
    await assert.rejects(text({ account: hub.accounts.alice, room: alice.room }, [], "x"), fails("invalid_input"));
  });

  test("send is idempotent on the message ID", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    const bob = await joined(hub.accounts.bob, room.code, "b");
    const input = { id: newId("m"), to: ["bob/b"], body: "once" };
    const first = await call(alice, "send", input);
    assert.equal((await call(alice, "send", input)).seq, first.seq);
    assert.equal((await call(bob, "inbox", {})).messages.length, 1);
    await assert.rejects(call(bob, "send", { ...input, to: [] }), fails("invalid_input"));
  });

  test("a reply inherits visibility and defaults its recipients", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    const bob = await joined(hub.accounts.bob, room.code, "b");
    const carol = await joined(hub.accounts.bob, room.code, "c");
    const dave = await joined(hub.accounts.alice, room.code, "d");
    const group = await text(alice, ["bob/b", "bob/c"], "group dm", { dm: true });
    await text(bob, [], "reply to all", { replyTo: group.id });
    const open = await text(alice, ["bob/b", "bob/c"], "public question");
    await text(bob, [], "public answer", { replyTo: open.id });
    const got = async (actor: Actor) => (await call(actor, "inbox", {})).messages.map((message) => `${message.visibility}:${message.body}`);
    assert.deepEqual(await got(alice), ["dm:reply to all", "room:public answer"]);
    assert.deepEqual(await got(carol), ["dm:group dm", "dm:reply to all", "room:public question"]);
    await assert.rejects(text(dave, [], "not mine to answer", { replyTo: group.id }), fails("no_such_message"));
  });

  test("the inbox catches up after being offline, in batches, and read moves the position", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    const bob = await joined(hub.accounts.bob, room.code, "b");
    for (let i = 1; i <= 23; i++) await text(alice, ["bob/b"], `message ${i}`);
    const first = await call(bob, "inbox", {});
    assert.equal(first.messages.length, 20);
    assert.deepEqual([first.remaining?.unread, first.remaining?.from], [3, ["alice/a"]]);
    // Scenario 3: the process dies between inbox and read. The next inbox is the same batch.
    assert.deepEqual((await call(bob, "inbox", {})).messages.map((message) => message.id), first.messages.map((message) => message.id));
    assert.equal((await call(alice, "members", {})).members.find((member) => member.address === "bob/b")?.unreadFromMe, 23);
    await call(bob, "read", { upTo: first.upTo });
    await call(bob, "read", { upTo: 1 }); // read never moves backwards
    const second = await call(bob, "inbox", {});
    assert.deepEqual([second.messages.length, second.messages[0]?.body, second.remaining], [3, "message 21", null]);
    await call(bob, "read", { upTo: second.upTo });
    assert.equal((await call(alice, "members", {})).members.find((member) => member.address === "bob/b")?.unreadFromMe, 0);
  });

  test("scenario 5: @room is the members at the moment of sending", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    const bob = await joined(hub.accounts.bob, room.code, "b");
    const leaver = await joined(hub.accounts.bob, room.code, "leaver");
    const broadcast = await text(alice, "@room", "everyone");
    assert.deepEqual(broadcast.recipients.map((recipient) => recipient.address).sort(), ["bob/b", "bob/leaver"]);
    await call(leaver, "leave", {});
    const late = await joined(hub.accounts.bob, room.code, "late");
    assert.equal((await call(late, "inbox", {})).messages.length, 0);
    const [message] = (await call(bob, "inbox", {})).messages;
    assert.deepEqual([message?.toRoom, message?.to.slice().sort()], [true, ["bob/b", "bob/leaver"]]);
    assert.ok((await call(late, "history", {})).messages.some((entry) => entry.body === "everyone"));
  });

  test("scenario 4: leaving abandons unread mail; rejoining under the same name is a new member", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    const bob = await joined(hub.accounts.bob, room.code, "b");
    await text(alice, ["bob/b"], "never read");
    assert.deepEqual(await call(bob, "leave", {}), { left: "bob/b" });
    await assert.rejects(call(bob, "inbox", {}), fails("not_in_room"));
    await assert.rejects(call(bob, "history", {}), fails("not_in_room"));
    assert.ok(!(await call({ account: hub.accounts.bob }, "status", {})).rooms.some((entry) => entry.id === room.id));
    for (let i = 0; i < 3; i++) await text(alice, [], `on record ${i}`);

    const again = await joined(hub.accounts.bob, room.code, "b");
    assert.equal(again.address, "bob/b");
    assert.equal((await call(again, "inbox", {})).messages.length, 0);
    // The new member did not read it: the sender still has nothing unread *from this member*, and the old one is gone.
    assert.equal((await call(alice, "members", {})).members.find((member) => member.address === "bob/b")?.unreadFromMe, 0);
    assert.ok((await call(again, "history", {})).messages.some((message) => message.body === "never read"));
    await text(alice, ["bob/b"], "to the new one");
    assert.deepEqual((await call(again, "inbox", {})).messages.map((message) => message.body), ["to the new one"]);
  });

  test("rename takes effect at once; the old address fails with the member list; replies still resolve", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    const bob = await joined(hub.accounts.bob, room.code, "b");
    const question = await text(bob, ["alice/a"], "who am I?");
    assert.deepEqual(await call(bob, "rename", { name: "website" }), { member: "bob/website" });
    await assert.rejects(text(alice, ["bob/b"], "old name"), fails("no_such_member"));
    const reply = await text(alice, [], "you are bob/website", { replyTo: question.id });
    assert.deepEqual(reply.recipients.map((recipient) => recipient.address), ["bob/website"]);
    await assert.rejects(call({ account: hub.accounts.alice, room: alice.room }, "rename", { member: "bob/website", name: "mine" }), fails("forbidden"));
    // The room's owner may remove another account's member; that member's owner sees the room no more.
    assert.deepEqual(await call({ account: hub.accounts.alice, room: alice.room }, "leave", { member: "bob/website" }), { left: "bob/website" });
  });

  test("sending is rate limited per sender, and messages without recipients are charged too", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    await joined(hub.accounts.bob, room.code, "b");
    await joined(hub.accounts.bob, room.code, "c");
    let sent = 0;
    await assert.rejects(async () => { for (; sent < 200; sent++) await text(alice, sent % 2 ? [] : "@room", `m${sent}`); }, fails("rate_limited"));
    // The bucket holds 30: a broadcast to two costs 2, a message to nobody costs 1.
    assert.equal(sent, 20);
  });

  // ---- links ---------------------------------------------------------------

  test("a link makes a member online, carries only notices, and reports wakeable", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    const bob = await joined(hub.accounts.bob, room.code, "b");
    await text(alice, ["bob/b"], "while you were away");
    const bobLink = link(bob);
    await bobLink.opened;
    // Reconnecting replays the notice for what is unread.
    assert.deepEqual(await bobLink.notify(1), { t: "notify", unread: 1, upTo: (await call(bob, "inbox", {})).upTo, from: ["alice/a"] });
    bobLink.state(true);
    await quiet();
    const sent = await text(alice, ["bob/b"], "SECRET BODY");
    assert.deepEqual(sent.recipients.map((recipient) => [recipient.state, recipient.wakeable]), [["online", true]]);
    assert.equal((await bobLink.notify(2)).unread, 2);
    assert.ok(!JSON.stringify(bobLink.frames).includes("SECRET BODY"));
    bobLink.close();
    await bobLink.closed;
    await quiet();
    assert.equal((await call(alice, "members", {})).members.find((member) => member.address === "bob/b")?.state, "offline");

    const outsider = link({ ...bob, conversation: conversation() });
    assert.equal(await outsider.rejected, 409);
  });

  test("scenario 1: the newest link of a conversation wins; the older one is superseded", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    const bob = await joined(hub.accounts.bob, room.code, "b");
    const first = link(bob);
    await first.opened;
    const inFlight = text(bob, [], "request in flight from the first process");
    const second = link(bob);
    await second.opened;
    assert.equal(await first.closed, CLOSE_CODES.superseded);
    assert.ok((await inFlight).seq > 0);
    await text(alice, ["bob/b"], "who hears this?");
    await second.notify(1);
    assert.equal(first.frames.length, 0);
    // The superseded process still holds the owner's credentials: its tools keep working. It is not a lock.
    assert.equal((await call(bob, "inbox", {})).messages.length, 1);
    second.close();
  });

  test("scenario 2: continuation re-points a member; the later of two wins and the other is rebound", async () => {
    const room = await newRoom();
    const alice = await joined(hub.accounts.alice, room.code, "a");
    const original = await joined(hub.accounts.bob, room.code, "work");
    await text(alice, ["bob/work"], "unread follows the member");
    const originalLink = link(original);
    await originalLink.opened;

    const second = await joined(hub.accounts.bob, room.code, "ignored", { as: "work", name: undefined }, conversation("claude"));
    assert.equal(second.address, "bob/work");
    assert.equal(await originalLink.closed, CLOSE_CODES.rebound);
    await assert.rejects(call(original, "inbox", {}), fails("not_in_room"));
    const secondLink = link(second);
    await secondLink.opened;

    const third = await joined(hub.accounts.bob, room.code, "ignored", { as: "work", name: undefined }, conversation("pi"));
    assert.equal(await secondLink.closed, CLOSE_CODES.rebound);
    await assert.rejects(call(second, "inbox", {}), fails("not_in_room"));
    assert.deepEqual((await call(third, "inbox", {})).messages.map((message) => message.body), ["unread follows the member"]);
    const view = (await call(third, "members", {})).members.find((member) => member.address === "bob/work");
    assert.equal(view?.host, "pi");

    // Only a member of the same account that is still in the room can be continued.
    await assert.rejects(joined(hub.accounts.alice, room.code, "x", { as: "work" }), fails("no_such_member"));
    await call(third, "leave", {});
    await assert.rejects(joined(hub.accounts.bob, room.code, "x", { as: "work" }), fails("no_such_member"));
  });
}
