import {
  hostLabel,
  type MemberView,
  type RoomSummary,
} from "@tandryio/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { m } from "../../paraglide/messages";
import { getLocale } from "../../paraglide/runtime";
import { call } from "../../lib/hub";
import { useAction } from "../../lib/action";
import { ConfirmAction } from "../confirm-action";
import { Badge, Button, Input, Status } from "../ui";

export function MemberList({
  members,
  room,
  userId,
}: {
  members: MemberView[];
  room: RoomSummary;
  userId: string;
}) {
  return members.length ? (
    <ul className="member-cards">
      {members.map((member) => (
        <MemberCard
          key={member.address}
          member={member}
          room={room}
          userId={userId}
        />
      ))}
    </ul>
  ) : (
    <p className="account-card empty">{m.rooms_no_members()}</p>
  );
}

function MemberCard({
  member,
  room,
  userId,
}: {
  member: MemberView;
  room: RoomSummary;
  userId: string;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.address.split("/")[1] ?? "");
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["room", userId, room.id] }),
      client.invalidateQueries({ queryKey: ["rooms", userId] }),
    ]);
  };
  const rename = useAction(
    () => call("rename", { member: member.address, name }, room.id),
    { onSuccess: invalidate },
  );
  const leave = useAction(
    () => call("leave", { member: member.address }, room.id),
    { onSuccess: invalidate },
  );
  const live = member.state === "live";
  const delivery = !live
    ? m.rooms_dormant_hint()
    : member.tier === "pull"
      ? m.rooms_pull_hint()
      : member.wakeable
        ? m.rooms_wakeable_hint()
        : m.rooms_next_turn_hint();
  return (
    <li className="account-card member-card">
      <div className="room-title">
        <div>
          <h3>{member.address}</h3>
          <span className="muted">
            {hostLabel(member.host)}
            {member.owned ? ` · ${m.rooms_your_member()}` : ""}
          </span>
        </div>
        <Badge tone={live ? "success" : "neutral"}>
          {live
            ? member.busy
              ? m.rooms_busy()
              : m.rooms_live()
            : m.rooms_dormant()}
        </Badge>
      </div>
      <p className="muted">{delivery}</p>
      {!live && (
        <p className="muted">
          {m.rooms_last_active({
            date: new Date(member.lastActiveAt).toLocaleString(getLocale()),
          })}
        </p>
      )}
      <p className="member-intro">{member.intro || m.rooms_no_intro()}</p>
      {(member.workspace.repo || member.workspace.branch) && (
        <p className="muted">
          <code>
            {member.workspace.repo}
            {member.workspace.branch ? ` · ${member.workspace.branch}` : ""}
          </code>
        </p>
      )}
      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            rename.run();
          }}
        >
          <label>
            {m.rooms_member_name()}
            <Input
              required
              maxLength={40}
              pattern="[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={rename.busy}
            />
          </label>
          <p className="muted">{m.rooms_member_name_hint()}</p>
          <div className="actions">
            <Button type="submit" busy={rename.busy}>
              {m.rooms_save()}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={rename.busy}
              onClick={() => setEditing(false)}
            >
              {m.common_cancel()}
            </Button>
          </div>
        </form>
      )}
      <div className="actions">
        {member.owned && !editing && (
          <Button
            variant="ghost"
            disabled={leave.busy}
            onClick={() => setEditing(true)}
          >
            {m.rooms_rename_member()}
          </Button>
        )}
        {(member.owned || room.role === "owner") && (
          <ConfirmAction
            label={m.rooms_remove_member()}
            description={m.rooms_remove_confirm({ member: member.address })}
            busy={leave.busy || rename.busy}
            onConfirm={() => leave.run()}
          />
        )}
      </div>
      {(rename.error || leave.error) && (
        <Status error>{rename.error || leave.error}</Status>
      )}
    </li>
  );
}
