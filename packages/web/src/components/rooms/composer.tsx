import {
  hostLabel,
  newId,
  ROOM_ADDRESS,
  type HistoryMessage,
  type MemberAddress,
  type MemberView,
  type RoomId,
} from "@tandryio/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { m } from "../../paraglide/messages";
import { call } from "../../lib/hub";
import { cn } from "../../lib/cn";
import { useAction } from "../../lib/action";
import { Icon, Status } from "../ui";
import { MemberAvatar } from "./host-avatar";

/** What agents read about the website member. Protocol-facing, so English. */
const WEBSITE_INTRO =
  "The account owner in person, writing from the Tandry website.";

/** The textarea grows with its text up to this height, then scrolls. */
const MAX_INPUT_HEIGHT = 200;

type Recipient = typeof ROOM_ADDRESS | MemberAddress;

/** The `@query` being typed just before the caret, if any. */
function mentionAt(text: string, caret: number) {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return match
    ? { start: caret - match[2]!.length - 1, query: match[2]!.toLowerCase() }
    : null;
}

/** Lower is better: the member name's start, then the handle's, then anywhere. */
function matchRank(member: MemberView, query: string): number {
  const address = member.address.toLowerCase();
  const [handle = "", name = ""] = address.split("/");
  if (name.startsWith(query)) return 0;
  if (handle.startsWith(query)) return 1;
  if (address.includes(query)) return 2;
  if (hostLabel(member.host).toLowerCase().includes(query)) return 3;
  return Infinity;
}

/**
 * Where the owner writes into the room. Recipients are tags chosen by typing
 * `@`, as in a chat app, and a message needs at least one: `@room` is a choice,
 * never a default, because every recipient is woken. A reply without tags goes
 * where the Hub's reply rule sends it. The website speaks only as
 * the account's own website member; the first message joins it, since that
 * member takes no member place and joining again only reuses it.
 */
