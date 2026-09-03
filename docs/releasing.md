# Release discipline

WHOISleuth uses Semantic Versioning for application releases. Release numbers
describe the application and CLI together; browser-store, export, diagnostics,
catalogue, scoring, and other evidence schemas keep their own explicit versions.

## Choose the increment

- **Patch** releases contain compatible fixes and maintenance changes.
- **Minor** releases add compatible features or meaningfully expand existing
  behaviour.
- **Major** releases intentionally break a public API, CLI, archive, stored-data,
  or deployment contract and require an approved compatibility and migration
  plan.

A schema or scoring change does not automatically require a major application
release when the deployed compatibility boundary remains intact. It must still
bump its owning contract version, retain supported legacy readers, reject
unsupported future versions, and document migration or comparison behaviour.

## Prepare a release

Work on a focused branch and update the root manifest and lockfile together:

```bash
npm version minor --no-git-tag-version
npm run release:check
```

Use `patch`, `minor`, `major`, or an explicit valid semantic version as
appropriate. `release:check` is offline and read-only. It verifies that:

- `package.json`, `package-lock.json`, and the lockfile root package agree;
- the version is a valid semantic version without an in-manifest `v` prefix;
- the package remains private so npm cannot publish it accidentally; and
- the corresponding tag name would be `v<version>`; and
- an existing local tag with that name does not identify different application,
  CLI, runtime, packaged-support, dependency, or deployment inputs.

The identity check requires a non-shallow checkout with complete local tag
history. Documentation, tests, and maintainer tooling that are not shipped in
the application or CLI do not force a version change. Changes to a packaged CLI
guide do, because republishing different package bytes under an existing version
is not permitted.

The command does not create a tag, commit, release, deployment, or package.

The separately assembled CLI candidate follows the same application version but
does not make the root application package publishable. Before any CLI release,
run:

```bash
npm run cli:package:check
```

This compiles the executable's bounded dependency closure, audits the archive,
installs the exact tarball in a temporary directory, and exercises help,
version, and offline commands across eager and lazy module loading. The
generated manifest remains private.

An explicitly approved release candidate can be assembled outside the working
tree without performing a registry action:

```bash
VERSION="$(node -p "require('./package.json').version")"
npm run cli:package:release -- /tmp/whoisleuth-cli-release --tag "v${VERSION}" --json
```

Release assembly removes the private flag only from the generated archive,
pins direct runtime dependencies to the exact versions exercised by the
reviewed lockfile, adds public-access and provenance metadata, installs and
exercises every documented command help boundary, writes a SHA-256 digest, and
refuses a tag that does not match the root application version. Existing output
files are not overwritten.

Registry publication is deliberately separate from candidate assembly. The
CLI package is declared as [dual-use security
software](https://docs.npmjs.com/policies/dual-use/). The tagged release workflow
may submit only the exact reviewed archive through trusted publishing to npm
staging. Before assembly it requires a successful completed push run of the
full `ci.yml` workflow for the exact tagged commit; an ancestor commit's result
does not satisfy that release-provenance gate. The workflow must not use either token-based direct publication or a
direct OIDC publish path. A maintainer must inspect and approve the staged
version with interactive two-factor authentication before it becomes
available. Local assembly commands do not publish, configure credentials, or
approve a staged version.

After the approved version becomes public, verify the exact registry artefact:

```bash
VERSION="$(node -p "require('./package.json').version")"
npm run cli:package:verify-published -- "$VERSION" \
  --candidate-report /tmp/whoisleuth-cli-release/cli-package-report.json \
  --candidate-archive "/tmp/whoisleuth-cli-release/whoisleuth-cli-${VERSION}.tgz"
```

The post-publication check reads bounded metadata and archive bytes from the
public registry under a 120-second deadline for each complete response,
including streamed body reads. It verifies the registry SHA-512 and SHA-1
metadata, retains the raw candidate and registry gzip digests separately, and
requires the decompressed tar payload to be byte-identical to the explicitly
selected reviewed candidate. npm staging may recompress the gzip envelope
without changing that tar payload. The check also binds package measurements,
exact dependency pins, and source metadata. Registry signature and SLSA
provenance records are reported as observed metadata; this check does not
independently verify their cryptography. It never installs or executes the
published package and does not inherit npm credentials. The manual workflow
requires both the version and the release-workflow run ID so it downloads the
reviewed candidate artifact rather than reconstructing one. Run it only after
registry publication; an unavailable, still-staged, or non-identical tar
payload fails.
The reviewed candidate is retained for 7 days. Protected approval, npm
promotion, and post-publication verification must finish while that exact
artifact remains available; after expiry, assemble and review a fresh
candidate instead of reconstructing the prior archive.

Review schema compatibility whenever a release changes persisted or exported
evidence:

```bash
npm run schema:inventory
```

This gate also reconciles the bounded production-source scan with canonical
owners, intentional multi-profile contracts, and the finite non-schema or
nested-identifier classifications. A new local schema-like identifier cannot
remain outside the compatibility decision simply because it was added outside
the CLI or maintainer-tool directories.

Then run the complete verification sequence from the
[getting-started guide](getting-started.md#verification). Record exact checks
and totals in the commit and pull-request evidence.

## Merge, tag, and roll back

Merge releases through a reviewed pull request after protected-branch checks
pass. Do not tag an unverified feature-branch commit. Once the protected
`main` commit and its production deployment are verified, create the matching
`v<version>` tag on that exact commit.

Tagging, publishing, and deployment remain deliberate operator actions. No
release command in this repository performs them automatically.

Before tagging, retain:

- the verified commit and deployment identifier;
- the previous verified version;
- schema and migration consequences;
- any required environment or deployment change; and
- the rollback target and post-rollback data compatibility.

Rollback should select a previously verified deployment or tag. Do not restore
an older application over newer persisted data unless its readers explicitly
support those schema versions. If compatibility is uncertain, stop writes,
export or back up the current local and hosted state, and resolve the migration
path before rollback.
