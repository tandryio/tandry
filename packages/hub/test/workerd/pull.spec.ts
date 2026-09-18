import { env, runInDurableObject } from "cloudflare:test";
import { newId, type Output } from "@tandryio/protocol";
import { expect, test } from "vitest";
import type { Caller } from "../../src/room-do/context";
import type { RoomRpc } from "../../src/room-do/room-do";

test("pull presence expires without an alarm; inbox makes it live again without making it wakeable", async () => {
  const id = newId("r");
  const stub = env.ROOM.get(env.ROOM.idFromName(id));
  const rpc = stub as unknown as RoomRpc;
  const caller: Caller = { accountId: "alice", handle: "alice", conversation: { host: "web", hostConversationId: newId("c") }, protocol: 1 };
  expect((await rpc.call("join", caller, { code: "unused", intro: "Planning", workspace: { repo: "", branch: "" } }, { id, ownerAccountId: "alice" })).ok).toBe(true);
  const presence = async () => {
    const result = await rpc.call("members", { ...caller, conversation: undefined }, {});
    if (!result.ok) throw new Error(result.error.message);
    return (result.result as Output<"members">).members[0]!;
  };
  expect(await presence()).toMatchObject({ state: "live", tier: "pull", wakeable: false });
  await runInDurableObject(stub, (_, state) => {
    state.storage.sql.exec("UPDATE member SET last_active_at=?", Date.now() - 11 * 60_000);
  });
  expect(await presence()).toMatchObject({ state: "dormant", tier: "pull", wakeable: false });
  expect((await rpc.call("inbox", caller, {})).ok).toBe(true);
  expect(await presence()).toMatchObject({ state: "live", tier: "pull", wakeable: false });
});
