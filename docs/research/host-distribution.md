# Host distribution

Research date: 2026-09-18. This records official distribution mechanisms and a
proposed Tandry release path. No packages were published or installation
configuration changed. Registry installation and upgrades remain unverified.

## Recommendation

Publish Pi, OpenCode, and DeepSeek Harness clients as separate, prebuilt npm
packages. Keep the existing marketplace route for Claude Code and Codex.
Present **Codex** as one host and installation entry; describe CLI/Desktop
compatibility and acceptance results separately where relevant.

The following package names describe proposed post-publication entry points,
not currently available releases.

| Host             | Proposed package            | Installation                                        |
| ---------------- | --------------------------- | --------------------------------------------------- |
| Pi               | `@tandryio/client-pi`       | `pi install npm:@tandryio/client-pi`                |
| OpenCode         | `@tandryio/client-opencode` | Add the package to `opencode.json`'s `plugin` array |
| DeepSeek Harness | `@tandryio/client-dsh`      | `dsh plugin --profile web add @tandryio/client-dsh` |

## Pi

Pi supports npm, Git, and local package sources. Resources are declared through
the `pi` manifest or conventional directories. The `pi-package` keyword makes
an npm package discoverable in its gallery. Tandry already declares
`pi.extensions`. [Official package documentation](https://pi.dev/docs/latest/packages)

Use `pi update npm:@tandryio/client-pi` for this package and
`pi remove npm:@tandryio/client-pi` to uninstall. Bare `pi update` updates Pi
itself; `pi update --extensions` updates packages. Install/remove default to
user settings; `-l` selects project settings. [Package management](https://pi.dev/docs/latest/packages#install-and-manage)

The current docs require imported Pi core packages and `typebox` to be
unbundled `peerDependencies` with range `"*"`. Tandry currently bundles
TypeBox: reconcile that packaging with the supported Pi version before
publishing. [Dependency requirements](https://pi.dev/docs/latest/packages#dependencies)

## OpenCode

OpenCode accepts npm packages, including scoped packages, in the `plugin`
array. It automatically installs configured npm plugins at startup. Local
plugin files support development. The documented startup installation does
not establish that every startup upgrades every plugin; verify upgrade
behavior against the supported release before promising it.
[Official plugin documentation](https://opencode.ai/docs/plugins/)

The proposed configuration is:

```json
{
  "plugin": ["@tandryio/client-opencode"]
}
```

## DeepSeek Harness

DSH distributes plugins as npm bundles. A bundle declares
`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` and includes both its
code and patch. Without that declaration, installation adds a plain dependency
without activating a configuration layer.
[Bundle manifest](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md#the-bundle-manifest)

`dsh plugin --profile <name> <args...>` forwards to pnpm, which must be on PATH.
Use `add`, `update`, or `remove` with the package name. Successful operations
reconcile the profile's bundle list; restart the profile to apply bundle
changes. [CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md#plugin-management)

Official distribution options include npm, Git, and a tarball from `pnpm pack`.
Git sources need a self-contained `prepare` build and, with pnpm 10+, consumer
build authorization. Prebuilt npm packages and tarballs avoid that extra build
step. Prefer npm for Tandry; retain tarballs for release acceptance.
[Distribution tutorial](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md#installing-from-github-the-build-script-catch)

The official discovery instruction is to add the GitHub `dsh-plugin` topic.
DSH remains a developer preview with expected breaking changes, so record the
version used for acceptance. [Official README](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md)

## Repository work before publication

The three client source manifests currently have `private: true`. The packing
hook removes `private`, scripts, development dependencies, and dependencies;
audit the packed manifests against each host's requirements. The marketplace
release workflow pushes Git artifacts and does not publish npm packages.
Sources: [client manifests](../../clients/), [packing hook](../../.pnpmfile.cjs),
[release workflow](../../.github/workflows/marketplace-release.yml).

Add npm release automation, inspect each packed artifact, and verify clean
registry installation, update, removal, and runtime behavior before labeling
these installation routes released. Include Pi's gallery keyword and review
its peer dependencies as part of that work.

## Implementation follow-up

The npm workflow, package metadata, Pi TypeBox peer, archive checks and dry-run
validation were added later on 2026-09-18. See [npm releases](../npm-releases.md).
The gaps above describe the state at research time; registry publication and
installation/upgrade acceptance still remain pending.
