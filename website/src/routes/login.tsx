import { createFileRoute } from "@tanstack/react-router";
import { m } from "@tandryio/web/messages";
import { Login } from "@tandryio/web/pages/login";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [{ title: m.meta_page_title({ page: m.common_sign_in() }) }],
  }),
  component: Login,
});
