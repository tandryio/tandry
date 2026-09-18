# Room participation product review

Reviewed: 2026-09-16.

Implementation update: the selected design is documented in
[Live room delivery](delivery-reliability.md). To keep the product and implementation
small, it uses the existing conversation ref and exact WebSocket ownership, with
no additional participation ID, outbox or automatic message retries. The findings
below describe the earlier implementation; ID/epoch and retry proposals were not
adopted.

Original review: Scope: current public working tree, with a separate read-only
check of the private composition. This is a product/implementation review, not an
implementation or production deployment audit. No private implementation is
included here.

## Product contract

A conversation is either in a room or not in a room. There is no user-facing
offline member, notification subscription mode, or offline mailbox.

- An admitted conversation appears in the room and can receive messages.
- Busy, idle and shell describe what an admitted agent is doing. They do not
  change whether the conversation is in the room.
- A conversation outside the room cannot send or receive new room messages.
- A remembered room or an account's access permission does not establish current
  conversation participation.
- Transport reconnection is an implementation detail. A bounded recovery window
  needs an explicit contract; an unreachable transport must not imply that a
  message was delivered or accepted for later offline delivery.
- Leaving ends the current participation and any automatic delivery retries
  associated with it. Joining again starts a new participation, even when the
  host conversation and its stable ref are unchanged.

An explicit leave prevents automatic rejoin. Retaining the existing convenience
of automatically rejoining on host conversation resume is reasonable, but it is
a new admission request, not uninterrupted membership or recovery of offline mail.
New/forked conversations still require an explicit join.

## Findings and required changes

### P1: Discovery and addressing disagree

`packages/hub/src/room.ts` lists `onlineVisibleSessions()` for the `list` operation.
Its `onSend()` instead resolves names, refs and handles from retained session rows
without requiring the target to be currently participating. It checks account
access, persists the message, and can return a queued result without a live target.
`markGone()` only changes the session's online flag.

Result: a conversation disappears from the list, but someone who remembers its
name/ref can still send it a new message. Retained departed sessions can also make
handle or name resolution ambiguous.

Use one authoritative current-participation predicate for discovery, exact target
resolution, send authorization, receive authorization and capacity. Resolve
ambiguity among current participants only; never redirect an old exact address to
a different conversation. Recheck both parties after asynchronous authorization
and immediately before forwarding.

### P1: Explicit leave is only a local detach and socket close

`packages/bridge/src/runtime.ts` handles leave with `applyState({ room: null })`.
`HubClient.close()` terminates the socket; the wire protocol has no explicit
conversation leave operation. The server retains a historical session record.

Add a server-recognized leave operation or an equivalent authenticated endpoint
that invalidates the current participation. Stop local intake/retries immediately;
server confirmation establishes the remote boundary. When connectivity prevents
confirmation, report the limitation and rely on bounded expiry, not an assertion
that the remote state changed instantly.

Do not remove the account's room access simply because one of its conversations
leaves. Account revocation remains a separate owner action.

### P1: Rejoining revives old pending sends

`restoreJournal()` scopes journals by host, conversation, Hub, room and account.
Leaving or switching detaches that journal; returning to the same room reloads
the same outbox and unread entries. `flush()` resumes the pending sends.

Keep stable conversation identity separate from an admission/participation ID.
Each message must bind both sender and recipient participation IDs. Explicit leave,
expiry, removal and room switching end that interval. New admission must not make
old messages eligible again.

Stop retrying old outgoing entries and preserve an accurate terminal status:
definitely not sent when known, or result unknown if a recipient could already
have persisted the message. Do not label every interruption as cancellation.
Already received local content can remain as history; it must not be silently
treated as newly received work in a later participation. Its read/history UX is
a separate decision, not permission to delete user data during this review.

### P1: Saved intent is reported as present membership

`canDeliver()` relies on `saved.room` and absence of some error flags, without
requiring a confirmed current admission. `inspect()` exports `joined`, `connected`
and `listening` as separate concepts. `send()` can enqueue a new body while the
connection is down, and `listRooms()` uses this local predicate for its current
room marker.

