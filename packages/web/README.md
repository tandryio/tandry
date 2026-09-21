# Tandry web

Shared source for self-hosted and hosted Tandry applications. Includes public pages,
components, styles, English/Chinese catalogs, documentation and static assets.
Applications own route registration, Vite and Worker configuration.

Use `webRouterOptions(options)` to compose the shared pages with additional
main/workspace navigation and explicit login destinations. Options are scoped to the
React provider; there is no global edition flag or private dependency.

Packed archives contain generated locale modules, ready for the consuming Vite
build. Run `pnpm build` when editing catalogs locally. The website Vite config uses
`webConfig()` for shared assets and singleton dependencies. Consumer Fumadocs source
loads `node_modules/@tandryio/web/content/docs`.
