import type { ToolParams } from "@tandryio/protocol";

/** Valid local MCP inputs; delivery and tool output are condensed in the illustration. */
export function terminalScenario(copy: { request: string; response: string }) {
  return {
    requestId: "m_demo0001",
    responseId: "m_demo0002",
    frontend: "dev/frontend",
    backend: "dev/backend",
    send: {
      to: ["dev/backend"],
      body: copy.request,
    } satisfies ToolParams<"send">,
    inbox: {} satisfies ToolParams<"inbox">,
    reply: {
      to: [],
      replyTo: "m_demo0001",
      body: copy.response,
    } satisfies ToolParams<"send">,
  };
}
