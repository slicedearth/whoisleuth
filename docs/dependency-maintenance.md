# Dependency Maintenance and SBOM Export

WHOISleuth keeps dependency updates reviewable and uses the repository
dependency graph as the default software-bill-of-materials source.

## Update automation

`.github/dependabot.yml` checks the root npm workspace and pinned workflow
actions monthly. It groups production and development packages separately,
groups workflow-action updates, limits the number of simultaneous pull
requests, and waits before proposing newly released versions.

Dependabot opens reviewable pull requests only. It has no auto-merge rule and
does not bypass branch protection, required checks, or human review. Security
updates are not delayed by the version-update cooldown.

Before accepting an update:

1. Review the release notes and licence or terms changes.
2. Confirm the package remains necessary and stays in the correct dependency
   class.
3. Run the complete verification sequence from
   [Getting started](getting-started.md#verification).
4. Check the production dependency notice and lockfile diffs.
5. Merge only after every required check completes without failed or flaky
   tests.

The existing pinned action references, lockfile, reviewed production audit,
CodeQL, architecture check, and generated production notices remain
independent controls. Dependabot does not amend or auto-merge them.

Pull requests also run the pinned GitHub Dependency Review action. It compares
manifest and lockfile changes with the base branch and blocks newly introduced
vulnerabilities of moderate severity or higher. The workflow has read-only
repository permissions and does not replace the complete locked install or
reviewed production dependency audit.

## Production audit exception policy

`npm run dependencies:audit` runs `npm audit --omit=dev --json` with a 60-second
timeout, prints the raw audit JSON for review, and then applies the repository's
exact advisory policy.
It does not use `--audit-level` or a numeric vulnerability threshold. An
unlisted advisory at any severity blocks the command, so every new high or
critical production advisory remains blocking even when npm reports it through
another affected package node.

The exception reviewed on 2026-08-10 covers exactly these high-severity
advisory IDs:

- `GHSA-w3rx-r6r6-pgpr`
- `GHSA-5p2g-fcmc-qvqq`

Both advisories affect `image-size` 2.0.2 through the locked chain
`@netlify/blobs` 10.7.9 → `@netlify/dev-utils` 4.4.6 → `image-size` 2.0.2. npm
therefore reports three vulnerable package entries but two advisory IDs. npm
currently reports no fix in the production dependency graph. WHOISleuth's
production sources import `getStore` from the `@netlify/blobs` package root;
they do not import its `./server` export that exposes the image-parser path.
That reachability distinction reduces current exposure but does not remove the
dependency advisory or justify suppressing npm's raw report.

The exception expires at `2026-09-10T00:00:00.000Z`. While an affected advisory
is present, the gate fails closed after that instant. It also fails closed for
malformed, oversized, unsupported, or internally inconsistent audit JSON; an
unlisted, missing, or duplicated advisory record; changed advisory URL, source,
severity, or affected range; changed fix availability or package-chain
metadata; and any change to the reviewed locked versions or dependency edges.
A clean production audit passes without relying on the expired exception.

Re-review before the expiry, and immediately when any of the following occurs:

- npm publishes a fix or changes either advisory's severity, range, or identity;
- the lockfile changes any package or edge in the reviewed chain;
- production code begins importing `@netlify/blobs/server`, another server
  subpath, or otherwise reaches the affected image parsers; or
- build or deployment changes alter which package exports are bundled or run.

Re-review requires updating the explicit policy and its fixture-driven tests;
do not replace it with an advisory-count allowance or a blanket severity
suppression. The command exits 0 only for a clean audit or an exact, current
reviewed match; policy mismatches exit 1, and audit execution or lockfile-read
failures exit 2.

Published CLI releases have a separate exact-version check documented in the
[release guide](releasing.md). It verifies registry integrity and exact byte
identity against the explicitly selected reviewed candidate after publication.
Registry signature and provenance records are surfaced as metadata, not
reported as cryptographically verified by this check.

## SPDX export

GitHub derives an SPDX 2.3 compatible SBOM from the repository dependency
graph. A user with repository read access can download it from the dependency
graph page or request it through the read-only REST endpoint:

```text
GET /repos/OWNER/REPOSITORY/dependency-graph/sbom
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
```

With an authenticated GitHub CLI session, a reviewer can inspect the response
without adding a workflow, package, repository secret, or stored artefact:

```bash
gh api \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/OWNER/REPOSITORY/dependency-graph/sbom
```

The export reflects GitHub's current dependency graph, not a byte-for-byte
inventory of a deployed bundle. Retain the lockfile, production dependency
notice, build output checks, and deployment record when exact release evidence
is required. Add another SBOM format or generator only when a specific consumer
cannot accept the built-in SPDX export.
