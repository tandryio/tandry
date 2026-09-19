import type { RoomSummary } from "@tandryio/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { m } from "../../paraglide/messages";
import { call } from "../../lib/hub";
import { errorText } from "../../lib/i18n";
import { useAction } from "../../lib/action";
import { ConfirmAction } from "../confirm-action";
import { Badge, Button, Icon, Input, Status } from "../ui";
import { MemberList } from "./member-list";
import { MessageHistory } from "./message-history";

export function RoomDetail({
  room,
  userId,
}: {
  room: RoomSummary;
  userId: string;
}) {
  const [view, setView] = useState<"room" | "correspondence">("room");
  const [panel, setPanel] = useState<"members" | "settings">("members");
  const [copied, setCopied] = useState<"" | "done" | "failed">("");
  const members = useQuery({
    queryKey: ["room", userId, room.id, "members"],
    queryFn: () => call("members", {}, room.id),
    refetchInterval: 5_000,
  });
  const count = members.data?.members.length;
  return (
    <div className="room-chat">
      <header className="room-chat-header">
        <div className="room-chat-title">
          <h2>
            {room.name}
            <Badge>
              {room.role === "owner" ? m.rooms_owner() : m.rooms_member_role()}
            </Badge>
          </h2>
          {room.description && <p>{room.description}</p>}
        </div>
        <div className="room-chat-tools">
          <div
            className="segmented-control"
            role="group"
            aria-label={m.rooms_views()}
          >
            {(["room", "correspondence"] as const).map((value) => (
              <Button
                key={value}
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {value === "room"
                  ? m.rooms_history()
                  : m.rooms_correspondence()}
              </Button>
            ))}
          </div>
          {room.code && (
            <button
              type="button"
              className="room-code-chip"
              title={m.rooms_share_hint()}
              aria-label={`${m.rooms_copy_code()}: ${room.code}`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(room.code!);
                  setCopied("done");
                  window.setTimeout(() => setCopied(""), 1600);
                } catch {
                  setCopied("failed");
                }
              }}
            >
              <code>{room.code}</code>
              <Icon name={copied === "done" ? "check" : "copy"} />
            </button>
          )}
          <span className="sr-only" aria-live="polite">
            {copied === "done" ? m.rooms_code_copied() : ""}
          </span>
        </div>
      </header>
      {copied === "failed" && <Status error>{m.rooms_copy_failed()}</Status>}
      <div className="room-chat-body">
        <MessageHistory
          key={view}
          roomId={room.id}
          userId={userId}
          view={view}
        />
        <aside className="room-chat-side">
          {room.role === "owner" ? (
            <div
              className="segmented-control"
              role="group"
              aria-label={m.rooms_views()}
            >
              <Button
                aria-pressed={panel === "members"}
                onClick={() => setPanel("members")}
              >
                {m.rooms_members()}
                {count !== undefined && <span className="count">{count}</span>}
              </Button>
              <Button
                aria-pressed={panel === "settings"}
                onClick={() => setPanel("settings")}
              >
                {m.rooms_settings()}
              </Button>
            </div>
          ) : (
            <h3 className="room-chat-side-title">
              {m.rooms_members()}
              {count !== undefined && <span className="count">{count}</span>}
            </h3>
          )}
          {panel === "settings" && room.role === "owner" ? (
            <RoomSettings room={room} userId={userId} />
          ) : members.isPending ? (
            <p className="chat-side-empty" role="status">
              {m.common_loading()}
            </p>
          ) : members.error ? (
            <Status error>{errorText(members.error)}</Status>
          ) : (
            <>
              <MemberList
                members={members.data.members}
                room={room}
                userId={userId}
              />
              <p className="chat-side-hint">{m.rooms_members_hint()}</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function RoomSettings({ room, userId }: { room: RoomSummary; userId: string }) {
  const client = useQueryClient();
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description);
  const [notice, setNotice] = useState("");
  const update = useAction(
    (rotateCode: boolean) =>
      call(
        "update_room",
        rotateCode
          ? { room: room.id, rotateCode: true }
          : { room: room.id, name, description },
      ),
    {
      onSuccess: async () => {
        setNotice(m.rooms_saved());
        await client.invalidateQueries({ queryKey: ["rooms", userId] });
      },
    },
  );
  return (
    <section className="room-settings">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          update.run(false);
        }}
      >
        <label>
          {m.rooms_name_label()}
          <Input
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={update.busy}
          />
        </label>
        <label>
          {m.rooms_description()}
          <textarea
            className="ui-input"
            maxLength={500}
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={update.busy}
          />
        </label>
        <Button variant="primary" size="sm" busy={update.busy}>
          {m.rooms_save()}
        </Button>
      </form>
      <div className="room-management">
        <ConfirmAction
          key={room.code}
          label={m.rooms_rotate_code()}
          description={m.rooms_rotate_confirm()}
          busy={update.busy}
          onConfirm={() => update.run(true)}
        />
      </div>
      {update.error && <Status error>{update.error}</Status>}
      {notice && !update.error && <Status>{notice}</Status>}
    </section>
  );
}
