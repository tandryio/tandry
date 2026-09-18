import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { newId, type Output, type RoomId } from "@tandryio/protocol";
import { expect, test } from "vitest";
import type { Caller } from "../../src/room-do/context";
import type { RoomRpc } from "../../src/room-do/room-do";

// RETENTION_DAYS is 7 here (vitest.config.ts).
const DAY_MS = 86_400_000;
const alice: Caller = { accountId: "test-alice", handle: "alice", conversation: { host: "codex", hostConversationId: "thread-a" }, protocol: 1 };

async function room() {
  const id = newId("r") as RoomId;
  const stub = env.ROOM.get(env.ROOM.idFromName(id));
  const rpc = stub as unknown as RoomRpc;
  const joined = await rpc.call("join", alice, { code: "unused", intro: "Working on retention.", workspace: { repo: "tandry", branch: "main" } }, { id, ownerAccountId: alice.accountId });
  expect(joined.ok).toBe(true);
  return {
    stub,
    async send(body: string) {
      const sent = await rpc.call("send", alice, { id: newId("m"), to: "@room", body, dm: false });
      expect(sent.ok).toBe(true);
    },
    async bodies() {
      const page = await rpc.call("history", alice, {});
      if (!page.ok) throw new Error(page.error.message);
      return (page.result as Output<"history">).messages.map((message) => message.body);
    },
    alarm: () => runInDurableObject(stub, (_, state) => state.storage.getAlarm()),
    /** Moves every message whose body matches into the past. */
    age: (body: string, days: number) => runInDurableObject(stub, (_, state) => {
      state.storage.sql.exec("UPDATE message SET created_at=created_at-? WHERE body=?", days * DAY_MS, body);
    }),
  };
}

test("the first message schedules a sweep for when it expires", async () => {
  const before = Date.now();
  const r = await room();
  const at = await r.alarm();
  expect(at).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
  expect(at).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
});

test("a sweep deletes what has expired and reschedules for what remains", async () => {
  const r = await room();
  await r.send("old");
  await r.send("fresh");
  await r.age("old", 8);

  expect(await runDurableObjectAlarm(r.stub)).toBe(true);
  expect(await r.bodies()).toEqual(["Working on retention.", "fresh"]);
  expect(await r.alarm()).toBeGreaterThan(Date.now() + 6 * DAY_MS);
});

test("an emptied room is never woken again, until someone writes", async () => {
  const r = await room();
  await r.age("Working on retention.", 8);

  expect(await runDurableObjectAlarm(r.stub)).toBe(true);
  expect(await r.bodies()).toEqual([]);
  expect(await r.alarm()).toBeNull();
  expect(await runDurableObjectAlarm(r.stub)).toBe(false);

  await r.send("back");
  expect(await r.alarm()).not.toBeNull();
});

test("a sweep that finds nothing expired deletes nothing and waits at least a day", async () => {
  const r = await room();
  expect(await runDurableObjectAlarm(r.stub)).toBe(true);
  expect(await r.bodies()).toEqual(["Working on retention."]);
  expect(await r.alarm()).toBeGreaterThanOrEqual(Date.now() + DAY_MS - 1000);
});
