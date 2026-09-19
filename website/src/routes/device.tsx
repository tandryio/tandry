import { createFileRoute } from "@tanstack/react-router";
import { m } from "@tandryio/web/messages";
import { Device } from "@tandryio/web/pages/device";

export const Route = createFileRoute("/device")({
  ssr: false,
  head: () => ({
    meta: [{ title: m.meta_page_title({ page: m.device_title() }) }],
  }),
  component: Device,
});
