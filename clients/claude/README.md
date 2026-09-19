# Tandry for Claude Code

Tandry's client inside Claude Code. Claude Code loads it as a plugin: a stdio
MCP server, command hooks, and a plugin monitor. Tandry never starts or drives
Claude Code.

## Mechanism

| Question | Answer |
| --- | --- |
| Where the conversation ID comes from | `session_id` on the SessionStart hook's stdin, which also fires on `--resume`, `/resume` and `/clear`. The hook records it under the claude process's pid (`~/.tandry/run/by-pid/<pid>`); the MCP server and the monitor, which are not told the session, read it there |
| Turn in progress | `UserPromptSubmit` and `PostToolUse` hooks return the notice as `additionalContext`; `Stop` blocks with it. Hooks read `~/.tandry/run/<session>` and never touch the network |
| Idle wake | The monitor prints the notice as one line, which Claude Code turns into a turn |
| How idleness is known | The hooks record it in `~/.tandry/run/<session>.host`; the MCP process reads that twice a second |
| Tier | push |

Three kinds of process, one of which is online:

- `dist/main.cjs mcp` holds the bridge and the room link. It writes the run
  file: the notice on offer to hooks, and a wake counter for the monitor.
- `dist/hook.cjs <event>` is a 5 kB bundle, because it runs on every tool call.
  A conversation that is in no room costs one file lookup and nothing else.
- `dist/main.cjs monitor` is a pipe: it prints the run file's wake notice when
  the counter rises. Its registration file is what makes the member wakeable.

Each unread state is announced once. A hook that injects a notice records the
state's key, and the MCP process passes that to `bridge.announced`; a wake is
published together with the state being marked announced, so a hook never
repeats what the monitor just printed.

Only the fixed notice enters the conversation through these paths. Message
bodies arrive as the result of the `inbox` tool and nowhere else.

## Verified

Automated, in `test/claude.test.ts`: the shipped bundles run as Claude Code runs
them, against a real local Hub, including the acceptance scenario and `/clear`.

In a real Claude Code 2.1.274 session on macOS (2026-09-17): join in one
process, exit, `claude --resume <id>` with no input, another member sends, the
monitor event starts a turn and the agent calls `inbox`. Details and the
process measurements are in `docs/redesign/03-hosts.md`.

## Known limits

- Plugin monitors run only in interactive sessions. Under `claude -p` the
  member is online but not wakeable, and hooks still carry notices mid-turn.
- The MCP process learns that a turn started up to half a second late. Mail
  arriving in that window is announced by the monitor rather than by a hook.
- The rendezvous relies on hooks and the MCP server being direct children of
  the claude process. That is measured, not documented.
