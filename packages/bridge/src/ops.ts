import http from "node:http";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getProxyForUrl } from "proxy-from-env";
import { TandryError, decodeResult, encodeCall, isRetryable, type CallContext, type Input, type OperationName, type Output } from "@tandryio/protocol";

/** Node's fetch and `ws` ignore HTTPS_PROXY; both of the bridge's transports go through this. */
export function agentFor(target: string | URL): http.Agent | undefined {
  const url = new URL(target);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return undefined;
  url.protocol = url.protocol.replace(/^ws/, "http");
  const proxy = getProxyForUrl(url.href);
  return proxy ? new HttpsProxyAgent(proxy) : undefined;
}

function post(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<{ status: number; text: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = (target.protocol === "https:" ? https : http).request(target, { method: "POST", headers, agent: agentFor(target), timeout: timeoutMs }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
    });
    request.on("timeout", () => request.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    request.on("error", reject);
    request.end(body);
  });
}

export interface OpsOptions {
  hub: string;
  context: () => CallContext;
  retryDelaysMs: readonly number[];
  timeoutMs: number;
}

/**
 * Every operation is idempotent, so a lost response is answered by sending
 * the same request again. Only network failures and 5xx are retried; an error
 * the Hub answered with is final and reaches the agent.
 */
export function createOps(options: OpsOptions) {
  return async function call<K extends OperationName>(name: K, input: Input<K>): Promise<Output<K>> {
    const request = encodeCall(name, options.context(), input);
    let last: unknown;
    for (let attempt = 0; attempt <= options.retryDelaysMs.length; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, options.retryDelaysMs[attempt - 1]));
      try {
        const response = await post(options.hub + request.path, request.headers, request.body, options.timeoutMs);
        if (isRetryable(response.status)) { last = new Error(`HTTP ${response.status}`); continue; }
        let json: unknown = null;
        try { json = JSON.parse(response.text); } catch { /* decodeResult reports it */ }
        return decodeResult(name, response.status, json);
      } catch (error) {
        if (error instanceof TandryError) throw error;
        last = error;
      }
    }
    throw new TandryError("unavailable", `The Hub could not be reached: ${last instanceof Error ? last.message : String(last)}`);
  };
}
export type Ops = ReturnType<typeof createOps>;
