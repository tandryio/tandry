import assert from "node:assert/strict";
import type { HubUnderTest } from "./start";

/** JSON and request-scoped SSE are both valid stateless MCP responses. */
export async function mcpRequest(hub: Pick<HubUnderTest, "baseUrl">, token: string, method: string, params: Record<string, unknown> = {}, modern = true) {
  const response = await fetch(`${hub.baseUrl}/mcp`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(modern ? { "Mcp-Method": method, ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}) } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params: modern ? { ...params, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "tandry-test", version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {},
    } } : params }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const data = response.headers.get("Content-Type")?.includes("text/event-stream")
    ? text.split("\n").find((line) => line.startsWith("data: "))!.slice(6) : text;
  const body = JSON.parse(data);
  assert.ok(!body.error, data);
  return body.result;
}

export async function mcpTool(hub: Pick<HubUnderTest, "baseUrl">, token: string, name: string, args: Record<string, unknown> = {}) {
  const result = await mcpRequest(hub, token, "tools/call", { name, arguments: args });
  return { text: result.content.map((part: { text?: string }) => part.text ?? "").join("\n"), isError: result.isError === true };
}
