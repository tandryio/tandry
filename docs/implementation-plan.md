# Authentication and deployment implementation

> Dependency workflow updated: the historical vendor/tarball statements below are
> superseded by [public-artifacts.md](public-artifacts.md). Local development now
> links source; release uses npm versions. The first npm release is still pending.

Source: `/tmp/tandry-auth-review.html` (v3, 2026-09-15). This checklist tracks
implementation. The final audit and scope boundaries are recorded in
[implementation-verification.md](implementation-verification.md). Earlier checkpoints
below are historical progress notes; their open-item lists are superseded by that audit.

- [x] Event-driven, bounded session verification through an internal Worker entrypoint;
  inbound and recipient delivery checks, single-flight refresh, fail closed, post-await
  membership/connection checks, durable revocation barriers, complete fanout.
- [x] Remove periodic authentication/presence polling; retain explicit retention and
  delivery work only where necessary. Heartbeats remain platform auto-responses.
- [x] Generic versioned owner/room policy contract and configurable self-host provider;
  atomic account room allocation and room conversation seats; one-time shrink preserving refs.
- [x] Private cloud composition, subscription facts, idempotent provider event handling,
  paid period / grace / finalization / renewal; no private imports in the public core.
- [x] Owner room/conversation selections, stable activity fallback, pre-deadline cohorts,
  event-driven finalization before new activity, disabled rooms and restoration.
- [x] Client/UI errors distinguish login, membership, disabled room, capacity and transient
  verification failures; independent hub credentials continue to support all hosts.
- [x] Independent Cloudflare self-host template, auth and room administration UI,
  installation docs, pinned public dependency in private composition.
- [x] Publication governance (license, contribution/security guidance, artifact boundary CI).
- [x] Behavioral race/failure tests, workspace checks, generated plugin build, website build,
  deployment dry runs and requirement-by-requirement completion audit.

Commercial limits, prices and payment credentials are deployment configuration, not
hardcoded product decisions. No production deployment, commit or push is part of this task.

## Checkpoint 1 — 2026-09-15

Implemented: internal Worker verification with a 60-second bound; exact-ID persistent
revocation; complete directory fanout with failure logs; inbound/recipient checks;
transient vs resource vs membership client failures; generic provider composition;
conditional D1 room allocation; local conversation seats and persisted one-time
shrink; configurable self-host quotas; resource schema migration; event-driven
reliable delivery windows. Retention and pending-delivery alarms remain.

Validation: workspace typecheck, plugin build, 18 bridge tests, and Hub deployment
dry run passed. An additional 105-message backlog assertion passes and verifies
that ACKs advance the 100-message window without polling or duplicate delivery storms.
No production data or remote deployments were changed.

Private repository initialized at `../tandry-cloud` (no remote). Only its
boundary README and ignore rules exist so far; billing is not implemented yet.

Next work (not completion claims):
- Finish policy/deadline race coverage and provisioning/retention recovery, including
  the create vs downgrade boundary and failed metadata activity updates.
- Implement private subscription lifecycle, cohorts and activity snapshots, owner
  choices and deterministic atomic finalization, renewal, authenticated billing APIs
  and UI; compose the same core instead of duplicating it.
- Add self-host deployment/configuration/UI and release-governance artifacts.
- Verify the full HTML's 16 acceptance cases, all deployment/build checks and the
  remaining checklist above against the completed implementation.

## Checkpoint 2 — private cloud composition

Implemented in `../tandry-cloud`: versioned subscription projection, grace and
owner selections, deterministic room finalization, renewal cancellation of old
transitions, Stripe raw-body signatures and owner/price validation, reconciliation
leases, checkout/portal/refresh routes, and bilingual billing UI. The public Hub
has only generic provider/hooks/navigation contracts. Local seat history protects
conversations that actually held a seat at the grace boundary, including their
subsequent disconnect/reconnect; previously offline conversations do not inherit it.

Verified: 7 private tests including real Worker/RoomDO collaboration and payment
fencing; typechecks; private Worker deployment dry run; browser save/capacity checks
and desktop/mobile layout without horizontal overflow. No real charges or deployment.
Browser screenshots: `/tmp/tandry-billing-desktop.png` and
`/tmp/tandry-billing-mobile.png`.

Review still open (do not mark the overall goal complete):
- Event-triggered payment recheck at known deadlines; discover a completed checkout
  when its initial webhook was missed; explicit duplicate/out-of-order webhook API tests.
- Room provisioning vs quota/deadline races, retention cleanup recovery and complete
  registration of pre-policy rooms before cloud account finalization.
- Owner room activation/archive/swap within quota and corresponding public UI states.
- Independent self-host setup/templates; replace private development checkout links
  with a pinned public artifact; license/security/contribution and boundary CI.
