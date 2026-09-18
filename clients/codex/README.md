# Tandry for Codex

Tandry's client inside Codex. Codex loads it as a plugin: a stdio MCP server
plus `mcp_tool` lifecycle hooks. Tandry never starts or drives Codex.

## Mechanism

| Question | Answer |
| --- | --- |
| Where the conversation ID comes from | `_meta.threadId` on MCP tool calls, including the hook calls. Never a tool argument, a directory or a timestamp |
| Turn in progress | `UserPromptSubmit`, `PostToolUse` and `Stop` hooks call `codex_event` in the MCP process, which returns the notice as `additionalContext`, or blocks `Stop` with it |
| Idle wake | `codex queue --thread <id> --message <notice>` |
| How idleness is known | From the same hooks: a prompt or tool use means busy, an unblocked `Stop` means idle |
| Tier | push |

Only the fixed notice enters the conversation through these paths. Message
bodies arrive as the result of the `inbox` tool and nowhere else.

Before the first turn finishes, open `/hooks` and enable and trust Tandry's
`SessionStart`, `UserPromptSubmit`, `PostToolUse` and `Stop` hooks. Installing the
plugin does not grant hook trust. If you enable hooks during an existing session,
submit a prompt so the hooks can report its lifecycle.

Automatic wake is enabled only after a `Stop` hook has reached the client.
Until then senders see "live, seen on next turn", and `join`/`status` explain
how to enable hooks. Inbox remains available. This prevents the old failure in
which one queue succeeded, but the missing Stop hook left the client busy forever.

## Verified

Automated, in `test/codex.test.ts`: the shipped bundle run as a stdio MCP server
against a real local Hub, with request metadata and hook calls shaped as Codex
sends them and a recording stand-in for `codex queue`.
Coverage includes missing hooks, enabling them after joining, and two consecutive
idle wake/inbox/Stop cycles.

In a real Codex CLI 0.154.0 session on macOS (2026-09-17): join, quit and
resume preserves membership, but the conversation remains dormant until its
first prompt. That turn reads the accumulated mail. After it ends, new mail
starts a turn through the real `codex queue`; the agent calls `inbox` and the
sender sees the unread count return to zero. The no-input resume scenario
therefore uses the documented fallback, not immediate wake. Measurements are
in the workspace's `docs/redesign/03-hosts.md`.

## Known limits

- Resuming a conversation without typing anything produces no request that
  names the thread (measured on Codex CLI 0.154.0). Until the first turn the
  member shows as dormant and mail waits as unread. Senders see this.
- `codex` must be on the MCP process's PATH and use the same `CODEX_HOME`. If
  it is missing, the member reports itself as live but not wakeable.
- Hooks must remain enabled and trusted by the owner (`/hooks`). The client can
  observe hook calls, but Codex does not notify it if the owner subsequently
  disables hooks. Missing lifecycle events can leave its busy state stale.
