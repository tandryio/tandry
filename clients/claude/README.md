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
| Who starts the monitor | Claude Code, the first time the `tandry:join` skill is dispatched in a session (`monitors.json`, `"when": "on-skill-invoke:tandry:join"`), whether by `/tandry:join` or by the model through the Skill tool. Not at session start, and not on resume. While the monitor is missing and that dispatch would bring it, every Tandry tool result of a joined conversation says to dispatch the skill. Where it would not, a one-shot `claude -p` run (the SessionStart hook records `CLAUDE_CODE_SESSION_ATTENDED`) or a monitor that already exited (Claude Code arms one per process; the monitor's record, a lease it renews while it runs, stays as the record of that until SessionEnd says the process is ending), nothing is asked and `status` says why |
| How idleness is known | The hooks record it in `~/.tandry/run/<session>.host`; the MCP process reads that twice a second |
| Tier | push |

Three kinds of process, one of which is online:

- `dist/main.cjs mcp` holds the bridge and the room link. It writes the run
  file: the notice on offer to hooks, and a wake counter for the monitor.
- `dist/hook.cjs <event>` is a 5 kB bundle, because it runs on every tool call.
  A conversation that is in no room costs one file lookup and nothing else.
- `dist/main.cjs monitor` is a pipe: it prints the run file's wake notice when
  the counter rises. Its registration file is what makes the member wakeable.
  Claude Code arms it once per session and never again, so it stays through
  leave and a later join, silent while there is nothing to say. A session that
  never joins runs no monitor.

Each unread state is announced once. A hook that injects a notice records the
state's key, and the MCP process passes that to `bridge.announced`; a wake is
published together with the state being marked announced, so a hook never
repeats what the monitor just printed.

Only the fixed notice enters the conversation through these paths. Message
bodies arrive as the result of the `inbox` tool and nowhere else.

## Verified

Automated, in `test/claude.test.ts`: the shipped bundles run as Claude Code runs
them, against a real local Hub, including the acceptance scenario and `/clear`.

In a real Claude Code 2.1.274 session on macOS (2026-09-17), with the monitor
still armed at session start: join in one process, exit, `claude --resume <id>`
with no input, another member sends, the monitor event starts a turn and the
agent calls `inbox`. Details and the process measurements are in
`docs/redesign/03-hosts.md`. The `on-skill-invoke` arming is read from Claude
Code 2.1.278's plugin schema and covered by the automated suite; it has not
yet been run through a real interactive session.

## Known limits

- Claude Code arms no monitor on `--resume`. A resumed conversation stays
  offline to senders until its next turn touches a Tandry tool, whose result
  asks the model to dispatch `tandry:join` again (joining the room it is in
  is reused by the Hub and changes nothing). Mail waits as unread meanwhile,
  and the first turn's hooks carry the notice.
- Plugin monitors run only in interactive sessions. Under `claude -p` the
  member is offline to senders, hooks still carry notices mid-turn, and no
  tool result asks for a dispatch that could not arm anything.
- A monitor that exits, stopped from the task panel or crashed, is not armed
  again in that session. The conversation is offline to senders from then on;
  `status` says so, and hooks carry notices at its turn boundaries.
- The MCP process learns that a turn started up to half a second late. Mail
  arriving in that window is announced by the monitor rather than by a hook.
- The rendezvous relies on hooks and the MCP server being direct children of
  the claude process. That is measured, not documented.
