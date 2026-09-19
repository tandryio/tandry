# Remote MCP development

Remote MCP runs in the Hub at `/mcp`. The old standalone bridge gateway and
`scripts/mcp-dev.mjs` have been removed. The website forwards `/mcp`,
`/.well-known/*`, and `/api/auth/*` to its Hub service binding, keeping the
public OAuth issuer, resource and browser session on the same origin.

## Local setup

1. Install with `pnpm install --frozen-lockfile`.
2. Apply Hub D1 migrations with `pnpm --filter @tandryio/hub db:local`.
   `0001_initial.sql` adds the Better Auth JWT/OAuth provider tables.
3. Set the Hub's ignored `.dev.vars`: `BETTER_AUTH_SECRET` and
   `BETTER_AUTH_URL=http://127.0.0.1:4173`, plus a configured login method.
4. Run `pnpm hub:dev --local --port 8799` and `pnpm website:dev` separately.
5. Use `http://127.0.0.1:4173/mcp` with a local MCP client supporting OAuth
   PKCE and dynamic registration. Browser hosts need a reachable HTTPS site.

Deploy the D1 migration before updating the Hub and website. No production
migration or deployment is part of local development.

## Project-local tunnel setup

Requirements: Node.js 22.19+, pnpm 10.28.0, and `cloudflared` on PATH.
Run all commands below from the public `tandry/` checkout.

```sh
pnpm install --frozen-lockfile
```

The repository provides two commands:

- `pnpm mcp:setup <https-origin> [tunnel-uuid] [credentials-file]` writes personal
  configuration inside this checkout. It does not create tunnels or DNS records.
- `pnpm dev:mcp` applies local D1 migrations, builds the website, and opens
  mprocs with Hub (8799), built website (8788), and the configured named tunnel.
  Inspector ports are 9230 (Hub) and 9231 (Website).
  Stop ordinary `pnpm dev` first. `Ctrl+Q` exits the panel and its services.

Generated files are ignored by Git:

```text
.local/mcp/
  origin.env    # public origin and explicit tunnel console-OTP origin
  tunnel.json   # named tunnel configuration (JSON is valid YAML)
  mprocs.yaml   # process commands and paths for this checkout
```

No tunnel config is written to or read from `~/.cloudflared/config.yml` by the
named-tunnel launcher. By default only the credential file produced by
cloudflared is read from `~/.cloudflared/<UUID>.json`; the optional third argument
can point to a credential file inside `.local/mcp/` instead. Never commit it.
Re-run setup after moving the checkout because generated paths are absolute.
Both development modes load `packages/hub/.dev.vars`: one authentication secret,
login provider configuration, and local database. MCP adds only `origin.env` as
an override for the public URL and the exact development console-OTP origin.
Setup creates the ordinary dev file with a random secret and console OTP only
if it is missing. Existing configuration is preserved. The old `.local/mcp/.env`
is no longer loaded. `dev:mcp` refreshes generated process commands on startup.

When `DEV_EMAIL_OTP=console`, MCP development also prints codes in the Hub panel.
The launcher explicitly sets `DEV_EMAIL_OTP_ORIGIN` to this tunnel's HTTPS origin;
without that exact match, console OTP remains restricted to HTTP loopback.
These development settings must never be enabled in a deployed service.

### With a domain: stable named tunnel

You need a Cloudflare account with the domain managed in Cloudflare DNS, or a
team-provided tunnel and hostname. A newcomer creates their own once:

```sh
cloudflared tunnel login
cloudflared tunnel create tandry-mcp-dev
cloudflared tunnel route dns tandry-mcp-dev mcp-dev.example.com
```

Use the UUID printed by `create` (also available through `cloudflared tunnel list`):

```sh
pnpm mcp:setup https://mcp-dev.example.com <TUNNEL-UUID>
```

Replace example values; the angle-bracket placeholder is not a literal shell
argument. Existing developers can skip creation and use their existing UUID.
The generated tunnel ingress forwards to `http://127.0.0.1:8788` with
`httpHostHeader: 127.0.0.1:8788`. Keep that override: without it Wrangler's proxy
can rewrite OAuth metadata response headers to HTTP, breaking discovery.

The default console login needs no provider setup. Start:

```sh
pnpm dev:mcp
```

For manual tunnel startup or validation from this checkout:

```sh
cloudflared tunnel --config .local/mcp/tunnel.json ingress validate
cloudflared tunnel --config .local/mcp/tunnel.json --no-autoupdate run
```

The panel already starts the tunnel; do not also run the manual startup command.

### Without a domain: experimental Quick Tunnel

Cloudflare Quick Tunnels provide a random HTTPS `*.trycloudflare.com` origin
without an account or a domain. They **do not support SSE**. Tandry's MCP SDK
can serve SSE (including its 2025 stateless compatibility path), so a Quick
Tunnel is useful for website/OAuth experiments but is **not a verified or
reliable substitute for named-tunnel ChatGPT MCP acceptance**. Use a team-owned
subdomain/named tunnel or another HTTPS tunnel with SSE support for full testing.

In terminal one:

