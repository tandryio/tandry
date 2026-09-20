# Tandry for dsh

A native DeepSeek Harness plugin with nine `tandry_*` tools and five shared
skills: `tandry-new-room`, `tandry-join`, `tandry-leave`, `tandry-members`, and
`tandry-status`. Skills register when the host provides its `skills` service;
minimal profiles can use the tools directly.

## npm installation

```sh
dsh plugin --profile web add @tandryio/dsh
dsh plugin --profile web update @tandryio/dsh
```

Restart the selected profile after updating.

## Local development

Start `pnpm dev`, then launch the installed host with this checkout's plugin:

```sh
pnpm agent dsh --profile web
# SDK clients can instead drive its JSON-RPC stdio profile:
pnpm agent dsh --profile sdk-minimal
```

The launcher builds the plugin and supplies a temporary `--patch`. It preserves
host configuration, uses `http://127.0.0.1:8799` and `~/.tandry-dev` by default,
and removes the patch when the child exits. `TANDRY_HUB` and `TANDRY_HOME` override
those defaults. dsh owns model configuration, credentials and session storage.

## Install a built package

The package is a self-contained ESM bundle and declares `dsh.bundle.patch`.
Install the packed archive into the desired profile:

```sh
pnpm --filter @tandryio/dsh pack --out /tmp/tandry-dsh.tgz
dsh plugin --profile web add /tmp/tandry-dsh.tgz
```

The host adds the package to that profile's bundle stack. For a custom Cordis
composition, load `@tandryio/dsh` alongside `agents` and `tools`.

Long-lived profiles can wake idle conversations. For a one-shot profile, set
`config: { wakeable: false }` on the `tandry` row; the local launcher does this
for `--profile headless`. Such conversations report next-turn delivery.

## Delivery and lifecycle

- Identity is the host's `agent.id` (the session ID); workspace comes from the
  session header. Only active runtime roots attach. Fork lineage does not make
  a resumed root into a runtime child, and a fork has a new Tandry identity.
- Each active root owns one bridge. `agent/session-start` attaches it, including
  resume without input; `agent/disposed` and plugin unload close the link. Plugin
  reload attaches existing live roots, without enumerating stored sessions.
- `agent.status === "idle"` means the driver has settled. `Agent.followup`
  submits a plugin-attributed notice to that same agent, preserving its model,
  context and permissions. Busy notices enter durable additional context at a
  tool boundary or an admitted pre-step; final-answer mail wakes at true idle.
- Only inbox delivers message bodies. Wake and boundary injection share bridge
  deduplication. Calls serialize per conversation and respect host cancellation
  before starting a queued operation; an HTTP operation already started settles
  through the bridge normally.
- Tools still go through the host's permission pipeline. Child agents and calls
  without an active root cannot join or use another conversation's bridge.

`followup` acknowledges queue insertion, not successful model processing. A
provider failure leaves unread mail recoverable through inbox, without repeatedly
starting turns for the same unread state. A UI or SDK must actually activate a
session to resume it; listing stored sessions is not activation. In particular,
the SDK JSON-RPC protocol lazily opens sessions on `session/prompt`. No-input
resume is supported when the surrounding composition resumes the agent directly.

## Verification

Eight tests load a copied standalone bundle into pinned dsh core `0.1.5-rc.2`
and Cordis `4.0.2`, using the actual agent loop, tools, persistence and local
workerd. Only model responses are scripted. They cover tool/skill registration,
repeated idle delivery, busy and final-answer delivery, persistence/resume,
fork/child isolation, multiple roots, disposal, non-wakeable delivery, leave,
and recovery after a provider failure.

Separately, installed dsh CLI `0.1.5-rc.1` (core packages `0.1.5-rc.2`) with
DeepSeek v4 Pro passed idle inbox/reply and a declarative no-input resume. The
sender was a synthetic bridge peer. The packed archive was also installed into
an isolated real dsh profile and its bundle composition verified. No separate
web UI interaction acceptance was performed.
