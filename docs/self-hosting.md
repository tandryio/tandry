# Self-hosting Tandry

This edition runs on your Cloudflare account: two Workers, D1, one SQLite Durable
Object namespace and, for account pictures, one R2 bucket. It includes account login,
device approval, room management and all host adapters. It does not require an Tandry
Cloud account, subscription, license server or private repository. Cloudflare and your
email/OAuth providers have their own service requirements and charges. A Docker/VPS
deployment is not implemented.

## Configure your deployment

Use Node.js 22+ and pnpm 10.28.0. Run `pnpm install --frozen-lockfile` in this repository.
The checked-in Wrangler configurations are for local development. Official deployment
identities belong to the private cloud repository; do not reuse them for a new instance.

1. In your own Cloudflare account, create a D1 database (for example with
   `pnpm --filter @tandryio/hub exec wrangler d1 create my-tandry-accounts`) and an R2
   bucket for public objects (`pnpm --filter @tandryio/hub exec wrangler r2 bucket create
   my-tandry-public`). Record the database ID, the bucket name and your account ID.
   The bucket holds uploaded pictures and copies of the ones GitHub and Google
   provide, so that reading a room never calls an identity provider. Each kind of
   object lives under its own scope, pictures under `avatar/`; everything in the
   bucket is readable by key, so a kind that needs its reader checked belongs in a
   separate bucket rather than another scope. The bucket is optional: leave
   `bucketName` out of the configuration and the Hub runs without it, keeping
   provider pictures where they are and reporting that it stores none on upload.
   Choose separate website and Hub custom domains in a zone you control, such as
   `rooms.example.com` and `hub.example.com`.
2. Objects are served from the website origin unless `publicBaseUrl` names another,
   such as `https://cdn.example.com`. Publish the bucket on that domain and set it
   here: a picture is then one object read at the edge, with no Worker call, and its
   key, scope included, is the whole path. A domain of its own is also what keeps
   session cookies off every request for one and keeps uploaded bytes out of the
   website's origin, which is worth more than the `X-Content-Type-Options` and
   content-policy headers the Worker adds and object metadata cannot carry — add
   those as a Transform Rule on that domain if you want them too. Accounts record
   the base in force when their picture was stored, so changing this setting later
   leaves those rows pointing at the old one and their objects behind.
3. Copy `deploy/self-host.example.json` outside tracked source (for example to `/tmp`),
   fill in the IDs, domains, names and resource limits, then run:
   `pnpm self-host:configure /tmp/my-tandry.json`.
   This only writes ignored `.self-host/hub.json` and `.self-host/website.json`.
4. Configure authentication on the Hub. Use a random `BETTER_AUTH_SECRET` of at least
   32 characters. Configure at least one complete provider pair: GitHub client ID/secret,
   Google client ID/secret, or Resend API key/from address. Upload secrets with
   `pnpm --filter @tandryio/hub exec wrangler secret put KEY --config ../../.self-host/hub.json`.
   `KEY` is the setting name; enter its value at the prompt. Do not put secret values in
   the JSON configuration. Wrangler secret changes affect the target Worker.
5. Set OAuth callback URLs to the **website** origin followed by
   `/api/auth/callback/github` or `/api/auth/callback/google`. `BETTER_AUTH_URL` is the
   website origin, not the WebSocket Hub domain. Resend needs a verified sending domain.
6. Inspect `.self-host` and run `pnpm self-host:check`. This builds the website with
   the selected service binding and performs both Worker deployment dry runs; it does
   not create domains, upload secrets, deploy code or validate remote login providers.
7. When ready to deploy to your account, apply schema migrations first:
   `pnpm --filter @tandryio/hub exec wrangler d1 migrations apply AUTH_DB --remote --config ../../.self-host/hub.json`.
   Then run `pnpm hub:deploy`, followed by `pnpm website:deploy`.

The deployment scripts require `.self-host` configuration. The website build uses
Cloudflare Vite's `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`; deploy the generated configuration
from that build. A later ordinary `pnpm website:build` generates local-default metadata,
so use `pnpm website:deploy` to rebuild with the intended target before deployment.

## Connect the agents

Set `TANDRY_HUB=wss://hub.example.com` before starting your host. Alternatively,
set the `hub` property in your existing `~/.tandry/config.json`, preserving other
properties. A Claude plugin-specific Hub option takes precedence over this setting.
Restart the host/plugin after changing it, then log in to your own instance and join
or create a room normally. Each Hub has its own credentials; changing the endpoint
does not reuse credentials from the official service. Hosts on the same machine still
share the same local account state for the selected Hub.

Visit the website to complete device approval and account setup. Test two conversations
joining one room, message delivery, owner archive/activation and session revocation.
Room codes locate rooms; they do not replace an authenticated account.

## Limits, state and upgrades

`roomLimit` applies to each owner's enabled rooms. `conversationLimit` applies within
each room. These are administrator configuration, not paid plans. Raise
`policyRevision` whenever changing limits; reusing a revision with different limits
fails closed. Changes apply on protected activity after the bounded cache expires.
No periodic authentication or billing alarm is required. Retention/deferred delivery
still use alarms for actual work.

Lowering limits retains the most recently active eligible resources. Disabled rooms
can be activated or swapped within quota from the rooms page. Manually archived rooms
remain archived. Disabling does not immediately delete history; the configured idle
retention still applies (7 days by default), so it is not a permanent archival service.

Before an upgrade, back up D1 and follow the release's schema/deployment ordering.
Keep your Worker names, `TEAM_ROOM` binding, `TeamRoom` class and migration history
stable for an existing instance. Renaming them can select a different DO namespace.
Do not deploy an old room-creation writer alongside the new resource-catalog writer:
complete catalog migration under the new gateway before enabling new resource policies.
Rolling code back does not roll database schema or room state back.

References: [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/),
[Vite configuration API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/),
[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