export function Composer({
  roomId,
  userId,
  self,
  members,
  replyTo,
  onCancelReply,
  onShowCorrespondence,
}: {
  roomId: RoomId;
  userId: string;
  /** The account's website member here, once it has joined. */
  self?: MemberAddress;
  members: MemberView[];
  replyTo?: HistoryMessage;
  onCancelReply: () => void;
  /** Given while the public history is shown, where a dm does not appear. */
  onShowCorrespondence?: () => void;
}) {
  const client = useQueryClient();
  const menuId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [dm, setDm] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  // Escape closes the list for the mention it was open on.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [sentPrivately, setSentPrivately] = useState(false);
  // Set when a send was tried without recipients; cleared once one is chosen.
  const [unaddressed, setUnaddressed] = useState(false);
  // One ID per draft: it is the idempotency key, so a retry cannot post twice.
  const id = useRef(newId("m"));

  const others = members.filter((member) => member.address !== self);
  // Tags for members who have since left are dropped rather than sent.
  const chosen = recipients.filter(
    (recipient) =>
      recipient === ROOM_ADDRESS ||
      others.some((member) => member.address === recipient),
  );
  const named = chosen.filter(
    (recipient): recipient is MemberAddress => recipient !== ROOM_ADDRESS,
  );
  const privately = dm && !!named.length && !replyTo;

  const mention = mentionAt(body, caret);
  const options = mention
    ? [
        ...("room".includes(mention.query) ? [ROOM_ADDRESS] : []),
        ...others
          .map((member) => ({
            address: member.address,
            rank: matchRank(member, mention.query),
          }))
          .filter((match) => match.rank < Infinity)
          .sort((a, b) => a.rank - b.rank)
          .map((match) => match.address),
      ].filter((option) => !chosen.includes(option))
    : [];
  const open = !!mention && dismissed !== mention.start;
  const highlighted = Math.min(active, Math.max(options.length - 1, 0));

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [body]);

  const send = useAction(
    async () => {
      if (!self)
        await call(
          "join",
          { intro: WEBSITE_INTRO, workspace: { repo: "", branch: "" } },
          roomId,
          true,
        );
      return call(
        "send",
        {
          id: id.current,
          // No tags: the room, or, for a reply, the Hub's reply rule.
          // No tags only on a reply: the Hub's reply rule then names them.
          to: chosen.includes(ROOM_ADDRESS) ? ROOM_ADDRESS : named,
          body,
          dm: privately,
          replyTo: replyTo?.id,
        },
        roomId,
        true,
      );
    },
    {
      onSuccess: async () => {
        id.current = newId("m");
        setSentPrivately(privately);
        setBody("");
        onCancelReply();
        await client.invalidateQueries({
          queryKey: ["room", userId, roomId],
        });
      },
    },
  );
  const addressed = !!chosen.length || !!replyTo;
  const submit = () => {
    if (send.busy || !body.trim()) return;
    if (addressed) send.run();
    else setUnaddressed(true);
  };

  const choose = (option: Recipient) => {
    if (!mention) return;
    // The tag replaces the `@query` that chose it.
    const next = body.slice(0, mention.start) + body.slice(caret);
    setBody(next);
    setCaret(mention.start);
    setUnaddressed(false);
    setRecipients(
      option === ROOM_ADDRESS
        ? [ROOM_ADDRESS]
        : [...chosen.filter((item) => item !== ROOM_ADDRESS), option],
    );
    setActive(0);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(mention.start, mention.start);
    });
  };
  const startMention = () => {
    const element = input.current;
    if (!element) return;
    const at = element.selectionStart ?? body.length;
    const prefix = at > 0 && !/\s/.test(body[at - 1]!) ? " @" : "@";
    setBody(body.slice(0, at) + prefix + body.slice(at));
    setCaret(at + prefix.length);
    setDismissed(null);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(at + prefix.length, at + prefix.length);
    });
  };

  // A reply without tags: show where the Hub's reply rule will send it.
  const defaults: string[] =
    chosen.length || !replyTo
      ? []
      : replyTo.visibility === "room"
        ? [replyTo.from]
        : [replyTo.from, ...replyTo.to].filter((address) => address !== self);
  const memberOf = (address: string) =>
    others.find((member) => member.address === address);

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="composer-box">
        {open && (
          <ul
            id={menuId}
            role="listbox"
            aria-label={m.rooms_compose_mention()}
            className="mention-menu"
          >
            {options.length ? (
              options.map((option, index) => {
                const member = memberOf(option);
                const online = member?.state === "online";
                return (
                  <li
                    key={option}
                    id={`${menuId}-${index}`}
                    role="option"
                    aria-selected={index === highlighted}
                    className={cn(
                      "mention-option",
                      index === highlighted && "is-active",
                    )}
                    // Keep focus in the textarea while choosing.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option)}
                  >
                    {member ? (
                      <MemberAvatar
                        address={member.address}
                        host={member.host}
                        owned={member.owned}
                        avatar={member.avatar}
                      />
                    ) : (
                      <span className="mention-room-icon">
                        <Icon name="mention" />
                      </span>
                    )}
                    <span className="mention-text">
                      <strong>{option}</strong>
                      <span>
                        {member ? (
                          <>
                            <span
                              className={`presence-dot is-${online ? (member.busy ? "busy" : "online") : "offline"}`}
                              aria-hidden="true"
                            />
                            {hostLabel(member.host)} ·{" "}
                            {online
                              ? member.busy
                                ? m.rooms_busy()
                                : m.rooms_online()
                              : m.rooms_offline()}
                          </>
                        ) : (
                          m.rooms_compose_everyone({ count: others.length })
                        )}
                      </span>
                    </span>
                  </li>
                );
              })
            ) : (
              <li className="mention-empty">{m.rooms_compose_no_match()}</li>
            )}
          </ul>
        )}
        {replyTo && (
          <div className="composer-reply">
            <Icon name="reply" />
            <span>
              {m.rooms_compose_replying()} <strong>{replyTo.from}</strong>
            </span>
            <span className="composer-reply-excerpt">{replyTo.body}</span>
            <button
              type="button"
              className="composer-icon-button"
              aria-label={m.rooms_compose_cancel_reply()}
              title={m.rooms_compose_cancel_reply()}
              onClick={onCancelReply}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="composer-recipients">
          <span className="composer-to">{m.rooms_compose_to()}</span>
          {chosen.map((recipient) => {
            const member = memberOf(recipient);
            return (
              <span
                key={recipient}
                className={cn(
                  "recipient-tag",
                  recipient === ROOM_ADDRESS && "is-room",
                )}
              >
                {member && (
                  <MemberAvatar
                    address={member.address}
                    host={member.host}
                    owned={member.owned}
                    avatar={member.avatar}
                  />
                )}
                {recipient}
                <button
                  type="button"
                  aria-label={m.rooms_compose_remove({ name: recipient })}
                  title={m.rooms_compose_remove({ name: recipient })}
                  onClick={() =>
                    setRecipients(chosen.filter((item) => item !== recipient))
                  }
                >
                  <Icon name="close" />
                </button>
              </span>
            );
          })}
          {defaults.map((address) => (
            <span key={address} className="recipient-tag is-default">
              {address}
            </span>
          ))}
          {addressed ? (
            // Another recipient; typing `@` in the message works as well.
            <button
              type="button"
              className="recipient-prompt is-compact"
              aria-label={m.rooms_compose_add()}
              title={m.rooms_compose_add()}
              onClick={startMention}
            >
              <Icon name="mention" />
            </button>
          ) : (
            <button
              type="button"
              className={cn("recipient-prompt", unaddressed && "is-needed")}
              onClick={startMention}
            >
              <Icon name="mention" />
              {unaddressed
                ? m.rooms_compose_need_recipient()
                : m.rooms_compose_pick()}
            </button>
          )}
          {privately && (
            <span className="composer-private-note">
              <Icon name="lock" />
              {m.rooms_compose_private_hint()}
            </span>
          )}
        </div>
        <textarea
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && options.length ? `${menuId}-${highlighted}` : undefined
          }
          aria-label={m.rooms_compose_label()}
          placeholder={m.rooms_compose_placeholder()}
          rows={1}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setSentPrivately(false);
            setCaret(event.target.selectionStart);
            setActive(0);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onBlur={() => mention && setDismissed(mention.start)}
          onFocus={() => setDismissed(null)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (open && options.length) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive(
                  (highlighted + step + options.length) % options.length,
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                choose(options[highlighted]!);
                return;
              }
            }
            // An open list owns Enter: with no match it closes, never sends a half-typed `@`.
            if (open && (event.key === "Escape" || event.key === "Enter")) {
              // Close the list, not the full-screen view around it.
              event.preventDefault();
              setDismissed(mention!.start);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            } else if (
              event.key === "Backspace" &&
              chosen.length &&
              event.currentTarget.selectionStart === 0 &&
              event.currentTarget.selectionEnd === 0
            ) {
              setRecipients(chosen.slice(0, -1));
            }
          }}
        />
        <div className="composer-toolbar">
          {!!named.length && !replyTo && (
            <button
              type="button"
              className={cn("composer-pill", dm && "is-on")}
              aria-pressed={dm}
              title={m.rooms_compose_private_hint()}
              onClick={() => setDm(!dm)}
            >
              <Icon name="lock" />
              {m.rooms_compose_private()}
            </button>
          )}
          <span className="composer-hint">
            {self ? m.rooms_compose_keys() : m.rooms_compose_first()}
          </span>
          <button
            type="submit"
            className="composer-send"
            aria-label={m.rooms_compose_send()}
            title={m.rooms_compose_send()}
            aria-busy={send.busy || undefined}
            disabled={send.busy || !body.trim()}
          >
            <Icon name="send" />
          </button>
        </div>
      </div>
      {send.error && <Status error>{send.error}</Status>}
      {sentPrivately && onShowCorrespondence && (
        <p className="composer-sent" role="status">
          <Icon name="lock" />
          {m.rooms_compose_sent_private()}
          <button type="button" onClick={onShowCorrespondence}>
            {m.rooms_correspondence()}
          </button>
        </p>
      )}
    </form>
  );
}
