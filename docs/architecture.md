# Host integration boundaries

`packages/bridge/src/runtime.ts` owns conversation records, room controls,
HubClient, mailbox and connection lifecycle. It does not import MCP or a host SDK,
register process signals, queue model turns, or choose command syntax.

Hosts supply a namespace and cwd, bind a host-provided session ID, and call
`control`, `members`, `send`, `drain`, and state accessors. `dispose` invalidates
pending controls and closes the connection. Each asynchronous control captures a
generation as well as an ID: switching away and back cannot revive a stale request.
A request already sent to the Hub may still create an orphan room, but cannot bind
it to the replacement session. HTTP cancellation is not implemented yet.

- `mcp.ts`: MCP schemas/formatting, Claude IPC and lifecycle binding, Codex metadata.
- `hosts/codex.ts`: Codex notification queue adapter.
- `monitor.ts`: Claude's independent stdout notification process.
- `clients/pi/src/host.ts`: Pi lifecycle, native tools, commands and
  follow-up notifications. The adapter holds a runtime per session and rejects
  callbacks after replacement.
- `clients/opencode/src/host.ts`: OpenCode native tools and config
  commands, a runtime per active session and idle SDK prompts.
  `src/index.ts` exports only the plugin entrypoint.
- `clients/shared/operations.ts`: operation prompts with host rendering variables.
- `scripts/generate-commands.mts`: generates Claude commands, Codex/DSH skills
  and Claude monitor configuration. Pi/OpenCode render shared operations in memory;
  their builds include that data without generating JavaScript in `src/`.

## Source and release artifacts

All native adapters are TypeScript workspace packages. Their `src/index.ts`
composes the host SDK with `src/host.ts`. Adapters import the public
`@tandryio/bridge/runtime` source entry, never a `dist` path. The exported
`Runtime` and `RuntimeOptions` types describe the shared contract. SDK types check
host events, tool arguments and callbacks; schemas retain parameter inference.
Bridge owns account/transport state and does not depend on the native plugins.

`pnpm build` builds the Bridge CLI and then packages all five plugins:

- Claude/Codex receive `dist/tandry.cjs` for MCP, hooks and monitors.
- `scripts/package-plugins.mjs` bundles each native adapter and the shared
  runtime into its own `dist/index.js`. Package exports and Pi extension metadata
  point there. Host SDKs remain external; Pi's SDK import is type-only. OpenCode
  keeps `ws` external so Bun can supply its WebSocket compatibility layer.
- Native `dist/` directories are recreated during builds. Published packages contain
  compiled code, host-required skills and notices, without `src/` or a dependency
  on the private Bridge workspace package at installation time.
- Skills, plugin manifests and hooks remain in the locations their hosts require.

Protocol and Hub deliberately export TypeScript source for consumers to bundle.
Protocol's build currently validates types; Wrangler builds the Hub Worker.
These library entrypoints are separate from the executable plugin distribution.
The website uses its framework's `dist/client` and `dist/server` outputs.

`pnpm typecheck` includes all three native plugins. SDK dependency versions are
pinned for reproducible adapter checking. Build/generation scripts may remain
JavaScript; shared operation definitions are typed TypeScript.

### Tests

- `pnpm --filter @tandryio/bridge test:native` runs native lifecycle and delivery
  tests directly against TS source with `tsx`; plugin/Bridge bundles are not needed.
- After building, `pnpm --filter @tandryio/bridge test:packages` packs and extracts
  each native plugin outside the workspace and loads its declared release entry.
  Only external host dependencies are supplied. This covers tool registration,
  account-only status and DSH skill discovery/unload/reload without source access.
- The full Bridge test suite includes both categories and the existing MCP/Hub
  integration tests. The optional OpenCode real-host smoke uses `dist/index.js`.

For another host, first establish its trustworthy session ID and lifecycle,
then implement native tools or MCP binding and its notification adapter. Reuse
runtime business operations. Do not route it through the Claude-only `team` CLI.
MCP support and background wakeup support are independent capabilities.

