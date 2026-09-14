import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import {
  prepareAuth,
  headers,
  alice,
  bob,
  saveTestLogin,
} from "./fixtures/auth.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(25);
  }
  throw new Error("Timed out");
}

test(
  "account auth: deny anonymous access, device approval, ownership, revocation and account-scoped journals",
  { timeout: 60000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aroom-auth-"));
    const reserve = createServer().listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const port = reserve.address().port;
    await new Promise((r) => reserve.close(r));
    const origin = `http://127.0.0.1:${port}`;
    const hub = fileURLToPath(new URL("../../hub/", import.meta.url));
    const config = path.join(root, "wrangler.json");
    fs.writeFileSync(
      config,
      JSON.stringify({
        name: "aroom-auth-test",
        main: path.join(hub, "src/index.ts"),
        durable_objects: {
          bindings: [{ name: "TEAM_ROOM", class_name: "TeamRoom" }],
        },
        migrations: [{ tag: "v1", new_sqlite_classes: ["TeamRoom"] }],
      }),
    );
    await prepareAuth(config, root, origin);
    const worker = spawn(
      process.execPath,
      [
        path.join(hub, "node_modules/wrangler/bin/wrangler.js"),
        "dev",
        "--local",
        "--config",
        config,
        "--port",
        String(port),
        "--inspector-port",
        "0",
        "--persist-to",
        path.join(root, "hub-state"),
        "--show-interactive-dev-session=false",
      ],
      {
        cwd: hub,
        detached: true,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    worker.stdout.on("data", (d) => (output += d));
    worker.stderr.on("data", (d) => (output += d));
    const sockets = [];
    let runtime;
    async function api(route, user, body, extra = {}) {
      return fetch(origin + route, {
        headers: {
          ...(user ? headers(user) : {}),
          "Content-Type": "application/json",
          ...extra,
        },
        ...(body === undefined
          ? {}
          : { method: "POST", body: JSON.stringify(body) }),
      });
    }
    async function peer(room, user, ref, metadata = {}) {
      const socket = new WebSocket(
        origin.replace("http", "ws") + `/ws?room=${room}`,
        { headers: headers(user) },
      );
      sockets.push(socket);
      const messages = [];
      let closeCode;
      socket.on("message", (d) => messages.push(JSON.parse(d.toString())));
      socket.on("close", (c) => (closeCode = c));
      await once(socket, "open");
      socket.send(
        JSON.stringify({
          type: "hello",
          reliable: 1,
          ref,
          user: "spoofed-name",
          host: "test",
          cwd: root,
          repo: "review",
          agentType: "codex",
          ...metadata,
        }),
      );
      await until(
        () => closeCode || messages.some((m) => m.type === "welcome"),
      );
      return {
        socket,
        messages,
        get closeCode() {
          return closeCode;
        },
      };
    }
    try {
      await until(async () => {
        try {
          return (await fetch(origin + "/health")).ok;
        } catch {
          return false;
        }
      });
      assert.equal((await api("/rooms", undefined, {})).status, 403);
      assert.equal((await api("/api/rooms")).status, 401);
      assert.equal(
        (await api("/rooms", alice, {}, { Origin: "https://evil.example" }))
          .status,
        403,
      );
      assert.equal((await api("/rooms", { token: "invalid" }, {})).status, 401);
      assert.equal(
        (
          await api(
            "/api/auth/sign-up/email",
            undefined,
            {
              email: "x@example.test",
              password: "a-very-long-password",
              name: "x",
            },
            { Origin: origin },
          )
        ).status,
        400,
        "no password registration",
      );
      assert.equal((await api("/api/profile")).status, 401);
      const aliceHandle = "test_alice", bobHandle = "test_bob";
      const profile = await (await api("/api/profile", alice)).json();
      assert.equal(profile.handle, aliceHandle);
      assert.equal(profile.userId, alice.id);
      const lookup = await (await api("/api/users/@TEST_ALICE", bob)).json();
      assert.equal(lookup.userId, alice.id);
      assert.equal(lookup.email, undefined);
      assert.equal((await api("/api/profile/handle", alice, { handle: "changed" })).status, 409, "a claimed handle cannot be changed");
      const room = await (
        await api("/rooms", alice, { name: "Account room" })
      ).json();
      assert.ok(room.code);
      assert.equal((await api(`/rooms/${room.code}`, bob)).status, 403);
      assert.equal(
        (await api(`/rooms/${room.code}/join`, bob, {})).status,
        200,
      );
      const original = await peer(room.code, alice, "aaaaaa");
      assert.equal(original.messages[0].name, "review");
      assert.equal(original.messages[0].self.user, "Alice", "account name is server-owned");
      assert.equal(original.messages[0].self.handle, aliceHandle);
      assert.equal(original.messages[0].self.agentType, "codex");
      const attacker = await peer(room.code, bob, "aaaaaa");
      assert.equal(attacker.closeCode, 4003);
      assert.equal(original.closeCode, undefined);
      const bobPeer = await peer(room.code, bob, "bbbbbb");
      const memberList = await (
        await api(`/rooms/${room.code}/members`, alice)
      ).json();
      assert.equal(
        memberList.members.find((m) => m.userId === bob.id).handle,
        bobHandle,
      );
      original.socket.send(
        JSON.stringify({ type: "list", reqId: "handle-list" }),
      );
      await until(() =>
        original.messages.some((m) => m.reqId === "handle-list"),
      );
      const agents = original.messages.find(
        (m) => m.reqId === "handle-list",
      ).agents;
      assert.equal(agents.find((a) => a.ref === "bbbbbb").handle, bobHandle);
      original.socket.send(
        JSON.stringify({
          type: "send",
          reqId: "handle-send",
          to: `@${bobHandle}`,
          body: "handle delivery",
        }),
      );
      await until(() =>
        bobPeer.messages.some(
          (m) => m.type === "message" && m.message.body === "handle delivery",
        ),
      );
      for (const reqId of ["handle-retry-1", "handle-retry-2"])
        original.socket.send(
          JSON.stringify({
            type: "send",
            reqId,
            messageId: "b60d9ef0-5572-4d86-99a9-adc2c7d8e5af",
            to: `@${bobHandle}`,
            body: "concurrent retry",
          }),
        );
      await until(() =>
        ["handle-retry-1", "handle-retry-2"].every((id) =>
          original.messages.some((m) => m.reqId === id),
        ),
      );
      const receipts = original.messages.filter((m) =>
        m.reqId?.startsWith("handle-retry-"),
      );
      assert.ok(receipts.every((m) => m.type === "sent"));
      assert.equal(
        receipts[0].id,
        receipts[1].id,
        "handle resolution must preserve idempotency across concurrent retries",
      );
      const bobSecond = await peer(room.code, bob, "bbbbbc", { agentType: "claude", name: "修复登录" });
      original.socket.send(
        JSON.stringify({
          type: "send",
          reqId: "handle-ambiguous",
          to: `@${bobHandle}`,
          body: "must choose",
        }),
      );
      await until(() =>
        original.messages.some((m) => m.reqId === "handle-ambiguous"),
      );
      assert.equal(
        original.messages.find((m) => m.reqId === "handle-ambiguous").code,
        "AMBIGUOUS_NAME",
      );
      const candidates = original.messages.find(m => m.reqId === "handle-ambiguous").candidates;
      assert.equal(candidates.find(m => m.ref === "bbbbbc").agentType, "claude");
      assert.equal(candidates.find(m => m.ref === "bbbbbc").name, "修复登录");
      assert.equal(candidates.find(m => m.ref === "bbbbbc").host, "test");
      bobSecond.socket.send(JSON.stringify({ type: "rename", reqId: "rename", name: "审核登录" }));
      await until(() => bobSecond.messages.some(m => m.reqId === "rename"));
      assert.equal(bobSecond.messages.find(m => m.reqId === "rename").name, "审核登录");
      // Rename changes neither account ownership nor exact routing.
      original.socket.send(
        JSON.stringify({
          type: "send",
          reqId: "handle-specific",
          to: `@${bobHandle} [bbbbbc]`,
          body: "specific conversation",
        }),
      );
      await until(() =>
        bobSecond.messages.some(
          (m) =>
            m.type === "message" && m.message.body === "specific conversation",
        ),
      );
      const incoming = bobSecond.messages.find(m => m.message?.body === "specific conversation").message;
      assert.equal(incoming.fromRef, "aaaaaa");
      assert.equal(incoming.from, `@${aliceHandle} · Codex · review`);
      assert.ok(!incoming.from.includes("aaaaaa"));
      original.socket.send(
        JSON.stringify({
          type: "send",
          reqId: "handle-wrong-ref",
          to: `@${aliceHandle} [bbbbbc]`,
          body: "wrong owner",
        }),
      );
      await until(() =>
        original.messages.some((m) => m.reqId === "handle-wrong-ref"),
      );
      assert.equal(
        original.messages.find((m) => m.reqId === "handle-wrong-ref").code,
        "UNKNOWN_AGENT",
      );

      assert.equal(
        (await api(`/rooms/${room.code}/members`, bob, { userId: alice.id }))
          .status,
        403,
      );
      assert.equal(
        (await api(`/rooms/${room.code}/members`, alice, { userId: bob.id }))
          .status,
        200,
      );
      await until(() => bobPeer.closeCode === 4003);
      assert.equal(
        (await api(`/rooms/${room.code}/join`, bob, {})).status,
        403,
        "new socket cannot bypass account removal",
      );
      assert.deepEqual((await (await api("/api/rooms", bob)).json()).rooms, []);
      assert.equal(
        (
          await api("/api/auth/device/code", undefined, {
            client_id: "unknown",
          })
        ).status,
        400,
      );
      const device = await (
        await api("/api/auth/device/code", undefined, {
          client_id: "agent-room-cli",
        })
      ).json();
      assert.ok(device.user_code);
      const tokenBody = {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: device.device_code,
        client_id: "agent-room-cli",
      };
      const early = await (
        await api("/api/auth/device/token", undefined, tokenBody)
      ).json();
      assert.equal(early.error, "authorization_pending");
      assert.equal(
        (
          await api("/api/auth/device/approve", undefined, {
            userCode: device.user_code,
          })
        ).status,
        401,
      );
      assert.equal(
        (await api(`/api/auth/device?user_code=${device.user_code}`, alice))
          .status,
        200,
      );
      assert.equal(
        (
          await api("/api/auth/device/approve", bob, {
            userCode: device.user_code,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await api("/api/auth/device/approve", alice, {
            userCode: device.user_code,
          })
        ).status,
        200,
      );
      await sleep(5200);
      const token = await (
        await api("/api/auth/device/token", undefined, tokenBody)
      ).json();
      assert.ok(token.access_token, JSON.stringify(token));
      const deviceUser = { token: token.access_token };
      assert.equal((await api("/api/me", deviceUser)).status, 200);
      assert.notEqual(
        (await api("/api/auth/device/token", undefined, tokenBody)).status,
        200,
        "device code cannot be redeemed twice",
      );
      const devicePeer = await peer(room.code, deviceUser, "cccccc");
      assert.equal(
        (await api("/api/auth/sign-out", deviceUser, {})).status,
        200,
      );
      devicePeer.socket.send(JSON.stringify({ type: "ping" }));
      await until(() => devicePeer.closeCode === 4003);
      assert.equal((await api("/api/me", deviceUser)).status, 401);

      process.env.AGENT_ROOM_HOME = path.join(root, "client");
      process.env.AGENT_ROOM_HUB = origin.replace("http", "ws");
      const {
        default: { createRuntime },
      } = await import("../dist/runtime.cjs");
      runtime = createRuntime({ namespace: "test", cwd: root, log: () => {} });
      await assert.rejects(runtime.listRooms(), /Sign in/);
      runtime.bindSession("same-conversation");
      const prompt = await runtime.login("start");
      assert.ok(prompt.userCode);
      assert.ok(prompt.verificationUrl.startsWith(origin));
      assert.equal(JSON.stringify(prompt).includes("access_token"), false);
      assert.equal(
        (await api(`/api/auth/device?user_code=${prompt.userCode}`, alice))
          .status,
        200,
      );
      assert.equal(
        (
          await api("/api/auth/device/approve", alice, {
            userCode: prompt.userCode,
          })
        ).status,
        200,
      );
      await until(() => runtime.loginStatus().loggedIn);
      const unbound = createRuntime({ namespace: "codex", cwd: root, log: () => {} });
      try {
        const listed = await unbound.listRooms();
        assert.equal(listed.currentRoom, null);
        assert.equal(listed.rooms.find(r => r.code === room.code).role, "owner");
        assert.equal(unbound.sessionId, undefined);
        assert.equal(unbound.hub, null, "account lookup does not connect a conversation");
      } finally { unbound.dispose(); }
      runtime.bindSession("same-conversation");
      await runtime.control("same-conversation", "join", room.code);
      await until(() => runtime.hub?.connected);
      const listed = await runtime.listRooms();
      assert.equal(listed.currentRoom, room.code);
      assert.equal(listed.rooms.find(r => r.code === room.code).current, true);
      const ref = runtime.ref;
      await runtime.control("same-conversation", "dnd");
      await runtime.control("same-conversation", "rename", undefined, "后端联调");
      assert.equal(runtime.switches().dnd, true, "rename preserves delivery switches");
      assert.equal(runtime.hub.name, "后端联调");
      assert.equal(runtime.ref, ref);
      await assert.rejects(runtime.control("same-conversation", "rename", undefined, "@spoof"));
      assert.equal(runtime.saved.name, "后端联调");
      runtime.dispose();
      runtime = createRuntime({ namespace: "test", cwd: root, log: () => {} });
      runtime.bindSession("same-conversation");
      await until(() => runtime.hub?.connected);
      assert.equal(runtime.hub.name, "后端联调", "rename survives process restart");
      assert.equal(runtime.ref, ref);
      assert.equal((await runtime.members()).find(a => a.ref === ref).name, "后端联调");
      await runtime.control("same-conversation", "on");
      runtime.hub.emit("message", {
        id: "account-only",
        from: "Alice",
        fromRef: "aaaaaa",
        body: "private pending message",
        at: Date.now(),
      });
      saveTestLogin(process.env.AGENT_ROOM_HOME, origin, bob);
      assert.equal(
        runtime.drain().length,
        0,
        "account switch immediately gates old inbox",
      );
      runtime.bindSession("same-conversation");
      assert.equal(runtime.saved.room, null);
      assert.notEqual(runtime.ref, ref);
      saveTestLogin(process.env.AGENT_ROOM_HOME, origin, alice);
      runtime.bindSession("same-conversation");
      assert.equal(runtime.ref, ref);
      assert.equal(runtime.drain()[0].body, "private pending message");
    } catch (error) {
      error.message += "\n" + output.slice(-6000);
      throw error;
    } finally {
      runtime?.dispose();
      for (const socket of sockets) socket.terminate();
      const done = once(worker, "exit");
      process.kill(-worker.pid, "SIGTERM");
      await done;
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
