# Release discipline

WHOISleuth uses Semantic Versioning for application releases. Release numbers
describe the application and CLI together; browser-store, export, diagnostics,
catalogue, scoring, and other evidence schemas keep their own explicit versions.

## Choose the increment

- **Patch** releases contain compatible fixes and maintenance changes.
- **Minor** releases add compatible features or meaningfully expand existing
  behavior.
- **Major** releases intentionally break a public API, CLI, archive, stored-data,
  or deployment contract and require an approved compatibility and migration
  plan.

A schema or scoring change does not automatically require a major application
release when the deployed compatibility boundary remains intact. It must still
bump its owning contract version, retain supported legacy readers, reject
unsupported future versions, and document migration or comparison behavior.

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
- the corresponding tag name would be `v<version>`.

The command does not create a tag, commit, release, deployment, or package.

Review schema compatibility whenever a release changes persisted or exported
evidence:

```bash
npm run schema:inventory
```

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
