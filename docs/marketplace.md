# Marketplace releases

`tandryio/tandry` contains source, manifests, tests and build configuration.
[`tandryio/tandry-marketplace`](https://github.com/tandryio/tandry-marketplace)
contains installable plugin packages. It carries the released Claude Code and
Codex plugins; its `release.json` records the source commit and plugin versions
of each build.

## Connection and distribution

Tandry is one product with host-specific connections. The website’s
[Connect Tandry](https://tandry.io/#install) entry recommends one setup per
host and records its delivery limits. Local adapters share the Hub with the
remote OAuth MCP connection at the website’s `/mcp` endpoint. A remote
connection remains pull even inside Codex; installing a local marketplace
package does not itself prove that hooks or idle wake work on a desktop host.

The public remote plugin is submitted to the OpenAI directory using its HTTPS
MCP endpoint and OAuth integration. Local host packages are released through
the Git marketplace described below. These are separate release artifacts,
not separate accounts, rooms, or products. Publishing either does not publish
the other. A marketplace plugin can also reference a remote MCP service;
distribution source does not determine delivery capability.

The Git marketplace is released; the OpenAI directory submission is separate
and does not follow from it. Complete the relevant host acceptance and keep the
website's install commands matching what is actually released. Do not attach two
indistinguishable sets of local and remote room tools to the same conversation.
For a switch, explicitly continue the same member with `join as`; never use
`leave` to preserve membership. Cross-connection duplicate detection is not
implemented because remote calls lack a shared trusted host conversation ID.

## Publish through GitHub Actions

1. Once: add the source repository's Actions secret `MARKETPLACE_TOKEN`. Use a
   fine-grained GitHub token restricted to `tandryio/tandry-marketplace`, with
   **Contents: read and write** permission.
2. Run **Actions → release npm clients** with publishing enabled. Successful npm
   publication automatically invokes this workflow for the same source and version.
   The standalone **release marketplace** action remains available for a
   marketplace-only release or recovery.

CI installs dependencies, builds and tests the plugins, applies the requested
version to the bundled MCP servers and exported package/plugin manifests, and pushes the distribution plus
its version tag to the marketplace. It also handles an empty marketplace's first
release. Reusing a published version fails; existing tags are never overwritten.
Source manifests are unchanged. Normal pushes and pull requests validate without
publishing. No local release commands or manual source tags are needed.

`release.json` records the source commit and released versions. The workflow uses
`pnpm pack` for package contents, `semver` for version validation and `rsync` to sync
the distribution. The default `GITHUB_TOKEN` cannot publish to another repository,
which is why the one-time token setup is required.

Keep a matching Hub and website deployed for the released plugins, as described
in the root README. The [npm client release workflow](npm-releases.md) publishes Pi, OpenCode and DSH
first, then invokes this workflow to synchronize the marketplace.

## Local development

`pnpm build` generates ignored plugin files under `clients/` and exports the standard
packages into ignored `.local/marketplace/`. Package `files` lists define what ships;
marketplace templates live in `deploy/marketplace/`. The existing pnpm packing hook
removes development metadata. Generated bundles, instructions and copied
licenses are never committed to the source repository.

`pnpm test:marketplace` validates the exported distribution. `pnpm check:source`
rejects tracked build artifacts. `pnpm agent codex` registers `.local/marketplace/`;
`pnpm agent claude` loads its client directory directly. `pnpm agent pi` loads
the bundled native extension. `pnpm agent opencode` loads the bundled native
plugin through process configuration. `pnpm agent dsh` adds a temporary Cordis
patch pointing to the bundled native plugin. These five hosts are packaged during
the rewrite; Kimi follows in step 6. If the same marketplace
name points to the old source root, remove that registration before retrying.

## Switch existing installations

Installations that still point at the source repository or a local build need
their registration replaced. The marketplace name and plugin identifier remain
unchanged.

Claude Code:

```text
/plugin marketplace remove tandry-marketplace
/plugin marketplace add tandryio/tandry-marketplace
/plugin install tandry@tandry-marketplace
```

Codex:

```sh
codex plugin marketplace remove tandry-marketplace
codex plugin marketplace add tandryio/tandry-marketplace
codex plugin add tandry@tandry-marketplace
```

Update project `extraKnownMarketplaces` entries to `tandryio/tandry-marketplace` too.
Start a new conversation and review hooks as usual. Shared `~/.tandry` data is retained.
