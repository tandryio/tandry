import { createFileRoute } from "@tanstack/react-router";
import { m } from "@tandryio/web/messages";
import { Account } from "@tandryio/web/pages/account";

export const Route = createFileRoute("/account")({
  ssr: false,
  head: () => ({
    meta: [{ title: m.meta_page_title({ page: m.account_title() }) }],
  }),
  component: Account,
});
