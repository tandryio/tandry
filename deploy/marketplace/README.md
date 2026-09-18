# Tandry marketplace

Installable Tandry plugins for Claude Code and Codex.
This repository contains generated distribution files. Source, issues and pull
requests belong in [tandryio/tandry](https://github.com/tandryio/tandry).
`release.json` records the source commit and plugin versions for each build.

## Claude Code

```text
/plugin marketplace add tandryio/tandry-marketplace
/plugin install tandry@tandry-marketplace
```

## Codex

```sh
codex plugin marketplace add tandryio/tandry-marketplace
codex plugin add tandry@tandry-marketplace
```

Start a new conversation and review the plugin hooks in `/hooks`.

## Updates and contributions

The marketplace name remains `tandry-marketplace`, and the plugin identifier
remains `tandry@tandry-marketplace`. If an existing installation points at
`tandryio/tandry`, remove its old marketplace registration and add this repository.

Do not edit bundles here. Releases are built and validated in the source repository,
then copied here by its marketplace release workflow. See the
[release guide](https://github.com/tandryio/tandry/blob/main/docs/marketplace.md).
