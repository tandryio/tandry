import type { RoomSummary } from "@tandryio/protocol";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { m } from "../../paraglide/messages";
import { useAction } from "../../lib/action";
import { call } from "../../lib/hub";
import { Button, Icon, Status } from "../ui";

export function RoomActions({
  room,
  userId,
  onDeleted,
}: {
  room: RoomSummary;
  userId: string;
  onDeleted: () => Promise<void>;
}) {
  const client = useQueryClient();
  const [action, setAction] = useState<"rotate" | "delete" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const close = () => {
    setAction(null);
    trigger.current?.focus();
  };
  const update = useAction(
    () => call("update_room", { room: room.id, rotateCode: true }),
    {
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: ["rooms", userId] });
        close();
      },
    },
  );
  const deletion = useAction(() => call("delete_room", { room: room.id }), {
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: ["room", userId, room.id] });
      client.removeQueries({ queryKey: ["room", userId, room.id] });
      await onDeleted();
      await client.invalidateQueries({ queryKey: ["rooms", userId] });
    },
  });
  const operation = action === "delete" ? deletion : update;
  const deleting = action === "delete";
  useEffect(() => {
    if (action) dialog.current?.showModal();
  }, [action]);
  const open = (value: "rotate" | "delete") => {
    update.reset();
    deletion.reset();
    setAction(value);
  };
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            ref={trigger}
            variant="ghost"
            size="icon"
            className="room-actions-trigger"
            aria-label={m.rooms_actions()}
            title={m.rooms_actions()}
          >
            <Icon name="more" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          className="ui-menu room-actions-menu"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            if (action) event.preventDefault();
          }}
        >
          <DropdownMenu.Label className="ui-menu-label">
            {m.rooms_actions()}
          </DropdownMenu.Label>
          <DropdownMenu.Item onSelect={() => open("rotate")}>
            <Icon name="refresh" />
            {m.rooms_rotate_code()}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="ui-menu-separator" />
          <DropdownMenu.Item
            className="room-menu-danger"
            onSelect={() => open("delete")}
          >
            <Icon name="trash" />
            {m.rooms_delete()}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      {action && (
        <dialog
          ref={dialog}
          className="room-dialog room-action-dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onClose={close}
          onCancel={(event) => {
            event.stopPropagation();
            if (operation.busy) event.preventDefault();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget && !operation.busy)
              dialog.current?.close();
          }}
        >
          <div className="room-action-content">
            <div className="room-action-topline">
              <span
                className={`room-action-symbol${deleting ? " is-danger" : ""}`}
              >
                <Icon name={deleting ? "trash" : "refresh"} />
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={m.common_cancel()}
                disabled={operation.busy}
                onClick={() => dialog.current?.close()}
              >
                <Icon name="close" />
              </Button>
            </div>
            <h2 id={titleId}>
              {deleting ? m.rooms_delete_title() : m.rooms_rotate_title()}
            </h2>
            <p id={descriptionId}>
              {deleting
                ? m.rooms_delete_room_confirm({ name: room.name })
                : m.rooms_rotate_confirm()}
            </p>
            <div className="room-action-context">
              <Icon name="rooms" />
              <span>{room.name}</span>
              {!deleting && room.code && <code>{room.code}</code>}
            </div>
            {operation.error && <Status error>{operation.error}</Status>}
            <div className="room-action-footer">
              <Button
                autoFocus
                variant="secondary"
                disabled={operation.busy}
                onClick={() => dialog.current?.close()}
              >
                {m.common_cancel()}
              </Button>
              <Button
                variant={deleting ? "danger" : "primary"}
                busy={operation.busy}
                onClick={() => operation.run()}
              >
                {deleting
                  ? m.rooms_delete_permanently()
                  : m.rooms_rotate_code()}
              </Button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
