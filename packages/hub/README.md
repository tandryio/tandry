# Tandry Hub core

Public Cloudflare Worker/RoomDO composition, authentication, resource policy and
room delivery. `createHub` and `createAuthorization` accept a server-selected
PolicyProvider. `TeamRoom` is shared by self-hosted and private cloud deployments.
This package contains source, migrations, runtime declarations and explicitly
opt-in local test helpers. It contains no deployment IDs or payment integration.
See the repository's `docs/self-hosting.md` and `docs/authentication.md`.
