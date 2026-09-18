# Live room delivery

A conversation is either in a room or not in it. Busy/idle/shell describe activity,
not membership. Saved account access and a remembered room do not establish presence.
Admission requires a successful hello/welcome exchange on the current WebSocket.

## Sending and confirmation

1. The sender issues one request on its current connection.
2. The Hub resolves only current room conversations and captures the exact recipient
   socket. It rechecks both connections and access after asynchronous authorization.
3. The Hub saves a short-lived receipt route (message ID, request ID, sender ref,
   recipient ref, recipient display label and creation time), then forwards the body.
   There is no message table, persisted body, content fingerprint or offline queue.
4. The recipient atomically saves the message locally and fsyncs it before ACKing.
   A failed write does not acknowledge. The Hub routes the ACK to the original
   sender, deletes the route, and returns `delivered`, `acknowledged: true`.
5. The sender waits up to ten seconds. Timeout or disconnection means **delivery
   unconfirmed**: the recipient might already have saved the message. No automatic
   resend occurs. Manually sending again is a new message and may duplicate work.

A receipt confirms local persistence, not task execution. Rejected addressing or
access checks do not accept the message for later delivery. The wire handshake
requires `relay: 1`; old queue-based peers are not supported.

## Web clients that actively read

Web MCP calls briefly join and leave; the gateway has no persistent room seat or
reply inbox. A web send requests `replyMode: pull`. The Hub forwards an authenticated
sender account/ref, and requires the CLI to advertise `replyCache: true` in hello.
The CLI saves that reply route before acknowledging the incoming message.

A CLI reply to that sender ref is saved in its own local reply cache and returns
`state: cached`, `delivered: false`, `awaitingRead: true`. It is not a Hub send to an
absent recipient. When the web chat calls `read_messages`, the Hub relays a `pull`
to the currently present CLI and routes its `pulled` result back. Pull routes use
the existing expiring receipt metadata; ordinary ACKs cannot complete them and
other sockets cannot supply their result. Reply bodies never enter Hub storage.

The CLI validates both reader ref and account. Subsequent read cursors acknowledge
and clear earlier local replies; lost responses can be read again. Pulls do not
wake the CLI model. See [web MCP development](web-mcp-development.md) for cache
limits, retention, restart behavior and the tool contract.

## Leaving, resuming and storage

`leave` stops local intake immediately and asks the Hub to remove the current
connection. A confirmed response establishes server departure. If confirmation is
unavailable, the result says so and the connection is closed locally. Departure,
replacement, revocation and policy removal delete all receipt routes involving
that conversation. A late event on an old socket cannot affect its replacement.
No additional participation identifier is needed: requests are never replayed.

Conversation refs and names survive restart. Reconnection requests fresh admission
with backoff from one to thirty seconds; explicit leave removes saved rejoin intent.
Resuming a host conversation may rejoin its saved room, but does not replay old sends
or feed old unread content back as newly received work. OpenCode activates sessions
on chat/tool use, without scanning historical conversations.

Received content and seen IDs live in `~/.tandry/inbox/<scope-hash>.json`, scoped to
host, conversation, account, Hub and room. A read removes the unread body; IDs remain
for deduplication. Unread files remain on disk after departure, but are not replayed
on resume. There is no history-browsing UI yet. One live runtime may own a host
conversation; concurrent writers to one journal are unsupported.

The server expires receipt routes after thirty seconds and cleans them periodically.
They survive DO hibernation, which preserves sockets while discarding process memory.
A thirty-second alarm checks presence while conversations are admitted. Automatic
heartbeats run every thirty seconds; a connection silent for ninety seconds is
removed at the next sweep. A missing client pong closes its connection sooner.
Heartbeats do not refresh authorization or business activity. Room retention defaults
to seven days without activity and only destroys rooms with no participants.

This is not E2EE. The Hub processes plaintext transiently while relaying it. Application
logs must not record message bodies. Persistent task boards and announcements would
be separate room objects with explicit retention, not an offline direct-message queue.

## Prelaunch rollout and checks

Use fresh room storage for this incompatible prelaunch schema; there is no legacy
migration. The change does not erase previously created databases or their backups.
Deploy the matching Hub and clients together before launch. Preserve configured
Worker/DO/D1 resource identities. This implementation does not deploy or reset data.

`pnpm build` and `pnpm --filter @tandryio/bridge test` exercise the actual local
workerd/SQLite Hub with synthetic credentials. Coverage includes receipt/ACK loss,
recipient disk failure, departure, restart without replay, foreign ACK rejection,
addressing and authorization races, and inspection for persisted synthetic bodies.
