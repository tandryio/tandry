import { createFileRoute } from "@tanstack/react-router";
import { m } from "@tandryio/web/messages";
import { Rooms } from "@tandryio/web/pages/rooms";
import { RoomId } from "@tandryio/protocol";

export const Route = createFileRoute("/rooms")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { room?: string } => ({
    room: RoomId.safeParse(search.room).data,
  }),
  head: () => ({
    meta: [{ title: m.meta_page_title({ page: m.nav_my_rooms() }) }],
  }),
  component: RoomsRoute,
});
function RoomsRoute() {
  const { room } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <Rooms room={room} selectRoom={(room) => navigate({ search: { room } })} />
  );
}
