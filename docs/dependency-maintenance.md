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

The existing pinned action references, lockfile, production audit, CodeQL,
architecture check, and generated production notices remain independent
controls. Dependabot does not amend or auto-merge them.

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
without adding a workflow, package, repository secret, or stored artifact:

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
