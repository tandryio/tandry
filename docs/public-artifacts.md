# Public npm packages and private composition

The public repository provides one Hub implementation and can run independently.
The cloud repository composes it with private subscription policy and billing routes.
Runtime imports use `@tandryio/hub`, `@tandryio/protocol` and the website package;
there is no second copy of RoomDO and no network hop to another Hub service.

## Local development

Place the repositories next to each other. Install this public workspace normally:

```sh
pnpm install --frozen-lockfile
```

In the private repository run `pnpm dev:setup ../tandry`, then `pnpm dev`.
The explicit setup uses a pnpm readPackage hook to link the three public packages.
Only the private repository's ignored `.local` directory contains local paths, the
install hook and its separate development lockfile. Committed package.json continues
to declare exact npm versions. Public source/configuration never references cloud.

The private dev command starts its local Hub and this repository's Vite website,
using a private generated service-binding configuration. Hub changes are watched by
Wrangler; website changes use Vite HMR. It does not use a precompiled website snapshot.
All `pnpm agent <host>` commands remain in the public repository and default to the
same localhost Hub on port 8799. Do not start both self-host and cloud on that port.

## Standard npm packages

`hub`, `protocol` and `website` have public npm metadata and files allowlists. Use
standard pnpm pack/publish tooling. The protocol and Hub export TypeScript intended
for a Workers bundler; the website package contains its built Worker/browser assets.
The prepack lifecycle copies licenses; website prepack additionally builds it.
The beforePacking hook removes development scripts/dependencies; the prebundled
website needs no installed runtime dependencies. Workspace protocol references are
converted to registry versions by pnpm. Use the pinned pnpm 10.28.0 for packaging.

`pnpm check:packages` creates standard npm archives in a temporary directory, checks
paths, package manifests, licenses and private configuration markers, then removes
them. It does not publish, create a custom artifact manifest, or write vendor files.

For an authorized release, publish protocol before Hub, and publish the website
version intended for that release. Select reviewed versions/commits and release
credentials; configuring publishConfig.access does not publish anything by itself.
The former custom `pack:core`, import script and SHA-addressed vendor workflow have
been removed. Ordinary local edits require no packing or importing.

## Consumer release gate

The private repository pins npm versions. The public packages are published, so
it runs its normal registry install and commits the resulting pnpm-lock.yaml.
CI/release must use that registry-only frozen lockfile and reject local link/file
overrides. A missing registry lockfile is never a reason to commit the local
lockfile or fabricate registry integrity hashes.

Before publication, the private `check:standalone --candidate /path/to/public` checks
standard npm archives in an isolated temporary consumer. This is explicitly candidate
validation, not evidence that npm publication succeeded. Default check:standalone
instead validates real pinned registry dependencies without an adjacent checkout.

## Notices and compatibility

`pnpm notices:generate` records installed cross-platform JavaScript dependencies and
build tooling in licenses/manifest.json and licenses/THIRD_PARTY_NOTICES.md, with versions,
source archives, license texts and hashes. Version-specific overrides cover packages
that omit license files. CI/build checks freshness without network access. Plugins and
npm packages carry notices; website builds serve `/third-party-notices.txt`.

Core behavior has one implementation. Both providers run the same policy contract;
private integration CI tests a selected public revision and separately validates its
standard package contents through an isolated install. Breaking protocol/policy/schema
changes require compatibility and migration ordering before the cloud updates its pin.
