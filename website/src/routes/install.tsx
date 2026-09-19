import { createFileRoute } from "@tanstack/react-router";
import { m } from "@tandryio/web/messages";
import { Install } from "@tandryio/web/pages/install";
export const Route = createFileRoute("/install")({
  head: () => ({
    meta: [{ title: m.meta_page_title({ page: m.nav_get_started() }) }],
  }),
  component: Install,
});
