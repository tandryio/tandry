import handler from "@tanstack/react-start/server-entry";
import { paraglideMiddleware } from "@tandryio/web/server-locale";
import { env } from "cloudflare:workers";

export default {
  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (
      pathname.startsWith("/v1/") ||
      pathname === "/mcp" ||
      pathname.startsWith("/.well-known/")
    )
      return env.ROOM_HUB.fetch(request);
    const response = await paraglideMiddleware(request, () =>
      handler.fetch(request),
    );
    // Cookie-selected HTML must not be shared between language preferences.
    if (response.headers.get("content-type")?.includes("text/html")) {
      const localized = new Response(response.body, response);
      localized.headers.append("Vary", "Cookie");
      localized.headers.set("Cache-Control", "private, no-cache");
      return localized;
    }
    return response;
  },
};