Separate saved rejoin intent, current server admission, and internal transport
health. Report room participation from a confirmed, unexpired admission. During
recovery, explain an operation's temporary unavailability rather than presenting
an offline-member mode or accepting an indefinite local send queue.

Do not reduce this to `joined = socket.open`: a newly opened socket is not
admission, while a bounded transport recovery period may preserve admission.
Keep the existing join requirement to await `welcome` and reject full rooms.

### P1: Reliable delivery currently transfers custody to server storage

`RoomStore.storeMessage()` stores the body and a second copy in the idempotency
payload before forwarding. ACK updates delivery fields but does not remove the
body. Bridge removes an outgoing entry as soon as Hub acceptance returns; later
recipient ACK is not the criterion for retiring the sender's outbox.

The room-only participation model makes offline queues unnecessary, but does not
by itself forbid persistence. If adopting the discussed no-server-body-retention
policy, change these parts together:

1. Sender saves the exact message and current participation addresses locally.
2. Hub validates current participation and forwards without persisting the body.
3. Recipient persists the body and logical seen ID, then acknowledges receipt.
4. Hub routes the ACK to the sender; sender retires the pending body only then.
5. Retry only the original message, within the same valid participation and a
   bounded delivery deadline. Ended participation cannot receive a retry.
6. Recipient deduplicates across lost ACKs and process restarts. Metadata-only
   receipts/tombstones may have a bounded server lifetime without retaining bodies.

Use user-facing outcomes such as delivered, not delivered and result unknown.
An internal sending/retrying operation is not a new membership state. Delivery
means persisted by the recipient, not that the model executed a task.

Remove body copies from main storage, idempotency payloads, logging, traces and
socket attachments. Rollout must address already stored bodies separately;
changing future writes does not erase old data or backup copies.

### P1: Lifecycle and late events need a single participation boundary

The current stable ref survives reconnect/resume, and journal scope has no
participation epoch. Some local guards compare connection/journal objects, but
they do not establish an end-to-end boundary across leave and rejoin.

Validate the participation ID on sends, deliveries, ACKs and advisory notices.
Invalidate in-flight callbacks when leaving or changing rooms. A late close from
an old socket must not evict its replacement; a late message/ACK must not affect a
new participation. Reconnect can resume the same admission only within the defined
recovery window; later admission creates a new ID. Server restarts should preserve
the minimal admission metadata needed to make this distinction.

### P2: Web management uses membership to mean account authorization

`website/src/routes/rooms.tsx` calls the HTTP room join endpoint and displays
success, but that endpoint grants account access rather than creating an Agent
participant. The website's members list comes from `RoomStore.activeMembers()`;
the MCP members list contains current Agent conversations. The same label means
two different things.

Use the website for room creation, accessible-room discovery and access management.
Label the existing account list as access management. Show current conversation
participants separately if needed. After adding access, explain that the Agent
conversation must join, instead of saying the current conversation already joined.
Browser sign-in alone must not create an invisible participant or consume a
conversation seat.

### P2: Hidden participants remain in the protocol

`ClientMessage` supports `hello.visible = false` and later visibility changes.
Discovery filters hidden sessions, while direct addressing can still find them.
Current Bridge normally sends `visible: true`, so this is a residual protocol
capability, not an assertion that normal clients expose an invisibility switch.

Remove unsupported hidden participation, or reject it in the revised protocol.
Every participating Agent should be discoverable under this product contract.

### P2: Automatic restoration differs across hosts

OpenCode's `restore()` enumerates non-archived saved sessions in a directory and
creates runtimes for all previously joined conversations, including ones not
explicitly opened in the current UI. This deliberately supports background wakeup,
but its product meaning must be chosen, not inferred from a saved file.

Recommended default: restore only conversations the host considers active or
explicitly resumed. If OpenCode intentionally treats all those sessions as active
background participants, expose that behavior clearly and verify they can receive
and act, rather than labeling them historical/offline members.