- Final source/build/test/HTML acceptance audit, including retention and revision races.

Browser workflow for the active implementation goal: Ego TaskSpace **44**, page p1.
It has not been finished because this implementation goal is ongoing. Reuse it.
The local synthetic preview was started by tool exec session **17830** at
`http://127.0.0.1:53555/api/extensions/billing`; revalidate the process before reuse.

Checkpoint 2 final checks: public workspace typecheck, all 18 bridge tests, website build,
private typecheck, all 7 private tests and the current private Worker dry run passed.
The goal remains active; the open items above are required before completion.

## Checkpoint 3 — payment recovery and room lifecycle fencing

Private cloud now recovers missed checkout/renewal notifications on requests. It checks
at known paid/grace deadlines before downgrade, uses a 30-second retry gate and account
lease, and discovers customer subscriptions with pagination and ownership/price checks.
Paid traffic before its deadline does not periodically query Stripe. Outside the paid
period, actual usage may refresh every five minutes; billing UI uses 30 seconds.
Provider outages fail closed with retryable policy errors, retaining choices and data.
Room-originated policy refresh never calls the waiting RoomDO back. Duplicate/unordered
webhooks and failed-delivery retries are exercised through the real Hono route.
Historical canceled discovery completes its checkpoint without resetting current choices.

Public creation now reserves a unique allocation ID for 60 seconds. Commit checks that
ID, the current policy revision, quota and both authorization/policy deadlines. Expired
reservations are pruned on subsequent account activity. Managed room metadata cannot
bootstrap an abandoned reservation back into existence. The creation rollback preserves
an active row if an uncertain D1 response actually committed it.

Room deletion persists a deleting marker and schedules a retry of that actual cleanup
before D1 I/O. A failed cleanup keeps durable intent; the room cannot reopen; success
removes both the generic resource row and room directory, then clears DO storage/alarm.
This is not an authentication or subscription alarm.

Required new migrations: public `0003_provisioning.sql` and private
`1002_payment_refresh.sql`. Only isolated local fixtures used them; no production database
or remote deployment was touched. Public workspace typecheck and all 18 bridge tests,
private typecheck and all 12 tests, and both Worker deployment dry runs passed. Source
formatting and diff whitespace checks passed. No bridge/protocol/UI implementation change
in this checkpoint required another plugin bundle or website build.

Next required work:
- Complete registration of pre-policy owner rooms before account finalization, including
  cold rooms and deletion/activation competing with the finalization snapshot. Account
  resource writes need a consistent snapshot/fence, not only a billing revision CAS.
- Public room activation/archive/swap APIs and UI, and event-visible grace notices.
- Prevent multiple outstanding checkout sessions across idempotency time windows;
  review expensive billing-action rate limits and configuration version transitions.
- Independent self-host setup, a pinned public artifact in the private build, release
  governance and final acceptance audit. These remain part of the original objective.

The old synthetic browser preview (session 17830, PID 97723) was confirmed live and
intentionally stopped after adding migrations; its test-state cleanup completed. Start
an updated fixture when resuming UI work. Ego TaskSpace 44/p1 remains assigned to the
ongoing implementation goal; it has not been finished. Do not create a second TaskSpace.

## Checkpoint 4 — room management, catalog snapshots and notices

Implemented and verified:
- Generic owner-only archive/activate/atomic replacement API, with policy revision,
  authorization deadline and database quota checks. The public rooms page shows states,
  usage and replacement controls in both languages; stale selections refresh before
  another attempt. Guests cannot change the owner's resources. Explicit archives
  survive subscription renewal and preserve conversation identities until retention.
- Catalog revision + transaction mutation token fence private finalization against
  concurrent deletion/archive/activity. Rejected claims cause no partial billing writes.
  The gateway bootstraps complete pre-policy owner catalogs before policy evaluation;
  RoomDO callbacks cannot partially bootstrap an account. A late unknown legacy room
  enters disabled instead of bypassing quota.
- Generic localized policy notices in UI and the WebSocket protocol. Private cloud
  supplies grace copy/limits/deadline; public code has no plan decisions. Bridge journals
  preserve service notices and deduplicate them across reconnect/restart. They have an
  explicit system source and do not ACK user messages. No new recurring auth/billing job.

New migration: public `0004_resource_catalog.sql`; apply all schema migrations before
using these sources. Only isolated local test databases were changed. Validation:
public workspace typecheck, plugin build, all 19 bridge tests, website build, both i18n
tests, private typecheck/all 14 tests, and both Worker dry runs passed. Browser QA used
Ego TaskSpace 44/p1: archive, full-capacity replacement with matching server state,
over-capacity guidance, English/Chinese switch, desktop and 390-pixel mobile layout.
Screenshots: `/tmp/tandry-management-desktop.png`,
`/tmp/tandry-management-mobile.png`, `/tmp/tandry-management-mobile-controls.png`.

