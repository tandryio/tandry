# Public source and private composition

The public repository provides one Hub implementation and can run independently.
The cloud repository composes it with private subscription policy and billing routes,
building this repository's source at a pinned commit rather than installing it from a
registry. Runtime imports still use the package names `@tandryio/hub`,
`@tandryio/protocol` and `@tandryio/web`; they resolve to workspace members there.

## Local development

Place the repositories next to each other. Install this public workspace normally:

```sh
pnpm install --frozen-lockfile
```

The private repository pins a commit of this one in its `core.json`, checks it out
into an ignored `core/` and installs `packages/protocol`, `packages/hub` and
`packages/web` as members of its own workspace. `pnpm dev:setup ../tandry` does that
from an adjacent clone; the pinned commit is what gets built either way. Committed
package.json files there declare `workspace:*`. Public source and configuration never
reference cloud.

The private dev command starts its local Hub and this repository's Vite website,
using a private generated service-binding configuration. Hub changes are watched by
Wrangler; website changes use Vite HMR. It does not use a precompiled website snapshot.
All `pnpm agent <host>` commands remain in the public repository and default to the
same localhost Hub on port 8799. Do not start both self-host and cloud on that port.

## Not npm packages

Protocol, Hub and Web are **not published**. Their only consumers build from source:
the private cloud through its pin, self-hosting through this repository. Publishing
them added a registry round trip to every shared change and, because the three
versions moved in lockstep, forced a Hub redeploy — and a disconnect of every open
room link — for changes the Hub never saw. They are marked `private` so that cannot
restart by accident.

The client packages are still published; see [npm client releases](npm-releases.md).

`pnpm check:packages` still packs protocol, Hub and Web in a temporary directory to
check their paths, manifests, licenses and private-data markers. Nothing is published
by it: what it protects is the file layout the cloud's pinned checkout consumes, and
the boundary that keeps cloud configuration out of public source.

## Composition

The private repository owns subscription policy, billing routes and its own website
routes, and composes them with `createHub` and `createRoomDO` from this repository's
Hub. There is no second copy of RoomDO and no network hop to another Hub service.
Moving the shared dependency is one commit there: a new pin, a reinstall, a lockfile.
