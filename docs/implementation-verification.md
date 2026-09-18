# Implementation verification — 2026-09-15

> Dependency workflow updated: the historical vendor/tarball statements below are
> superseded by [public-artifacts.md](public-artifacts.md). Local development now
> links source; release uses npm versions. The first npm release is still pending.

The v3 review design is implemented as a public core and an independent private
cloud composition. This is an uncommitted local development result, not a release
or a production deployment. Existing unrelated workspace changes were preserved.

## Acceptance evidence

The original 16 cases are mapped below. Public test paths are relative to
`packages/bridge/scripts` unless specified; private tests are in the independent
cloud repository's `scripts` directory. Runtime tests use local workerd/SQLite and
synthetic accounts. Payment tests use mocked provider responses.

| # | Required behavior | Evidence |
| --- | --- | --- |
| 1 | One shared login supports independent refs; revoke affects all associated connections | `event-auth.test.mjs`: two Alice refs, exact-session revocation closes both. |
| 2 | Another account cannot take over a known ref | `auth.test.mjs`: Bob's hello using Alice's ref fails; Alice remains connected; server supplies account identity. |
| 3 | Both expired send authorization and recipient delivery require verification | `event-auth.test.mjs`: expired inbound list is blocked during authority failure; deleting the recipient's primary session without push blocks delivery and leaves its message queued. All protected inbound operations use the same `authorizeSocket` gate. |
| 4 | Authority outage fails closed and is recoverable | `event-auth.test.mjs`: retryable 4010, no protected response, same ref resumes after recovery. `http-access.test.mjs`: 403/409/503 preserve shared credentials and do not request a new login. |
| 5 | A revocation already received defeats a delayed verified upgrade | `event-auth.test.mjs`: a synthetic prevalidated internal upgrade is rejected by the persisted exact-session barrier before and after real instance eviction. |
| 6 | Membership removal during authority await still prevents the operation | Test authority captures a valid grant and pauses; the fixture bans the member without closing its socket; release returns the old grant; `event-auth.test.mjs` verifies 4006 and no agents response. Controls exist only in a test entrypoint excluded from public artifacts. |
| 7 | Concurrent contenders for the last seat cannot exceed quota | `resource-policy.test.mjs`: two simultaneous refs compete for one seat; one welcome and one 4005. Concurrent room creation also yields one success and one 409. The shared provider contract separately tests three atomic D1 allocation contenders. |
| 8 | Same-ref replacement occupies one seat; old close cannot free it | `resource-policy.test.mjs`: same ref replaces its socket at capacity, old socket closes with 4000, a new ref still fails. |
| 9 | No billing/auth wake-up at an idle deadline; activity checks policy first | `event-auth.test.mjs` inspects a distant retention alarm; auto-ping does not call authorization. Private `cloud.integration.test.ts` exercises a controlled expired deadline and shrink before the next protected event. Source has no auth/billing timer; grants are capped at known transition deadlines. |
| 10 | Preferences first, stable fallback, one final result | Private `billing.test.ts` checks preferences, activity/ID ranking and repeated/concurrent finalization. `resource-policy.test.mjs` checks one-time seat shrink and a new ref using a later free seat without replay of the old selection. |
| 11 | Renewal cancels downgrade; stale writes cannot overwrite new rights | Private billing/payment/plan-revision tests exercise renewal, delayed events, leases, CAS revisions, deleted/archived catalog rows and stale plan writers. |
| 12 | Recovery preserves choices, revocation barriers and socket identity | Resource/event tests leave local workerd idle for 12 seconds, then assert a changed constructor UUID. Existing WebSocket remains open, chosen seat stays online and a repeated transition does not evict its replacement; exact-session revocation still rejects the stale upgrade. This is actual runtime eviction, not just a second call on the same instance. |
| 13 | Self-host can authenticate and collaborate without official/private services | Public auth/device/email tests and real public Hub collaboration fixtures run with synthetic local accounts and providers. Public dependency/build boundary checks and both self-host Worker dry runs need no private package or Stripe key. External OAuth/email provisioning is documented, not claimed tested against a real deployment. |
| 14 | Hub credentials are isolated; clients cannot choose a policy provider | `http-access.test.mjs` switches between two local Hub origins: no inherited login or leaked request, a separate account works, switching back preserves the first. Provider selection is server composition; request body/query/header values never construct a provider. |
| 15 | Cloud configuration fails closed; revision changes cannot bypass allocation | Private `billing.test.ts` rejects missing/invalid configuration and stale/mismatched revisions. Public resource tests reject expired allocation leases, wrong allocation tokens and stale commits. |
| 16 | Public artifacts exclude private code/config; both providers share a contract | Source and archive boundary checks pass. Both tests import the same public `testing/policy-contract.mjs` function. Vendored hashes, frozen install, all private tests and both Worker dry runs pass in an isolated copy without a sibling public checkout. |

