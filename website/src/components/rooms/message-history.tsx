import {
  hostLabel,
  type HistoryMessage,
  type RoomId,
} from "@tandryio/protocol";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { m } from "../../paraglide/messages";
import { getLocale } from "../../paraglide/runtime";
import { call } from "../../lib/hub";
import { useAction } from "../../lib/action";
import { errorText } from "../../lib/i18n";
import { ConfirmAction } from "../confirm-action";
import { Badge, Button, Status } from "../ui";

export function MessageHistory({
  roomId,
  userId,
  view,
}: {
  roomId: RoomId;
  userId: string;
  view: "room" | "correspondence";
}) {
  const history = useInfiniteQuery({
    queryKey: ["room", userId, roomId, "history", view],
    queryFn: ({ pageParam }) =>
      call("history", { before: pageParam, view }, roomId),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
    refetchInterval: 5_000,
  });
  const messages =
    history.data?.pages.flatMap((page) => [...page.messages].reverse()) ?? [];
  return (
    <section className="message-history">
      <p className="muted">
        {view === "room"
          ? m.rooms_history_hint()
          : m.rooms_correspondence_hint()}
      </p>
      {history.isPending ? (
        <p role="status">{m.common_loading()}</p>
      ) : (
        <>
          {history.error && (
            <Status error>
              {errorText(history.error)}{" "}
              <Button onClick={() => history.refetch()}>
                {m.common_retry()}
              </Button>
            </Status>
          )}
          {!history.error && !messages.length && (
            <p className="account-card empty">{m.rooms_no_messages()}</p>
          )}
          <ol className="message-list">
            {messages.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                roomId={roomId}
                userId={userId}
              />
            ))}
          </ol>
          {history.hasNextPage && (
            <Button
              busy={history.isFetchingNextPage}
              onClick={() => history.fetchNextPage()}
            >
              {m.rooms_load_older()}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function MessageCard({
  message,
  roomId,
  userId,
}: {
  message: HistoryMessage;
  roomId: RoomId;
  userId: string;
}) {
  const client = useQueryClient();
  const remove = useAction(
    () => call("delete_message", { id: message.id }, roomId),
    {
      onSuccess: () =>
        client.invalidateQueries({ queryKey: ["room", userId, roomId] }),
    },
  );
  const states = {
    unread: m.rooms_unread,
    read: m.rooms_read,
    replied: m.rooms_replied,
    left: m.rooms_left,
  };
  return (
    <li className="account-card message-card" id={message.id}>
      <div className="message-heading">
        <div>
          <strong>{message.from}</strong>
          <span className="muted">{hostLabel(message.fromHost)}</span>
        </div>
        <time dateTime={new Date(message.createdAt).toISOString()}>
          {new Date(message.createdAt).toLocaleString(getLocale())}
        </time>
      </div>
      <div className="message-routing">
        <Badge>
          {message.visibility === "dm"
            ? m.rooms_dm()
            : message.kind === "intro"
              ? m.rooms_intro()
              : m.rooms_public()}
        </Badge>
        <span>
          {m.rooms_to({
            recipients: message.toRoom
              ? "@room"
              : message.to.join(", ") || m.rooms_no_recipients(),
          })}
        </span>
      </div>
      {message.replyTo && (
        <details className="message-reference">
          <summary>{m.rooms_reply_to()}</summary>
          <code>{message.replyTo}</code>
        </details>
      )}
      {message.deletedAt !== undefined ? (
        <p className="muted">{m.rooms_message_deleted()}</p>
      ) : (
        <p className="message-body">{message.body}</p>
      )}
      {!!message.recipients?.length && (
        <ul className="recipient-states" aria-label={m.rooms_delivery_status()}>
          {message.recipients.map((recipient, index) => (
            <li key={`${index}-${recipient.address}`}>
              <span>{recipient.address}</span>
              <Badge
                tone={
                  recipient.state === "unread"
                    ? "warning"
                    : recipient.state === "left"
                      ? "neutral"
                      : "success"
                }
              >
                {states[recipient.state]()}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {message.owned && message.deletedAt === undefined && (
        <ConfirmAction
          label={m.rooms_delete_message()}
          description={m.rooms_delete_confirm()}
          busy={remove.busy}
          onConfirm={() => remove.run()}
        />
      )}
      {remove.error && <Status error>{remove.error}</Status>}
    </li>
  );
}
