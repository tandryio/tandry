import type { RoomSummary } from "@tandryio/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { m } from "../../paraglide/messages";
import { call } from "../../lib/hub";
import { errorText } from "../../lib/i18n";
import { useAction } from "../../lib/action";
import { ConfirmAction } from "../confirm-action";
import { Badge, Button, Icon, Status } from "../ui";
import { MemberList } from "./member-list";
import { MessageHistory } from "./message-history";

export function RoomDetail({
  room,
  userId,
}: {
  room: RoomSummary;
  userId: string;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!fullscreen || !container.current) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const siblings: Array<{ element: HTMLElement; inert: boolean }> = [];
    for (
      let node: HTMLElement | null = container.current;
      node?.parentElement;
      node = node.parentElement
    ) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && sibling instanceof HTMLElement) {
          siblings.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      if (node.parentElement === document.body) break;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setFullscreen(false);
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          container.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ) ?? [],
        ).filter(
          (element) =>
            element.getClientRects().length && !element.closest("[inert]"),
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      for (const { element, inert } of siblings) element.inert = inert;
      document.removeEventListener("keydown", onKeyDown);
      fullscreenButton.current?.focus();
    };
  }, [fullscreen]);
  const [view, setView] = useState<"room" | "correspondence">("room");
  const [copied, setCopied] = useState<"" | "done" | "failed">("");
  const members = useQuery({
    queryKey: ["room", userId, room.id, "members"],
    queryFn: () => call("members", {}, room.id),
    refetchInterval: 5_000,
  });
  const count = members.data?.members.length;
  // History names senders by address; their pictures come with the member list.
  const avatars = new Map(
    (members.data?.members ?? []).flatMap((member) =>
      member.avatar
        ? [[member.address.split("/")[0]!, member.avatar] as const]
        : [],
    ),
  );
  return (
    <div
      ref={container}
      className={`room-chat${fullscreen ? " room-chat-fullscreen" : ""}`}
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? room.name : undefined}
    >
      <header className="room-chat-header">
        <div className="room-chat-title">
          <h2>
            <RoomField room={room} userId={userId} field="name" />
            <Badge>
              {room.role === "owner" ? m.rooms_owner() : m.rooms_member_role()}
            </Badge>
          </h2>
          {(room.description || room.role === "owner") && (
            <div className="room-description-line">
              <RoomField room={room} userId={userId} field="description" />
            </div>
          )}
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
          {room.role === "owner" && (
            <RoomCodeReset room={room} userId={userId} />
          )}
          <Button
            ref={fullscreenButton}
            variant="ghost"
            size="sm"
            aria-pressed={fullscreen}
            onClick={() => setFullscreen(!fullscreen)}
          >
            <Icon name={fullscreen ? "minimize" : "maximize"} />
            {fullscreen ? m.rooms_exit_fullscreen() : m.rooms_fullscreen()}
          </Button>
          <span className="sr-only" aria-live="polite">
            {copied === "done" ? m.rooms_code_copied() : ""}
          </span>
        </div>
      </header>
      {copied === "failed" && <Status error>{m.rooms_copy_failed()}</Status>}
      <div className="room-chat-body">
        <aside className="room-chat-side">
          <h3 className="room-chat-side-title">
            {m.rooms_members()}
            {count !== undefined && <span className="count">{count}</span>}
          </h3>
          {members.isPending ? (
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
        <MessageHistory
          key={view}
          roomId={room.id}
          userId={userId}
          view={view}
          avatars={avatars}
        />
      </div>
    </div>
  );
}

function RoomField({
  room,
  userId,
  field,
}: {
  room: RoomSummary;
  userId: string;
  field: "name" | "description";
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(room[field]);
  const trigger = useRef<HTMLButtonElement>(null);
  const label =
    field === "name" ? m.rooms_edit_name() : m.rooms_edit_description();
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const update = useAction(
    () => call("update_room", { room: room.id, [field]: draft }),
    {
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: ["rooms", userId] });
        close();
      },
    },
  );
  const save = () => {
    if (update.busy || (field === "name" && !draft.trim())) return;
    if (draft === room[field]) close();
    else update.run();
  };
  if (room.role !== "owner") return <span>{room[field]}</span>;
  return (
    <span className={`room-inline-field room-inline-field-${field}`}>
      {editing ? (
        <span
          className="room-inline-editor"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (!update.busy) close();
            } else if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              save();
            }
          }}
        >
          {field === "name" ? (
            <input
              autoFocus
              aria-label={label}
              className="room-inline-input"
              value={draft}
              maxLength={80}
              disabled={update.busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          ) : (
            <textarea
              autoFocus
              aria-label={label}
              className="room-inline-input"
              value={draft}
              maxLength={500}
              rows={2}
              disabled={update.busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            className="room-inline-action"
            aria-label={m.rooms_save()}
            title={m.rooms_save()}
            busy={update.busy}
            disabled={field === "name" && !draft.trim()}
            onClick={save}
          >
            <Icon name="check" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="room-inline-action"
            aria-label={m.common_cancel()}
            title={m.common_cancel()}
            disabled={update.busy}
            onClick={close}
          >
            <Icon name="close" />
          </Button>
        </span>
      ) : (
        <button
          ref={trigger}
          type="button"
          className="room-inline-trigger"
          aria-label={label}
          title={label}
          onClick={() => {
            setDraft(room[field]);
            update.reset();
            setEditing(true);
          }}
        >
          <span>{room[field] || m.rooms_add_description()}</span>
          <Icon name="edit" />
        </button>
      )}
      {editing && update.error && (
        <span className="room-inline-error" role="alert">
          {update.error}
        </span>
      )}
    </span>
  );
}

function RoomCodeReset({
  room,
  userId,
}: {
  room: RoomSummary;
  userId: string;
}) {
  const client = useQueryClient();
  const update = useAction(
    () => call("update_room", { room: room.id, rotateCode: true }),
    {
      onSuccess: () =>
        client.invalidateQueries({ queryKey: ["rooms", userId] }),
    },
  );
  return (
    <details key={room.code} className="room-code-options">
      <summary
        aria-label={m.rooms_code_options()}
        title={m.rooms_code_options()}
      >
        <Icon name="chevron" />
      </summary>
      <ConfirmAction
        label={m.rooms_rotate_code()}
        description={m.rooms_rotate_confirm()}
        busy={update.busy}
        onConfirm={update.run}
      />
      {update.error && <Status error>{update.error}</Status>}
    </details>
  );
}
