import type { MemberView, RoomSummary } from "@tandryio/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { m } from "../../paraglide/messages";
import { getLocale } from "../../paraglide/runtime";
import { call } from "../../lib/hub";
import { useAction } from "../../lib/action";
import { ConfirmAction } from "../confirm-action";
import { Button, Input, Status } from "../ui";
import { MemberAvatar } from "./host-avatar";

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
    <ul className="member-rows">
      {members.map((member) => (
        <MemberRow
          key={member.address}
          member={member}
          room={room}
          userId={userId}
        />
      ))}
    </ul>
  ) : (
    <p className="chat-side-empty">{m.rooms_no_members()}</p>
  );
}

/** One line per member; details and management open in place. */
function MemberRow({
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
    {
      onSuccess: async () => {
        setEditing(false);
        await invalidate();
      },
    },
  );
  const leave = useAction(
    () => call("leave", { member: member.address }, room.id),
    { onSuccess: invalidate },
  );
  const online = member.state === "online";
  const presence = online
    ? member.busy
      ? m.rooms_busy()
      : m.rooms_online()
    : m.rooms_offline();
  const delivery = !online
    ? m.rooms_offline_hint()
    : member.tier === "pull"
      ? m.rooms_pull_hint()
      : m.rooms_wakeable_hint();
  return (
    <li className="member-row">
      <details>
        <summary>
          <MemberAvatar
            address={member.address}
            host={member.host}
            owned={member.owned}
            avatar={member.avatar}
          />
          <span className="member-summary">
            <strong>{member.address}</strong>
            <span>
              <span
                className={`presence-dot is-${online ? (member.busy ? "busy" : "online") : "offline"}`}
                aria-hidden="true"
              />
              {presence}
              {member.owned ? ` · ${m.rooms_your_member()}` : ""}
            </span>
          </span>
        </summary>
        <div className="member-details">
          <p className="member-intro">{member.intro || m.rooms_no_intro()}</p>
          {(member.workspace.repo || member.workspace.branch) && (
            <code>
              {member.workspace.repo}
              {member.workspace.branch ? ` · ${member.workspace.branch}` : ""}
            </code>
          )}
          <p className="muted">{delivery}</p>
          {!online && (
            <p className="muted">
              {m.rooms_last_active({
                date: new Date(member.lastActiveAt).toLocaleString(getLocale()),
              })}
            </p>
          )}
          {editing ? (
            <form
              className="member-rename"
              onSubmit={(event) => {
                event.preventDefault();
                rename.run();
              }}
            >
              <Input
                aria-label={m.rooms_member_name()}
                title={m.rooms_member_name_hint()}
                required
                autoFocus
                maxLength={40}
                pattern="[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setEditing(false);
                }}
                disabled={rename.busy}
              />
              <Button size="sm" type="submit" busy={rename.busy}>
                {m.rooms_save()}
              </Button>
            </form>
          ) : (
            (member.owned || room.role === "owner") && (
              <div className="member-actions">
                {member.owned && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={leave.busy}
                    onClick={() => setEditing(true)}
                  >
                    {m.rooms_rename_member()}
                  </Button>
                )}
                <ConfirmAction
                  label={m.rooms_remove_member()}
                  description={m.rooms_remove_confirm({
                    member: member.address,
                  })}
                  busy={leave.busy || rename.busy}
                  onConfirm={() => leave.run()}
                />
              </div>
            )
          )}
          {(rename.error || leave.error) && (
            <Status error>{rename.error || leave.error}</Status>
          )}
        </div>
      </details>
    </li>
  );
}
