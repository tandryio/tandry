import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Bridge, Tool } from "./index";

export interface StdioOptions {
  /** A host whose conversation can change under a living process passes tools that delegate to its current bridge. */
  bridge: Pick<Bridge, "tools" | "dispose">;
  version: string;
  /** Tools only this host needs, e.g. the one its hooks call. Not part of the protocol. */
  extraTools?: Tool[];
  /** Runs before every tool call. Some hosts say which conversation is calling only in the request's `_meta`. */
  onCall?(call: { name: string; arguments: Record<string, unknown>; meta: Record<string, unknown> }): void;
}

/** Serves bridge.tools to a host that loads Tandry as a stdio MCP server. Shared by every such client. */
export async function serveStdio(options: StdioOptions): Promise<void> {
  const all = [...options.bridge.tools, ...(options.extraTools ?? [])];
  const server = new Server({ name: "tandry", version: options.version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: all.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as { type: "object" } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    options.onCall?.({ name: request.params.name, arguments: request.params.arguments ?? {}, meta: (request.params._meta ?? {}) as Record<string, unknown> });
    const tool = all.find((candidate) => candidate.name === request.params.name);
    if (!tool) return { content: [{ type: "text", text: `Unknown tool ${request.params.name}` }], isError: true };
    const result = await tool.call(request.params.arguments ?? {});
    return { content: [{ type: "text", text: result.text }], isError: result.isError };
  });
  const transport = new StdioServerTransport();
  transport.onclose = () => options.bridge.dispose();
  await server.connect(transport);
}
