# npm client releases

Pi, OpenCode, and DeepSeek Harness use prebuilt npm packages:
`@tandryio/pi`, `@tandryio/opencode`, and `@tandryio/dsh`.
Claude Code and Codex keep the [Git marketplace](marketplace.md) route.
Only the client packages are published. Protocol, Hub and Web are workspace source:
the private cloud builds them from a pinned commit, and self-hosting builds this
repository, so neither installs them from a registry. See [public artifacts](public-artifacts.md).
Codex has one distribution entry; host compatibility is documented separately.

All three packages are published under `@tandryio` with npm trusted publishing
configured, so releases run from CI without an npm token. Registry installation
acceptance is per release: install from the registry and exchange messages
before advertising a new version.

## Prepare

Ensure the npm account can publish public packages under `@tandryio`.
For each existing package, configure its npm trusted publisher:

- GitHub organization: `tandryio`
- Repository: `tandry`
- Workflow filename: `npm-release.yml`
- Allow direct `npm publish`; no GitHub environment is configured.

The workflow uses GitHub-hosted runners, Node 24, npm 11.19.0, and
`id-token: write`. It publishes with provenance and needs no persistent npm
write token. The package repository URL matches the source repository.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

The three client packages already exist and are configured. If a new package
cannot be configured with a trusted publisher before its first version,
bootstrap that version using an authorized npm account and
reviewed workflow archives. Download the dry-run artifact, then publish each
`.tgz` with `npm publish <archive.tgz> --access public --tag latest --ignore-scripts`.
Interactive npm login/2FA may be required. Configure trusted publishing after
creation; subsequent releases use the workflow. Local bootstrap does not claim
GitHub provenance. Never publish directly from a client source directory.

## Run a release

1. Commit the source and select its branch in **Actions → release npm clients**.
2. Enter a canonical version shared by all three clients. Every release is
   published as `latest`, prereleases included: there is no preview channel, so
   an install without a version gets the newest release.
3. Leave `dry_run` enabled to build, test, inspect, and upload the archives.
4. Once ready, run the workflow on the same source revision with `dry_run`
   disabled. It publishes npm packages, then automatically calls the marketplace
   workflow with the same version and source revision. Configure
   `MARKETPLACE_TOKEN` as described in [marketplace releases](marketplace.md).
   Deploy the matching Hub and website before public use.

A dry run publishes neither npm packages nor the marketplace. A failed npm job
blocks marketplace publication. If only marketplace synchronization fails, rerun
its failed job; do not choose a new version or source revision. Normal source
pushes and pull requests only validate; one explicit release starts distribution.

The workflow builds the existing client distribution, runs workspace and
artifact tests, then packs only the three native clients into `.local/npm/`.
It checks host manifests, license files, version consistency, and allowed
paths. Package versions and bundled runtime versions use `RELEASE_VERSION`;
source versions are unchanged. The artifact includes `release.json` with the
source commit and archive SHA-512 integrity values.

Before writing to npm, the publisher checks all three requested versions.
An existing version with identical integrity is skipped; different contents
stop publication. Registry errors also stop publication. npm publication is
not atomic across packages: after a partial failure, rerun the same revision
and version. Already published packages keep their existing dist-tags.
Changing a tag on an existing version is a separate, deliberate npm operation:
CI's trusted publishing covers `npm publish` only, so `npm dist-tag` needs a
signed-in account.

## Local dry run

From the source repository:

```sh
RELEASE_VERSION=0.1.1-rc.1 pnpm npm:pack
RELEASE_VERSION=0.1.1-rc.1 node scripts/npm-release.mjs dry-run
pnpm test:npm
```

These commands write local archives but do not publish. Actual publishing
rejects artifacts built from a dirty checkout. Build again without the version
override to restore ordinary local development bundles.

## Install and update after publication

Pi:

```sh
pi install npm:@tandryio/pi
pi update npm:@tandryio/pi
```

OpenCode: add `@tandryio/opencode` to the `plugin` array in
`opencode.json`. Use an explicit published version when testing upgrades;
startup installation alone does not establish automatic upgrade behavior.

DeepSeek Harness:

```sh
dsh plugin --profile web add @tandryio/dsh
dsh plugin --profile web update @tandryio/dsh
```

Restart the DSH profile after updating. When accepting a release, install its
explicit version so the check does not depend on when the default tag moved.
Validate installation, two-way messaging, update, and removal in isolated
host settings before declaring the registry path accepted.
