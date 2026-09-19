import { createFileRoute } from "@tanstack/react-router";
import { m } from "@tandryio/web/messages";
import { Landing } from "@tandryio/web/pages/index";

export const Route = createFileRoute("/")({ component: Landing });