Open work remains part of the original goal: independent self-host deployment/config,
pinned public-core artifact and private standalone build, licensing/security/contribution
and release boundary checks, outstanding checkout-session/configuration-version review,
and the final requirement-by-requirement HTML acceptance audit. Also review catalog
bootstrap rollout with old create producers, and finish the private billing UI's room
names/selection behavior after catalog changes. No overall completion claim is made.

Checkpoint 4 browser fixture shutdown: preview session 62728 (PID 14306) was confirmed
live, intentionally stopped after QA, and exited successfully with local-state cleanup.
The old preview URLs 50426/50522 are no longer serving. TaskSpace 44/p1 is still assigned
to this ongoing goal, device override cleared, locale currently English. Reuse that
space for subsequent UI work and finish it only when the full goal succeeds.

## Checkpoint 5 — independent repositories and self-host deployment

Implemented:
- Public core/protocol source and compiled website are packed from an explicit allowlist
  into SHA-256-addressed tarballs. Generated deployment metadata, maps and environment
  files are excluded. The manifest records the base commit and honestly marks this
  uncommitted development snapshot as dirty; it is not a published release.
- Private cloud consumes tracked vendor tarballs with integrity verification and a frozen
  lockfile. TypeScript configuration, migrations, fixtures and website preview no longer
  require a sibling checkout. Protocol and Zod versions are consistent with the core.
- Private standalone verification copies only that repository to a fresh temporary
  directory and runs frozen install, typecheck, all 14 tests and both Worker dry runs.
  This passed without the public checkout. The temporary directory was removed.
- Public Wrangler defaults now target local development without official account IDs or
  domains. Private configs preserve the existing official Hub/DO and website identities.
  The self-host JSON generator validates configuration and writes ignored target files;
  build/deploy scripts require those files and build the website with its matching Hub
  service binding. Synthetic self-host dry runs for both Workers passed; no deployment.
- Wrangler type generation now explicitly uses the public .dev.vars.example instead of
  developer-local secrets/configuration. Public Env composition preserves optional
  provider settings when generated local defaults supply them.
- Added Apache-2.0 source license, NOTICE, contribution/security guidance, self-host and
  artifact documentation, and a public-boundary CI check. Full bundled third-party notice
  inventory/provenance is still required before publication; the current notices file
  explicitly describes this limitation rather than certifying release readiness.

Validation: public frozen install/typecheck, all 19 bridge tests, website build,
public-boundary check, synthetic self-host Hub/website dry runs, private standalone
frozen install/typecheck/all 14 tests/Hub+website dry runs, and diff whitespace checks.
Invalid secret-bearing self-host configuration was rejected without changing targets.
Synthetic .self-host target files were removed after validation. No real credentials,
charges, remote database operations, commits, pushes or deployments were performed.

Logs: /tmp/tandry-cloud-standalone.log, /tmp/tandry-self-host-check.log,
/tmp/tandry-public-tests-pack.log, /tmp/tandry-typecheck-pack.log.
Private Hub upload is now about 2993 KiB (previous mixed dependencies were about 3787 KiB).

Remaining original-goal work (not completion claims):
- Checkout still uses a 30-minute timestamp idempotency bucket. Persist/reconcile a
  checkout attempt across windows so retries cannot create multiple outstanding sessions;
  bound expensive billing actions and cover timeout/concurrency/provider recovery.
- cloudAccount.settle currently returns when phase is unchanged, so CLOUD_PLANS changes
  lack a versioned projection transition. Define/apply monotonic configuration revisions,
  preserve an already promised grace deadline/cohort and reject stale/mismatched writers.
- Finish billing UI room names and stale selection repair after catalog changes; review
  HTTP 403 client classification and the original HTML's 16 acceptance cases.
- Complete bundled upstream license notices/release provenance and final acceptance,
  migration ordering, build/CI and security-boundary audit. Do not mark the overall goal
  complete until these are actually handled.

Ego TaskSpace 44/p1 remains assigned to the ongoing goal. No browser work was needed
for this configuration/packaging checkpoint; no preview is running. Reuse the same
space for the remaining billing UI checks and finish it only at overall completion.

## Checkpoint 6 — checkout recovery, plan revisions and billing UX

Implemented in the private repository:
- One durable checkout attempt per owner fixes request parameters and idempotency key
  before contacting Stripe. Concurrency and retry share it across time windows. A
  current-session GET follows a replayed POST. New attempts require terminal state;
  unknown attempts past their fixed expiry require complete bounded provider-history
  reconciliation. Provider failure never creates a replacement. Expensive billing
  actions have an atomic 30-second timestamp gate and Stripe work has a 20-second
  request budget. These are event controls, not alarms or scheduled tasks.
