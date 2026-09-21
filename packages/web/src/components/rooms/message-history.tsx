import type { HistoryMessage, RoomId } from "@tandryio/protocol";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef } from "react";
import { m } from "../../paraglide/messages";
import { getLocale } from "../../paraglide/runtime";
import { call } from "../../lib/hub";
import { cn } from "../../lib/cn";
import { useAction } from "../../lib/action";
import { errorText } from "../../lib/i18n";
import { ConfirmAction } from "../confirm-action";
import { Badge, Button, Icon, Status } from "../ui";
import { MemberAvatar } from "./host-avatar";
import { MarkdownBody } from "./markdown";

/** Consecutive messages from one sender within this gap share a header. */
const GROUP_GAP_MS = 5 * 60_000;

/**
 * A room read as a chat: oldest at the top, newest at the bottom, messages
 * grouped by sender. The website is an observer and cannot post, so the
 * place a composer would take explains where messages come from instead.
 */
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
  // Pages arrive newest first; each page is oldest first.
  const messages =
    history.data?.pages
      .slice()
      .reverse()
      .flatMap((page) => page.messages) ?? [];
  const byId = new Map(messages.map((message) => [message.id, message]));

  const scroller = useRef<HTMLDivElement>(null);
  // Follow new messages only while the reader is at the bottom.
  const following = useRef(true);
  // Height before older messages were prepended, to keep the view in place.
  const heightBeforeOlder = useRef<number | null>(null);
  const first = messages[0]?.id;
  const last = messages.at(-1)?.id;
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (heightBeforeOlder.current !== null) {
      element.scrollTop += element.scrollHeight - heightBeforeOlder.current;
      heightBeforeOlder.current = null;
    } else if (following.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [first, last]);

  const locale = getLocale();
  const today = new Date().toDateString();
  const todayLabel = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
  }).format(0, "day");
  return (
    <section className="chat">
      <div
        ref={scroller}
        className="chat-scroll"
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            48;
        }}
      >
        {history.isPending ? (
          <p className="chat-empty" role="status">
            {m.common_loading()}
          </p>
        ) : history.error ? (
          <Status error>
            {errorText(history.error)}{" "}
            <Button size="sm" onClick={() => history.refetch()}>
              {m.common_retry()}
            </Button>
          </Status>
        ) : !messages.length ? (
          <p className="chat-empty">{m.rooms_no_messages()}</p>
        ) : (
          <>
            {history.hasNextPage && (
              <Button
                size="sm"
                variant="ghost"
                className="chat-older"
                busy={history.isFetchingNextPage}
                onClick={() => {
                  heightBeforeOlder.current =
                    scroller.current?.scrollHeight ?? null;
                  history.fetchNextPage();
                }}
              >
                {m.rooms_load_older()}
              </Button>
            )}
            <ol className="chat-list">
              {messages.map((message, index) => {
                const previous = messages[index - 1];
                const day = new Date(message.createdAt).toDateString();
                const newDay =
                  !previous ||
                  new Date(previous.createdAt).toDateString() !== day;
                const continued =
                  !newDay &&
                  !!previous &&
                  previous.from === message.from &&
                  previous.visibility === message.visibility &&
                  previous.kind !== "intro" &&
                  message.kind !== "intro" &&
                  message.createdAt - previous.createdAt < GROUP_GAP_MS;
                return (
                  <li key={message.id} className="chat-item">
                    {newDay && (
                      <div className="chat-day" role="separator">
                        <span>
                          {day === today
                            ? todayLabel
                            : new Date(message.createdAt).toLocaleDateString(
                                locale,
                                {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                },
                              )}
                        </span>
                      </div>
                    )}
                    <ChatMessage
                      message={message}
                      quoted={
                        message.replyTo ? byId.get(message.replyTo) : undefined
                      }
                      continued={continued}
                      roomId={roomId}
                      userId={userId}
                    />
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
      <footer className="chat-footer">
        <Icon name="info" />
        <p>
          {view === "room"
            ? m.rooms_history_hint()
            : m.rooms_correspondence_hint()}
        </p>
      </footer>
    </section>
  );
}

function ChatMessage({
  message,
  quoted,
  continued,
  roomId,
  userId,
}: {
  message: HistoryMessage;
  quoted?: HistoryMessage;
  continued: boolean;
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
  const created = new Date(message.createdAt);
  const deleted = message.deletedAt !== undefined;
  const time = (
    <time
      dateTime={created.toISOString()}
      title={created.toLocaleString(getLocale())}
    >
      {created.toLocaleTimeString(getLocale(), {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );

  if (message.kind === "intro")
    return (
      <div className="chat-joined" id={message.id}>
        <MemberAvatar
          address={message.from}
          host={message.fromHost}
          owned={message.owned}
        />
        <p title={deleted ? undefined : message.body}>
          <strong>{message.from}</strong> {m.rooms_joined_room()}
          {!deleted && message.body && <span>{message.body}</span>}
        </p>
        {time}
      </div>
    );

  const directed = message.visibility === "dm" || !message.toRoom;
  return (
    <article
      id={message.id}
      className={cn(
        "chat-message",
        message.owned && "is-own",
        continued && "is-continued",
        message.visibility === "dm" && "is-dm",
      )}
    >
      {continued ? (
        <span className="chat-gutter">{time}</span>
      ) : (
        <MemberAvatar
          address={message.from}
          host={message.fromHost}
          owned={message.owned}
        />
      )}
      <div className="chat-content">
        {!continued && (
          <header className="chat-meta">
            <strong>{message.from}</strong>
            {time}
          </header>
        )}
        <div className="chat-bubble">
          {(directed || !!message.recipients?.length) && (
            <div className="chat-routing">
              {message.visibility === "dm" && <Badge>{m.rooms_dm()}</Badge>}
              <span>{m.rooms_to_label()}</span>
              {message.toRoom && <span>@room</span>}
              {message.recipients?.length ? (
                <ul
                  className="chat-receipts"
                  aria-label={m.rooms_delivery_status()}
                >
                  {message.recipients.map((recipient, index) => (
                    <li
                      key={`${index}-${recipient.address}`}
                      className={`is-${recipient.state}`}
                      title={states[recipient.state]()}
                    >
                      <span aria-hidden="true" />
                      {recipient.address}
                      <span className="sr-only">
                        {states[recipient.state]()}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                !message.toRoom && (
                  <span>
                    {message.to.join(", ") || m.rooms_no_recipients()}
                  </span>
                )
              )}
            </div>
          )}
          {message.replyTo && (
            <a className="chat-quote" href={`#${message.replyTo}`}>
              {quoted ? (
                <>
                  <strong>{quoted.from}</strong>
                  <span>
                    {quoted.deletedAt !== undefined
                      ? m.rooms_message_deleted()
                      : quoted.body}
                  </span>
                </>
              ) : (
                <span>{m.rooms_reply_to()}</span>
              )}
            </a>
          )}
          {deleted ? (
            <p className="chat-body is-deleted">{m.rooms_message_deleted()}</p>
          ) : (
            <MarkdownBody className="chat-body" body={message.body} />
          )}
        </div>
        {message.owned && !deleted && (
          <span className="chat-actions">
            <ConfirmAction
              label={m.rooms_delete_message()}
              description={m.rooms_delete_confirm()}
              busy={remove.busy}
              onConfirm={() => remove.run()}
            />
          </span>
        )}
        {remove.error && <Status error>{remove.error}</Status>}
      </div>
    </article>
  );
}
