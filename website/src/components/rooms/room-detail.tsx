import type { RoomSummary } from "@tandryio/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { m } from "../../paraglide/messages";
import { call } from "../../lib/hub";
import { errorText } from "../../lib/i18n";
import { useAction } from "../../lib/action";
import { ConfirmAction } from "../confirm-action";
import {
  Badge,
  Button,
  Input,
  Status,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../ui";
import { MemberList } from "./member-list";
import { MessageHistory } from "./message-history";

export function RoomDetail({
  room,
  userId,
}: {
  room: RoomSummary;
  userId: string;
}) {
  const [tab, setTab] = useState("history");
  const [copied, setCopied] = useState("");
  const members = useQuery({
    queryKey: ["room", userId, room.id, "members"],
    queryFn: () => call("members", {}, room.id),
    refetchInterval: 5_000,
  });
  return (
    <div className="room-detail">
      <div className="page-heading">
        <h2 className="room-detail-name">{room.name}</h2>
        <Badge>
          {room.role === "owner" ? m.rooms_owner() : m.rooms_member_role()}
        </Badge>
      </div>
      {room.description && (
        <p className="room-description">{room.description}</p>
      )}
      {room.code && (
        <div className="room-invite">
          <code>{room.code}</code>
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(room.code!);
                setCopied(m.rooms_code_copied());
              } catch {
                setCopied(m.rooms_copy_failed());
              }
            }}
          >
            {m.rooms_copy_code()}
          </Button>
          <p className="muted">{m.rooms_share_hint()}</p>
        </div>
      )}
      {copied && <Status>{copied}</Status>}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={m.rooms_views()}>
          <TabsTrigger value="history">{m.rooms_history()}</TabsTrigger>
          <TabsTrigger value="correspondence">
            {m.rooms_correspondence()}
          </TabsTrigger>
          <TabsTrigger value="members">{m.rooms_members()}</TabsTrigger>
          {room.role === "owner" && (
            <TabsTrigger value="settings">{m.rooms_settings()}</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="history">
          <MessageHistory roomId={room.id} userId={userId} view="room" />
        </TabsContent>
        <TabsContent value="correspondence">
          <MessageHistory
            roomId={room.id}
            userId={userId}
            view="correspondence"
          />
        </TabsContent>
        <TabsContent value="members">
          <p className="muted">{m.rooms_members_hint()}</p>
          {members.isPending ? (
            <p role="status">{m.common_loading()}</p>
          ) : members.error ? (
            <Status error>{errorText(members.error)}</Status>
          ) : (
            <MemberList
              members={members.data.members}
              room={room}
              userId={userId}
            />
          )}
        </TabsContent>
        {room.role === "owner" && (
          <TabsContent value="settings">
            <RoomSettings room={room} userId={userId} />
          </TabsContent>
        )}
      </Tabs>
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
    <section className="account-card room-settings">
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
        <Button variant="primary" busy={update.busy}>
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