- Monotonic CLOUD_PLANS.revision and a persisted configuration fingerprint update
  same-phase quotas and reject mismatched or older writers. CAS also fences a new
  revision after an older writer's snapshot. Existing grace deadline, operation,
  preferences and cohort persist. Prior paid conversation capacity survives even a
  late first grace event under new configuration. Cold-room transitions preserve their
  original operation/cutoff so later config cannot replay an old shrink against new refs.
- Billing shows owner-verified room names; stale room/conversation choices are filtered
  against current candidates and limits. An own room archived in another tab returns
  409 for selection repair; another owner's room still returns 403. Save waits for
  candidate reads, old async render responses are ignored, and mobile save controls
  remain fully visible. English/Chinese browser QA exercised saving, out-of-band archive,
  stale-choice repair and successful replacement selection with matching server data.

Public bridge HTTP list/create now reserves the sign-in instruction for 401. 403
membership, 409 quota and 503 temporary failures preserve their actual error and the
shared credential. A focused runtime test covers both operations and credential
preservation. Plugin bundles were rebuilt from source.

New private migrations: 1003_checkout.sql and 1004_plan_revision.sql. Apply all schema
migrations before deployment. Administrative quota changes outside grace are explicit
operator configuration changes; changing Stripe price IDs or grandfathering commercial
contracts needs a separate price migration, not merely changing environment variables.

Verification: public typecheck/plugin build/all 20 bridge tests/public-boundary check;
private typecheck/all 20 tests/Worker dry run; vendor hashes and diff whitespace checks.
A new integration assertion initially hit the fixture's artificial payment retry window
when compressing another month into milliseconds; the fixture now explicitly expires
that synthetic cooldown. The updated full test suite passed. No live payment, remote
DB operation, deployment, commit or push occurred.

Browser: reused Ego TaskSpace 44/p1. Screenshots were viewed:
/tmp/tandry-billing-revision-desktop.png and
/tmp/tandry-billing-revision-mobile.png. A mobile sticky-boundary clipping issue
was corrected and the save button verified inside the 844-pixel viewport. Preview
session 57250 (PID 21641) was confirmed live and intentionally terminated after QA;
local-state cleanup completed. TaskSpace 44 remains assigned to the overall goal,
locale restored to English and device metrics override cleared. Do not finish the
space until the full goal succeeds.

Remaining original-goal work:
- Complete the actual bundled third-party license notices and release provenance.
- Add the explicit shared policy contract gate and private CI; current suites exercise
  both providers independently but that is not yet the literal shared-suite requirement.
- Audit the original HTML's 16 acceptance cases against source and scoped runtime
  evidence, including post-await races, hibernation recovery, migration cutover and
  all public/private artifact boundaries. Record missing evidence and close those gaps.
- Run final required build/deployment checks after the remaining changes, then mark
  checklist items only when their full scope is proven. The overall goal is not complete.

## Final checkpoint — shared contracts, distribution and acceptance

The original implementation checklist is complete within the explicit scope in
[implementation-verification.md](implementation-verification.md), including the 16
acceptance cases and migration/cutover ordering. Third-party notices now include 347
cross-platform JavaScript packages and 206 distinct license texts, exact versions and
source references; plugin and public artifact builds carry them. Build-tool binaries
that are not redistributed are excluded. The packer rebuilds the website and checks
archive boundaries; its route manifest no longer embeds the local checkout path.

Both providers run one shared policy contract. Private CI verifies hashes before
installation. The latest pinned core passed independent-copy frozen install, typecheck,
all 21 private tests and both Worker dry runs without a sibling checkout. Public
workspace typecheck, 20 bridge tests, the Hub contract, host-launcher/i18n checks,
plugin/website builds, both Worker dry runs and archive/source boundary checks pass.
New runtime evidence covers membership removal while authority verification is paused,
concurrent contenders for a final conversation seat, real workerd instance eviction
with a surviving WebSocket, and revocation/one-time shrink recovery. Cross-Hub testing
verifies that the first endpoint's credential is never sent to the second.

Browser QA reused TaskSpace 44 and the installed pinned website. Account and billing
navigation, loaded grace choices and the public dependency-notice asset passed. The
synthetic preview was stopped and temporary state removed after verification. No
remote deployment, migration, charge, commit, push or publication was performed.

The history export UI, Docker/Node runtime, device broker, MachineDO, per-agent JWT,
federation and periodic reminder emails remain outside this iteration; data retention
and the maximum cache window are explicit in the audit. These are not hidden promises
of the implemented service. Prices and plan limits remain deployment configuration.
