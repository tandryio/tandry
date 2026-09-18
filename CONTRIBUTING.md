# Contributing

Tandry's public core includes protocol, authentication, collaboration, host
adapters, room administration and self-hosting. Changes to general resource policy
contracts belong here. Official payment/subscription rules live in a separate private
composition and must not become a public-build dependency.

Read AGENTS.md for workspace layout, style and validation. Use Node.js 22+ and pnpm
10.28.0, install with the frozen lockfile, and keep tests on isolated local state.
For core changes run `pnpm typecheck`, `pnpm build` and the bridge tests. Website
changes also need `pnpm website:build` and its i18n tests. Run `pnpm check:source`
when changing composition, dependencies or deployment configuration. Never edit
regenerated plugin bundles directly or commit them here. Marketplace distribution
lives in `tandryio/tandry-marketplace`; see `docs/marketplace.md`. Include deployment ordering for schema changes.

Keep pull requests focused; explain the problem, resulting behavior and relevant
validation. Preserve unrelated changes. Do not include credentials, personal agent
state, private cloud source or production data in issues, fixtures or screenshots.

Contributions to original public source are under this repository's Apache-2.0
license. Preserve upstream licenses and attribution when reusing third-party code.
Do not contribute code you are not entitled to distribute under those terms.
