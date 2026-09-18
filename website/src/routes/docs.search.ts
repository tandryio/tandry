import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "../lib/docs/source";

// Full-text search over the compiled docs. Locales share URLs (the prefix is
// hidden), so the index id carries the locale to keep documents distinct; the
// client filters results by the active locale.
const server = createFromSource(source, {
  async buildIndex(page) {
    return {
      id: `${page.locale ?? "en"}:${page.url}`,
      url: page.url,
      title: page.data.title ?? page.slugs.join("/"),
      description: page.data.description,
      structuredData: await page.data.structuredData(),
    };
  },
});

export const Route = createFileRoute("/docs/search")({
  server: {
    handlers: { GET: async ({ request }) => server.GET(request) },
  },
});
