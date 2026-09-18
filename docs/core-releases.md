# Core package releases

The private cloud installs exact registry versions of `@tandryio/protocol`,
`@tandryio/hub`, and `@tandryio/website`. They are published together by
**release npm core**, separately from client packages and the Git marketplace.

## Workflow

Run `.github/workflows/core-release.yml` on the source revision to release.
Choose a canonical version and `next` or `latest`; alpha versions use `next`.
Dry run is enabled by default. It validates the workspace and uploads the
three archives plus their source commit and SHA-512 integrity values.

The packing hook applies `CORE_RELEASE_VERSION` only to exported manifests
and dependencies between the three core packages. Source manifests stay
unchanged. Protocol and Hub ship TypeScript; the website ships built assets
and its Worker entry. The publisher writes protocol before Hub, then website.
Preflight checks all versions before any write, rejecting conflicting contents.
Identical packages from a partially completed release are skipped.

Configure an npm trusted publisher for each core package, using GitHub owner
`tandryio`, repository `tandry`, workflow `core-release.yml`, and allowing
`npm publish`. See [npm client releases](npm-releases.md#prepare) for the shared
OIDC requirements and first-package bootstrap process. The two workflows have
separate trusted publisher configurations.

## Local candidate

After installing dependencies and building the website:

```sh
RELEASE_VERSION=0.1.0-alpha.1 CORE_RELEASE_VERSION=0.1.0-alpha.1 NPM_GROUP=core node scripts/npm-release.mjs pack
RELEASE_VERSION=0.1.0-alpha.1 NPM_GROUP=core node scripts/npm-release.mjs dry-run
```

These commands do not publish. Candidate archives live in `.local/npm-core/`.
Actual publication requires a clean source revision and npm authorization.

## Cloud update order

1. Run public CI and validate candidate archives against the private composition.
2. Publish the three core packages and verify their registry versions.
3. Update all three exact versions in the private repository. Generate its
   registry lockfile with `pnpm install --ignore-pnpmfile`; never copy the local
   development lockfile into the repository.
4. Run `check:release`, a frozen installation, `check:release --installed`, and
   `check:standalone` before merging the cloud dependency update.
5. Deploy the private composition through its deployment workflow. A core npm
   publication itself never deploys the hosted service.
