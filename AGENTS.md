# Repository Guidelines

## Project Structure & Module Organization

The repository is being rewritten on the `redesign` branch. The design lives outside this repository, in the workspace root: `../docs/redesign/01-concepts.md` (glossary), `02-architecture.md` and `04-codebase.md` (module layout, interfaces, implementation order and progress). Read them before editing; code follows those documents.

This pnpm workspace contains:
- `packages/protocol/`: the wire contract. Nouns, the operation table, error codes, headers and frames, agent-facing tool definitions, and the functions that render every word an agent reads. Depends on zod only; no IO.
- `packages/hub/`: Hono Worker. `src/operations/execute.ts` is the one entry every binding uses; `src/room-do/` is all of a room's state and behaviour in one Durable Object; `src/directory/` is D1; `src/auth/` is Better Auth; `src/bindings/` only decode and encode. `testing/` holds the black-box suite that any composition of the Hub can run.
- `packages/bridge/`: the library a host's client embeds. `createBridge` is its whole interface: HTTP operations, the room link, the two unread numbers, the wake state machine, the tools, the joined marker. Entries: `.` , `./stdio` (MCP server over `bridge.tools`), `./local` (files only; what hooks import).
- `clients/codex/`: the Codex client, bundled to `dist/tandry.cjs`.
- `clients/claude/`: the Claude Code client: `dist/main.cjs` (`mcp`, `monitor`) and the small `dist/hook.cjs`. Its three kinds of process talk only through the files in `src/files.ts`; host measurements are in `../docs/redesign/03-hosts.md`.
- `clients/commands.ts` is the one source for every host's slash commands and skills (`pnpm generate:commands`). The other hosts are not rewritten yet (step 6 of `04-codebase.md`).
- `website/`: TanStack Start frontend. Room history, correspondence and management use the protocol through `lib/hub.ts`; auth/config routes use `lib/api.ts`. Browser calls are account observers and never consume inboxes.
- `docs/`: mostly describes the previous design; trust `../docs/redesign/` where they differ.

Dependency direction is checked by `pnpm check:source`: hub, bridge and website import only `@tandryio/protocol`; a client imports only `@tandryio/bridge`; clients never import each other.

## Build, Test, and Development Commands

Use Node.js 22+ and pnpm 10.28.0, matching the repository tooling.
- `pnpm install --frozen-lockfile`: install workspace dependencies.
- `pnpm typecheck`: check all workspace TypeScript projects.
- `pnpm --filter @tandryio/protocol test`: rendering and wire-format tests.
- `pnpm --filter @tandryio/hub test`: the black-box Hub suite against a real local workerd with temporary D1 and Durable Object state. Then `vitest run` with `@cloudflare/vitest-plugin` for `test/workerd/*.spec.ts`: only behaviour that depends on a Durable Object alarm, fired on demand with `runDurableObjectAlarm` (`test:workerd` runs these alone).
- `pnpm --filter @tandryio/bridge test`: the bridge against a scripted local Hub server and a recording shell.
- `pnpm --filter @tandryio/client-codex test`: the shipped bundle as a stdio MCP server against a real local Hub.
- `pnpm --filter @tandryio/client-claude test`: the shipped bundles run as Claude Code runs them (MCP server, hook commands, monitor) against a real local Hub.
- `pnpm test:e2e`: two real bridges exchanging a message through a real local Hub.
- `pnpm --filter @tandryio/hub types`: regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc`.
- `pnpm check:source`: tracked artifacts, public/private boundary, dependency direction.
- `pnpm hub:dev --local --port 8799` and `pnpm website:dev`: run local services in separate terminals.
- `pnpm --filter @tandryio/hub db:local`: initialize/update local D1.

## Coding Style & Naming Conventions

Prefer Node/platform APIs and official SDKs, then existing, widely adopted dependencies over custom infrastructure. Before adding a dependency, check adoption, maintenance and ecosystem usage; keep small, clear implementations when the alternative is niche. Keep control flow simple and avoid generic wrappers that add more complexity than they remove.

Use two-space indentation, TypeScript for core services/frontend, and TypeScript for native host adapters. Preserve surrounding quote style. Use camelCase for functions and PascalCase for types/components. MCP tools use short names under the `tandry` server; native host tools use `tandry_*`. Codex skill names omit the plugin prefix, producing `tandry:join`, etc. Run `pnpm format:web` for frontend formatting. Edit source files rather than generated bundles or `routeTree.gen.ts`; rebuild generated outputs before submitting.

## Testing Guidelines

Tests use Node's test runner and `assert`; TypeScript suites are `test/*.test.ts` run through `tsx`, tooling tests are `*.test.mjs`. The one exception is `packages/hub/test/workerd/`, which runs inside workerd under vitest because alarms cannot be reached from outside. Test a module through its interface: the Hub through HTTP and the room link, the bridge through `createBridge` and the wire. Add focused behavioral coverage for authentication, conversation isolation, delivery retries, and changed host integrations. Real Hub tests use local workerd/SQLite; keep tests isolated from production and personal state. No numeric coverage threshold is configured. CI also checks Worker deployment dry runs, validates the exported marketplace packages and rejects tracked build artifacts. Marketplace releases go to the separate `tandryio/tandry-marketplace` repository; see `docs/marketplace.md`.

## Commit & Pull Request Guidelines

History uses short, action-oriented subjects such as `Fix hub deployment script for pnpm`; Conventional Commit prefixes are not required. Keep commits focused. PR descriptions should explain the problem, resulting behavior, validation, and any deployment ordering. Link relevant issues and include screenshots for visible UI changes.

## Security & Configuration

Keep secrets in ignored `.dev.vars` files or Cloudflare Secrets. Authorization uses immutable account IDs, never handles or room codes. All hosts default to `~/.tandry`; tests should override `TANDRY_HOME`. Do not add legacy local-storage migration machinery. Preserve unrelated workspace changes.

Use English for code, comments, diagnostics and examples. Keep localized text in JSON message catalogs and multilingual test fixtures. Repository tooling tests live in `tests/`; `scripts/` contains development, build and validation tools.
