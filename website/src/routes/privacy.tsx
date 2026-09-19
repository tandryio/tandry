import { createFileRoute } from "@tanstack/react-router";
import { m } from "@tandryio/web/messages";
import { Privacy } from "@tandryio/web/pages/privacy";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [{ title: m.meta_page_title({ page: m.privacy_title() }) }],
  }),
  component: Privacy,
});
