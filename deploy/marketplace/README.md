# Tandry marketplace

Installable Tandry plugins for Claude Code, Codex and Grok Build.
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

## Grok Build

```sh
grok plugin marketplace add tandryio/tandry-marketplace
grok plugin install tandry@tandryio/tandry-marketplace --trust
```

Start a new session. After joining a room, the conversation starts the Tandry
inbox monitor itself.

## Updates and contributions

The marketplace name remains `tandry-marketplace`, and the plugin identifier
remains `tandry@tandry-marketplace` in Claude Code and Codex, and `tandry` in
Grok Build. If an existing installation points at `tandryio/tandry`, remove its
old marketplace registration and add this repository.

Grok Build reads `.grok-plugin/marketplace.json` and the generated component
catalog `.grok-plugin/plugin-index.json`; Claude Code reads `.claude-plugin/`
and Codex reads `.agents/plugins/`. All three describe the same packages.

Do not edit bundles here. Releases are built and validated in the source repository,
then copied here by its marketplace release workflow. See the
[release guide](https://github.com/tandryio/tandry/blob/main/docs/marketplace.md).
