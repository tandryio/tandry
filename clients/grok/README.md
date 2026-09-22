# Tandry for Grok Build

Tandry's client inside Grok Build. Grok loads it as a plugin: a stdio MCP
server and slash commands. Automatic delivery runs through Grok's built-in
`monitor` tool, which the conversation starts after joining. Tandry never
starts or drives Grok.

## Mechanism

| Question | Answer |
| --- | --- |
| Where the conversation ID comes from | `GROK_SESSION_ID` in the environment of the MCP server Grok starts for the session. Grok starts a new server, with the same ID, when the session is resumed |
| Idle wake | The monitor prints the notice as one line, which Grok turns into a turn |
| Turn in progress | A line printed during a turn is held by Grok until that turn ends, then starts the next one. No hook is needed, and none runs: Grok 1.0.40 does not execute plugin hooks |
| Who starts the monitor | The model, through the `monitor` tool. Every Tandry tool result of a joined conversation carries the exact command while the monitor is missing |
| Tier | push |

Two kinds of process, one of which is online:

- `dist/main.cjs mcp` holds the bridge and the room link. It writes the run
  file, `~/.tandry/run/<session>`, with a wake counter for the monitor.
- `dist/main.cjs monitor --session <id>` is a pipe: it prints the run file's
  wake notice when the counter rises, and is silent otherwise. Its
  registration file is what makes the member wakeable. Started without
  `--session`, it finds the session through Grok's `active_sessions.json`.
  It watches the shell and grok process above it and the grok pid Grok's
  registry names for the session, and exits when any of them is gone: a
  grok killed by a signal leaves its monitors behind, and this one must not
  linger. The MCP server likewise exits once reparented to init.

Only the fixed notice enters the conversation through this path. Message
bodies arrive as the result of the `inbox` tool and nowhere else.

## Install

```sh
grok plugin marketplace add tandryio/tandry-marketplace
grok plugin install tandry@tandryio/tandry-marketplace --trust
```

Then, in a Grok session: `/tandry:new-room my-team`, `/tandry:join ROOM-CODE`.
The join result tells the conversation to start the inbox monitor; it does so
with one tool call.

## Verified

Automated, in `test/grok.test.ts`: the shipped bundle run as Grok runs it,
against a real local Hub: the monitor hint, idle wake, consecutive wakes,
quit and resume with no input, a monitor that finds its session through
Grok's registry, and a monitor that dies.

In a real Grok Build 1.0.40 session on macOS (2026-09-22, grok-4.7 over ACP
stdio with `--plugin-dir`): join, the monitor started from the join result,
mail waking the idle conversation and being answered, quit, resume with no
input, the next turn's `status` result restarting the monitor, the backlog
answered, and a second idle wake. Host measurements and the run's record
are in the workspace's `docs/redesign/03-hosts.md`.

## Known limits

- Grok kills monitors when a session ends and starts none on resume. A
  resumed conversation is online but not wakeable until its next turn touches
  a Tandry tool, whose result asks for the monitor again. Senders see
  "online, seen on next turn" meanwhile, and mail waits as unread.
- Monitors have a ten-hour limit in Grok. After that the same recovery
  applies.
- Subagents share the session's MCP server and cannot be told apart from it.
  A subagent that calls Tandry tools acts as the parent conversation.
- `grok -p` runs are one-shot: the member is online for the run and never
  wakeable.
- `~/.grok/plugins/` is not enough: a plugin dropped there is disabled until
  enabled. Install through the marketplace, or with `grok plugin install
  <path> --trust` followed by `grok plugin enable tandry`.