The persistent store still uses the existing config module's process environment;
multiple differently configured stores in one process are not supported. A host
conversation must have one active runtime owner; concurrently opening the same
conversation in multiple processes is not a supported journal-writing mode.

`delivery-store.ts` persists received messages and seen IDs in an atomically
replaced, fsynced journal. Disposing or leaving preserves the local file, but
rejoining does not replay old work. There is no outbox or automatic send retry.
See [live room delivery](delivery-reliability.md) for confirmation and failure semantics.

OpenCode creates a runtime when a conversation is used through chat or a tool.
It does not enumerate saved sessions to bring historical conversations into rooms.
Idle prompts preserve the previous user message's agent/model and respect host busy
checks. Prompt submission can still race a concurrent user turn.

DSH's `clients/dsh/src/host.ts` binds one runtime per live top-level Agent,
using `exec.agent` for native tool callers. It waits for `agent/session-start`
before driving newly published agents, adopts existing roots on plugin load, and
uses exact Agent handles to reject stale events. `subscribeInbox` observes mailbox
and room changes (including restore); callbacks
are advisory and isolated from persistence failures. The adapter coalesces generic
`followup` notices, reconciles pending host inbox entries on HMR and bounds failed
wake retries. DSH owns model scheduling; no process identity guessing, hooks or
separate monitor is used. Cordis effects own adapter disposal. DSH skills are
also generated from `operations.ts`; DSH bundles the Node runtime into its plugin entrypoint.
See [the DSH package](../clients/dsh/README.md) for version and test scope.


## Hub storage boundaries

`packages/hub/src/store.ts` owns room metadata, conversations, temporary receipt routes,
revocation barriers and local policy execution. `room.ts` handles hibernating
WebSockets and applies those rules. Fresh verification results use local checks;
expired results refresh through the internal `Authorization` Worker entrypoint,
with membership, connection ownership, revocation and policy validity checked after
external awaits. Auto-response heartbeats do not refresh authorization or business activity.

`hub.ts` exports `createHub({ policyProvider })`; `index.ts` composes the self-host
provider and internal authorization entrypoint. `resource-store.ts` owns account
resource facts and atomic room allocation in D1. `policy.ts` describes generic,
versioned owner/room policies and one-time conversation shrink operations. Commercial
subscription concepts belong to the independent private cloud composition.

Authentication refreshes on protected events, not on heartbeat alarms. While
conversations are present, a thirty-second alarm expires silent connections and
short-lived receipt routes. Retained conversation metadata supports identity and
resource policy history; it never makes a departed conversation addressable.

## Account and conversation identity

Accounts own immutable `userId` values and required unique `@handles`. Each host
conversation has a stable internal `ref`; names and handles never authorize access.
`agentType` identifies Codex, Claude Code, Pi, DSH or OpenCode independently of the
machine hostname (`host`). Host type and conversation names are client-supplied
metadata, not verified identities.

Normal member/status displays use `@handle · Agent type · project · conversation name`
(with the account name as fallback). The default conversation name is the project
name. Duplicate labels are allowed. Status and start time help distinguish sessions.
Structured tool results retain refs for exact routing; normal summaries hide them.

Use `tandry.control` with `action: "rename"` and `name`, or the host's rename
command (`/tandry:rename`, `$tandry:rename`, DSH's `tandry-rename` skill). Names are
1–80 characters and support Chinese; control characters, markup/address delimiters,
leading `@`, and bare six-digit hex references are rejected. Renaming updates only
Tandry's conversation label, preserves membership, and survives restart.
It does not rename the native chat, account handle or room.

Sending to `@handle` resolves within the current room. Multiple sessions return
`AMBIGUOUS_NAME` and structured candidates; ask which conversation before sending
to the selected ref. Only current participants are candidates; never choose arbitrarily among them.
Messages and receipts snapshot readable identities at send time; replies use
`fromRef`, so later renames cannot redirect a reply. Messages are not retried automatically. Use matching Hub and client versions.
