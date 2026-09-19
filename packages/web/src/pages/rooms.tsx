import { newId, RoomId, type RoomSummary } from "@tandryio/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { m } from "../paraglide/messages";
import { errorText } from "../lib/i18n";
import { call } from "../lib/hub";
import { useAction } from "../lib/action";
import { Shell } from "../components/shell";
import { RequireAccount } from "../components/require-account";
import { RoomDetail } from "../components/rooms/room-detail";
import { Badge, Button, Icon, Input, Status } from "../components/ui";

export function Rooms({
  room,
  selectRoom,
}: {
  room?: string;
  selectRoom: (room?: string) => Promise<void>;
}) {
  return (
    <Shell>
      <h1 className="sr-only">{m.nav_my_rooms()}</h1>
      <RequireAccount
        next={room ? `/rooms?room=${encodeURIComponent(room)}` : "/rooms"}
        signInPrompt={m.rooms_sign_in_prompt()}
      >
        {({ session }) => (
          <RoomList
            key={session.user.id}
            userId={session.user.id}
            selected={room}
            selectRoom={selectRoom}
          />
        )}
      </RequireAccount>
    </Shell>
  );
}

function RoomList({
  userId,
  selected,
  selectRoom,
}: {
  userId: string;
  selected?: string;
  selectRoom: (room?: string) => Promise<void>;
}) {
  const client = useQueryClient();
  const rooms = useQuery({
    queryKey: ["rooms", userId],
    queryFn: () => call("status", {}),
    refetchInterval: 10_000,
  });
  const [creating, setCreating] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [description, setDescription] = useState("");
  const [filter, setFilter] = useState<"all" | "owned">("all");
  const [search, setSearch] = useState("");
  // Keep the same ID across a failed request; a retry cannot create a duplicate room.
  const [draftId, setDraftId] = useState(() => newId("r"));
  const create = useAction(
    () => call("new_room", { id: draftId, name: roomName, description }),
    {
      onSuccess: async (room) => {
        setCreating(false);
        setRoomName("");
        setDescription("");
        setDraftId(newId("r"));
        await client.invalidateQueries({ queryKey: ["rooms", userId] });
        await selectRoom(room.id);
      },
    },
  );
  const all = rooms.data?.rooms ?? [];
  const selectedRoom = all.find((room) => room.id === selected);
  if (rooms.isPending) return <p role="status">{m.rooms_loading()}</p>;
  if (rooms.error)
    return (
      <Status error>
        {errorText(rooms.error)}{" "}
        <Button onClick={() => rooms.refetch()}>{m.common_retry()}</Button>
      </Status>
    );
  if (selected)
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="room-back"
          onClick={() => selectRoom()}
        >
          ← {m.rooms_back()}
        </Button>
        {selectedRoom ? (
          <RoomDetail
            key={selectedRoom.id}
            room={selectedRoom}
            userId={userId}
          />
        ) : (
          <Status error>{m.error_no_such_room()}</Status>
        )}
      </>
    );
  const visible = all.filter(
    (room) =>
      (filter === "all" || room.role === "owner") &&
      `${room.name} ${room.description} ${room.code ?? ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <div className="room-toolbar">
        <div
          className="segmented-control"
          role="group"
          aria-label={m.rooms_filter_label()}
        >
          {(["all", "owned"] as const).map((value) => (
            <Button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? m.rooms_filter_all() : m.rooms_filter_owned()}
            </Button>
          ))}
        </div>
        <label className="search-field">
          <Icon name="search" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={m.rooms_search()}
            placeholder={m.rooms_search()}
          />
        </label>
        <Button
          variant="primary"
          size="sm"
          className="room-create"
          onClick={() => {
            setCreating(!creating);
            create.reset();
          }}
          aria-expanded={creating}
        >
          <Icon name="plus" />
          {m.common_create_room()}
        </Button>
      </div>
      {creating && (
        <form
          className="account-card room-entry"
          onSubmit={(event) => {
            event.preventDefault();
            create.run();
          }}
        >
          <h2>{m.common_create_room()}</h2>
          <p className="muted">{m.rooms_create_hint()}</p>
          <label>
            {m.rooms_name_label()}
            <Input
              autoFocus
              required
              maxLength={80}
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              disabled={create.busy}
            />
          </label>
          <label>
            {m.rooms_description()}
            <textarea
              className="ui-input"
              rows={3}
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={create.busy}
            />
          </label>
          <div className="actions">
            <Button variant="primary" type="submit" busy={create.busy}>
              {m.rooms_create_button()}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={create.busy}
              onClick={() => setCreating(false)}
            >
              {m.common_cancel()}
            </Button>
          </div>
          {create.error && <Status error>{create.error}</Status>}
        </form>
      )}
      {!visible.length ? (
        <section className="account-card empty">
          <h2>
            {search || filter !== "all"
              ? m.rooms_no_matches()
              : m.rooms_empty_title()}
          </h2>
          <p>
            {search || filter !== "all"
              ? m.rooms_no_matches_hint()
              : m.rooms_empty_body()}
          </p>
          {(search || filter !== "all") && (
            <Button
              onClick={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              {m.rooms_clear_filters()}
            </Button>
          )}
        </section>
      ) : (
        <div className="room-grid">
          {visible.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      )}
      <p className="muted">{m.rooms_join_agent_hint()}</p>
    </>
  );
}

function RoomCard({ room }: { room: RoomSummary }) {
  return (
    <article className="account-card room-card">
      <div className="room-title">
        <span className="room-card-icon">
          <Icon name="rooms" />
        </span>
        <div>
          <h2>
            <a href={`/rooms?room=${encodeURIComponent(room.id)}`}>
              {room.name}
            </a>
          </h2>
        </div>
        <Badge>
          {room.role === "owner" ? m.rooms_owner() : m.rooms_member_role()}
        </Badge>
      </div>
      <p className="muted room-description">
        {room.description || m.rooms_no_description()}
      </p>
      {room.code && <code>{room.code}</code>}
      <div className="actions">
        <Button asChild variant="ghost">
          <a href={`/rooms?room=${encodeURIComponent(room.id)}`}>
            {m.rooms_open()}
            <Icon name="arrow" />
          </a>
        </Button>
      </div>
    </article>
  );
}
