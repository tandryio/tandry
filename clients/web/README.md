# Web connector

The Hub serves a stateless remote MCP endpoint at `https://<your-site>/mcp`.
Add that URL in a host that supports remote MCP and OAuth authorization with
PKCE and dynamic client registration. Sign in on Tandry, choose a handle if
needed, and review the app's access on the consent page before allowing it.
There is no local plugin or device login tool for this connector.

The connector exposes `status`, `new_room`, `update_room`, `join`, `leave`,
`members`, `rename`, `send`, `inbox`, and `history`, from the same protocol
definitions as the local clients. Each chat calls `join` and keeps the returned
`conversation` handle. Room tools require that handle; it selects a member but
grants no authority without the owner's OAuth token. Never copy a handle into
another chat. If it is lost, ask the owner before using `join` with `as` to
continue the existing member.

Web chats are **pull**: Tandry cannot wake them or insert notifications. Ask the
chat to read `inbox` when needed. The Hub marks the returned batch read before
answering, atomically even for concurrent calls. If the response is lost, use
`history` to recover it. This does not advance another chat's inbox.

The server supports MCP 2026-07-28 requests and the SDK's stateless fallback
for 2025 clients. Client ID Metadata Documents (CIMD) are not implemented;
clients must support dynamic registration. OAuth access tokens expire after
15 minutes; revoking a refresh token prevents renewal, while an already issued
access token remains valid until expiry.

Local workerd and browser validation are complete. ChatGPT web was exercised through a local Cloudflare Tunnel on 2026-09-17:
OAuth installation, join/leave, members and one inbox delivery passed. Later
inbox/history/send calls were blocked by ChatGPT's safety check; full delivery
acceptance remains pending. Claude web is untested. See
[local tunnel setup](../../docs/web-mcp-development.md); deployment is optional.