## Final verification

- Public frozen install, workspace typecheck and plugin build passed.
- Public bridge suite: 20 tests; Hub shared contract: 1 test. Host-launcher/i18n
  invocation: 8 Node test results (includes its five host subtests).
- Private suite: 21 tests. Independent-copy frozen install, typecheck, all 21 tests,
  Hub dry run and website dry run passed.
- Public website production build, both Worker dry runs, artifact integrity/boundary
  checks and dependency notice freshness check passed.
- Browser QA covered room activation/archive/swap, bilingual billing selections,
  stale choices and 390-pixel mobile controls in earlier checkpoints. The final
  pinned website additionally passed client navigation to account and billing, and
  serves full dependency notices at `/third-party-notices.txt`.
- The portable website manifest contains relative route paths. Its production build
  no longer embeds a developer's absolute checkout path in public server artifacts.
- Plugin license/notice files are generated from the same reviewed public inventory;
  the packer records source revision, dirty state, lockfile hash and build-tool versions.

The 60-second authorization/policy bound is a maximum accepted cache lifetime, not
an immediate global revocation SLA. Pushes reduce latency; a missed push is caught
on protected activity after cache expiry. An idle physical socket may remain open.
Policy failure pauses the operation instead of reusing an expired policy.

Business activity is reported to the account catalog at most once per minute. Recent
activity ranking is based on that recorded activity, not exact keystroke order or
heartbeats. Stable IDs break ties. Conversation capacity counts online refs, not
machine credentials or installed host types.

## Migration and deployment ordering

1. Back up the existing D1 database and review the intended Worker/DO namespace.
   Keep the established Worker name, `TeamRoom` class, `TEAM_ROOM` binding, namespace,
   D1 identity and migration history when updating an existing service.
2. Apply public migrations `0002_resources.sql`, `0003_provisioning.sql` and
   `0004_resource_catalog.sql` after the existing account schema. A new installation
   applies `0001_accounts.sql` first. Cloud then also applies `1001_billing.sql`,
   `1002_payment_refresh.sql`, `1003_checkout.sql` and `1004_plan_revision.sql`.
3. Stop old room-creation writers during cutover. Deploy only the new gateway/core;
   do not mix old writers that bypass the catalog with a new quota policy. Account
   activity bootstraps and fences its complete existing room directory before policy
   finalization. DO-originated callbacks require a ready catalog and never bootstrap
   by recursively calling other rooms. Room-local SQLite updates occur on construction.
4. Configure one intended monotonic policy/plan revision, authentication providers,
   commercial limits/prices and cloud payment secrets. Missing cloud configuration
   fails closed. Changing a Stripe price ID needs a separate commercial migration;
   it is not equivalent to adjusting a quota revision.
5. Deploy the chosen Hub composition before its website. Self-host uses generated
   ignored `.self-host` targets; official cloud uses its private configuration and
   pinned core. Validate login, room creation/join, delivery and revocation on that
   deployment before release. These remote steps were not performed here.

## Explicit scope

Retained data is not a permanent archive. Disabling a room preserves its data until
normal idle retention (7 days by default), and manual archive does not exempt it from
retention. A general history export/import feature is not included in this iteration;
operators can back up storage. Do not market disabled rooms as permanent readable
archives or promise an end-user export UI that does not exist.

The review's deferred Docker/Node runtime, local credential broker, MachineDO,
per-agent JWT, cross-Hub federation and periodic notification email are not included.
The basic/paid limits, grace duration and prices remain deployment configuration.
There were no real payments, remote database operations, deployments, commits,
pushes or public releases. Release signing and contributor-rights review remain
publication responsibilities; this local hash manifest is not a signed provenance claim.