Claude's `SessionEnd` hook currently marks status idle and relies on process/stdio
shutdown to close transport. Add an explicit end-of-participation lifecycle signal
where the host supports it. Pi/DSH already dispose runtimes on host lifecycle events;
their dispose/reload paths still need to distinguish recovery from permanent exit.
Do not confuse an agent finishing a response (`Stop`/idle) with its conversation ending.

### P2: Counts, status and documentation expose the obsolete model

- MCP room/member output says online and returns connected/listening as normal state.
- `AgentInfo.online` and `formatAgentLine()` can display offline peers.
- Shared generated instructions and native tools describe online counts.
- Website JSON catalogs and room cards show online conversations.
- The FAQ still instructs users to use `on` after resume and mentions pausing
  notifications, although that control is no longer the current product.
- Delivery/architecture/host docs promise offline queues and pending-send restoration.
- Tests intentionally assert offline delivery; this is an architectural behavior,
  not just outdated wording.

Use participant/conversation counts and in-room/not-in-room language. Keep busy/idle
activity when useful and place transport/listener diagnostics in troubleshooting.
Count capacity using the same admission model as membership, including any reserved
recovery window. Resource-policy removals must terminate participation consistently.
Preserve existing policy revision/cutoff safeguards when changing seat lifecycle.
Commercial presentation changes belong in the private composition.

Update privacy text only after implementation and old-data handling match the new
claims. Preserve historical verification records as historical; point current docs
to the new contract rather than rewriting past results.

## Suggested implementation order

1. Define authoritative participation and its ID, explicit leave, expiry/recovery
   semantics, rejoin policy, and consistent discovery/addressing/capacity checks.
2. Bind client intake, local outbox retries and callbacks to participation; prevent
   old work from resurfacing after rejoin. Keep confirmed local history separate.
3. If adopting no-body-retention, replace server custody with recipient persistence
   ACKs and sender-owned bounded retries. Version this protocol and fail closed
   with old clients/Hubs instead of silently restoring old queue semantics.
4. Align host activation/termination, web access management, status, translated
   copy, shared generated instructions and docs. Regenerate plugin outputs normally.
5. Validate with local Worker fixtures; deploy compatible server capability before
   new clients. Define old-room/data handling before advertising the storage change.

Earlier E2EE research assumed durable offline delivery. Keep its cryptographic
observations, but revise integration, journal and key-retention proposals against
this participation contract before implementation. E2EE and persistent task boards
are separate follow-ups; neither is required to implement this product correction.

## Acceptance scenarios

| Scenario | Expected behavior |
| --- | --- |
| Join pending/rejected | Never reported as admitted; no send or receive privilege |
| Leave | Stops local delivery immediately; server ends that participation; no ghost target |
| Departed exact ref/name/handle | Rejected; no server queue or accidental retargeting |
| Same-name active and departed sessions | Only active candidates participate in resolution |
| Leave then rejoin same host session | Stable identity may remain; new participation; no old send replay |
| Busy agent | Remains in room; recipient journal can accept while the model is busy |
| ACK loss | Same message can retry within the participation; one local inbox entry |
| Leave during uncertain send | No continued delivery attempt after termination; result remains honest |
| Recovery within deadline | Same admission only if still valid; no offline inbox |
| Recovery after deadline | Old admission cannot send/receive; new admission checked against current access/capacity |
| Late old-socket events | Cannot evict, acknowledge or inject work into replacement participation |
| Membership revocation/room disable | Ends participation and delivery; cannot reconnect around policy |
| Web login/access grant | Grants management/access only; does not claim Agent presence |
| Host shutdown/resume | Shutdown ends participation; resume follows explicit rejoin policy |
| Server restart | Sender retains unacknowledged content; no body needed in server persistence |
| Privacy fixture | Synthetic body absent from Hub DB, idempotency state, logs and traces |

This review used source and test inspection. No behavioral tests were executed,
no runtime files were edited, and no production state was changed.
