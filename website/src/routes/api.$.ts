import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

const proxy = ({ request }: { request: Request }) =>
  env.ROOM_HUB.fetch(request);
export const Route = createFileRoute("/api/$")({
  server: { handlers: { GET: proxy, POST: proxy, DELETE: proxy } },
});