```sh
cloudflared tunnel --url http://127.0.0.1:8788 --http-host-header 127.0.0.1:8788
```

Copy the generated HTTPS origin and keep this process running. In terminal two:

```sh
pnpm mcp:setup https://YOUR-RANDOM-NAME.trycloudflare.com
# Login configuration is shared with packages/hub/.dev.vars.
pnpm dev:mcp
```

The panel starts only Hub and Website in this mode. Do not restart the Quick
Tunnel between copying its URL and testing. Each new tunnel URL requires setup
again, restarting `dev:mcp`, updating provider callbacks if used, and reconnecting
the test MCP client. Quick Tunnels may fail when a default `config.yaml` exists
under `~/.cloudflared`; see Cloudflare's documentation below before moving any
existing configuration.

### Login and connector checks

Login configuration is shared with ordinary development in
`packages/hub/.dev.vars`. With `DEV_EMAIL_OTP=console`, enter an email address
and copy the verification code from the Hub panel's `[dev email OTP]` log.
Normal OTP verification, expiry, rate limits and origin checks remain enabled.

To test real email delivery, remove `DEV_EMAIL_OTP=console` and configure
`RESEND_API_KEY` and `RESEND_FROM` in that same file. A populated key does not
prove delivery works: Resend must accept the key, sender and recipient. OAuth
providers also use this shared file, but their registered callback URLs must
include `https://YOUR-ORIGIN/api/auth/callback/github` or `/google` for the
public origin. Browser cookies remain origin-specific; using one config does
not mean localhost and the public hostname share a browser login.

Check the website at the public HTTPS origin. Before adding the connector:

```sh
curl -i -X POST https://YOUR-ORIGIN/mcp \
  -H 'Content-Type: application/json' -d '{}'
```

Expect 401 and an HTTPS `resource_metadata` URL on the same public origin in
`WWW-Authenticate`. A successful unauthorized response only checks discovery,
not authenticated MCP transport compatibility.

Configure the host's remote MCP connection with `https://YOUR-ORIGIN/mcp` and
OAuth. It must support PKCE and dynamic registration; the scope is `tandry`,
with `offline_access` for refresh. Sign in and explicitly allow the connection.
Each chat must keep its own returned conversation handle. Remove the test
connection when finished; stop the panel and any separately run Quick Tunnel.

Hub source edits reload through Wrangler. Website edits require a fresh
`pnpm website:build` and restarting Website in mprocs (or restarting `dev:mcp`).
No production deployment or remote database migration is performed.

References: [named tunnel creation](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/),
[Quick Tunnel limitations](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/),
[local environment files](https://developers.cloudflare.com/workers/local-development/environment-variables/).

## Authorization

`@better-auth/mcp` and `@better-auth/oauth-provider` are pinned to 1.7.4,
matching Better Auth. Their PKCE, consent, signing, refresh and revocation paths
run in workerd with the D1 Drizzle adapter. The public endpoints are:

- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server/api/auth`
- `/api/auth/oauth2/register`, `/authorize`, `/token`, `/revoke`
- `/api/auth/jwks`
- `/connect`, the website's localized sign-in/consent page

Tokens must be issued for this site's `/mcp` resource and carry `tandry` scope.
`offline_access` permits refresh. Session/device tokens are rejected at `/mcp`;
connector tokens do not authorize the website or device APIs. JWTs expire in
15 minutes. Revoking refresh tokens stops renewal, not already issued JWTs.

Dynamic registration is deliberately enabled for connector compatibility.
CIMD is not enabled: its Workers transport needs DNS/address validation and
connection pinning, so ordinary `fetch` is insufficient. Do not advertise
CIMD or claim full MCP 2026 authorization-profile support until it is added.

## Delivery and validation

Tools and their input schemas come from protocol. MCP annotations identify
status/members/history as reads. Inbox changes read state and is non-idempotent;
join continuation and leave may replace or end a member. Refresh ChatGPT's
operations after metadata changes; this does not override host safety checks. The Hub supplies a random
conversation ID on join and returns `roomId.conversationId`. Every request
resolves that handle with the authenticated account. The room's inbox handler
consumes pull batches inside its existing SQLite transaction, so simultaneous
requests cannot read the same batch. Push inbox/read semantics stay unchanged.

Run `pnpm --filter @tandryio/hub test` for the shared black-box delivery suite,
OAuth tests and workerd presence-window test. The suite covers concurrent
consumption, chat isolation, cross-account rejection, continuation, lost-response
recovery through history, consent denial/tampering, PKCE, scope/signature checks,
refresh and revocation. Local tests use synthetic accounts and temporary state.

See [connector usage](../clients/web/README.md). ChatGPT web was tested through
Cloudflare Tunnel on 2026-09-17: OAuth installation, join/leave, members and one
inbox delivery passed. Later inbox/history/send attempts were blocked by the
host's safety check, so full delivery acceptance is still pending. Claude web
has not been tested. Deployment is not required for these checks.

References: [Better Auth MCP](https://better-auth.com/docs/plugins/mcp),
[OAuth provider](https://better-auth.com/docs/plugins/oauth-provider).
