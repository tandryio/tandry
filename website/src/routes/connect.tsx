import { createFileRoute } from "@tanstack/react-router";
import { m } from "@tandryio/web/messages";
import { Connect } from "@tandryio/web/pages/connect";

export const Route = createFileRoute("/connect")({
  ssr: false,
  head: () => ({
    meta: [{ title: m.meta_page_title({ page: m.connect_title() }) }],
  }),
  component: Connect,
});
