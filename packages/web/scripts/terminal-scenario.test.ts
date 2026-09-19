import { test } from "node:test";
import assert from "node:assert/strict";
import { tools, MessageId } from "@tandryio/protocol";
import { terminalScenario } from "../src/components/landing/terminal-scenario";
import en from "../messages/en.json" with { type: "json" };
import zh from "../messages/zh.json" with { type: "json" };

test("illustrated MCP calls use valid recipients and reply to the received message", () => {
  for (const messages of [en, zh]) {
    const scenario = terminalScenario({ request: messages.landing_parallel_request, response: messages.landing_parallel_response });
    tools.send.params.parse(scenario.send);
    tools.send.params.parse(scenario.reply);
    tools.inbox.params.parse(scenario.inbox);
    MessageId.parse(scenario.requestId);
    MessageId.parse(scenario.responseId);
    assert.deepEqual(scenario.send.to, [scenario.backend]);
    assert.equal(scenario.reply.replyTo, scenario.requestId);
    assert.deepEqual(scenario.reply.to, []);
  }
});
