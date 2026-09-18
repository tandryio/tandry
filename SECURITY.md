# Security reports

Please avoid publishing tokens, private messages, customer data or a working exploit
in a public issue. Use GitHub private vulnerability reporting for this repository when
it is available. If it is unavailable, open a minimal issue requesting a private
reporting contact without vulnerability details. Maintainers should enable a private
reporting channel before a public release; no response-time commitment is implied.

A useful report identifies the affected source revision, self-host/cloud deployment,
reproduction using synthetic accounts, expected authorization boundary and impact.
Do not test other people's rooms, accounts, billing or deployments without permission.

Core boundaries include account identity, shared-machine session revocation,
conversation isolation, room ownership, quota enforcement, trusted Worker-to-DO
metadata and provider failures. A room code is a locator, not an account credential.

Self-host operators manage their own authentication secrets, provider credentials,
Cloudflare access, data backups and upgrades. Follow docs/self-hosting.md and each
release's schema ordering. Idle data retention is not a backup strategy.
