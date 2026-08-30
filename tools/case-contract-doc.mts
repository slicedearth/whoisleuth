#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CASE_BROWSER_SUPPORTED_VERSIONS,
  CASE_PORTABILITY_LIFECYCLE_FAMILY,
  CASE_REPORT_OUTPUT_VERSIONS,
  CASE_RESPONSE_PACKET_OUTPUT_VERSIONS,
  CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  CLI_CASE_PACK_CASE_REPORT_EPOCHS,
  SUPPORTED_CLI_CASE_PACK_VERSIONS,
  SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
} from '../packages/contracts/case-portability.mts';
import { WHOISLEUTH_APPLICATION_VERSION } from '../lib/application-version.mts';

const DISPLAY_NAMES = Object.freeze({
  'browser.cases': 'Browser-local Cases',
  'export.cases': 'Portable Case export',
  'export.case-report': 'Case report',
  'export.case-response-packet': 'Case-response packet',
  'derived.case-response-review-inputs': 'Review-input digest material',
  'export.cli-case-pack': 'CLI Case-pack',
  'export.workspace-archive': 'Workspace archive',
  'export.workspace-settings-section': 'Workspace settings section',
  'export.encrypted-workspace-archive': 'Encrypted workspace archive',
} as const);

function versions(values: readonly number[]): string {
  return values.length ? values.join(', ') : '—';
}

function code(value: string): string {
  return `\`${value.replaceAll('`', '\\`')}\``;
}

export function buildCaseContractDocumentation(): string {
  const family = CASE_PORTABILITY_LIFECYCLE_FAMILY;
  const rows = family.compatibility.map((descriptor) => {
    const contracts = family.contracts.filter((contract) => contract.compatibilityId === descriptor.id);
    const schemas = [...new Set(contracts.map((contract) => contract.schema))];
    const readable = contracts.filter((contract) => contract.readable).map((contract) => contract.version);
    const writers = contracts.filter((contract) => contract.emitted).map((contract) => contract.version);
    return `| ${DISPLAY_NAMES[descriptor.id as keyof typeof DISPLAY_NAMES]} | ${schemas.map(code).join('<br>')} | ${versions(descriptor.supportedVersions)} | ${versions(readable)} | ${versions(writers)} | ${code(descriptor.futureVersionBehavior)} | ${code(descriptor.migration)} |`;
  });
  const epochs = CLI_CASE_PACK_CASE_REPORT_EPOCHS.map((epoch) => (
    `| ${versions(epoch.caseVersions)} | ${versions(epoch.reportVersions)} |`
  ));

  return `# Case portability contracts

This reference is generated from the canonical Case portability family in
${code('packages/contracts/case-portability.mts')}. Run
${code('node tools/case-contract-doc.mts')} to reproduce it. Runtime validators
remain statically imported; lifecycle module and export names are descriptive
metadata and are never executed dynamically.

## Supported versions

“Durable supported” is the public compatibility commitment. A
version is listed only when an exact reader or verifier and a matching frozen
fixture remain. Every writer emits only the version shown in “Current writer”.

| Contract | Canonical lifecycle schema | Durable supported | Readable | Current writer | Future version | Migration |
| --- | --- | ---: | ---: | ---: | --- | --- |
${rows.join('\n')}

Browser-local Case reading and portable Case import accept only schema
${versions(CASE_BROWSER_SUPPORTED_VERSIONS)}. Case reports write schema
${versions(CASE_REPORT_OUTPUT_VERSIONS)}; response packets write and verify only
schema ${versions(CASE_RESPONSE_PACKET_OUTPUT_VERSIONS)}. Review-input digest
material remains exact-current version ${CASE_RESPONSE_REVIEW_INPUTS_VERSION}.

## CLI Case/report epochs

The Case-pack verifier accepts the exact public Case/report epoch and the
current v2 epoch.

| Case versions | Matching report versions |
| ---: | ---: |
${epochs.join('\n')}

The durable CLI Case-pack envelope is version ${versions(SUPPORTED_CLI_CASE_PACK_VERSIONS)}.
The durable workspace archive envelope supports versions ${SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS.join(' and ')};
its embedded Case section consumes the supported Case contract shown above.
The encrypted workspace envelope remains version ${ENCRYPTED_WORKSPACE_ARCHIVE_VERSION}
and authenticates an ordinary workspace document without changing either the
workspace or embedded Case version.

## Public compatibility boundary

Release ${WHOISLEUTH_APPLICATION_VERSION} is the current public Case and workspace writer. It directly
preserves the formats written by public release 1.47.4:
browser and portable Case schema 12, Case report schema 8, response-packet schema 6,
CLI Case-pack schema 2 with its Case 12/report 8 epoch, workspace archive schema
5, workspace settings schema 1, and encrypted workspace archive schema 1.
Case schema 12 migrates directly to schema 13, response packet 6 verifies
directly alongside packet 7, and the public CLI epoch remains readable without
passing through an unreleased checkpoint.

Older formats accepted only by historical readers and formats produced only by
unreleased local checkpoints are outside the v2 compatibility boundary.
Unsupported and future inputs fail explicitly and non-destructively; they are
never reinterpreted as current, partially imported, or silently imported as an
empty collection. Browser-local future data remains preserved without write,
and no import path automatically deletes stored data.

## Durable compatibility evidence

The lifecycle family binds ${family.fixtures.length} immutable current-format
fixtures to exact byte counts and SHA-256 identities. The canonical JSON
commitment is
${code('docs/case-supported-contract-baseline-v1.json')}; it is derived from
lifecycle metadata and covers writers, readers, shapes, bounds, canonicalisation,
privacy projections, public facades, verifier dispatch, and rejection behaviour.
Its drift gate requires an explicit reviewed removal record, support window,
safe migration or export path, and updated fixtures and guidance before any
supported contract can disappear.

Malformed, oversized, ambiguous, unknown-key, and unsupported-future inputs
remain rejection cases. Browser-local future data is preserved by the storage
adapter without being rewritten; portable import and verifier paths reject
future versions. Every later release must preserve or migrate each contract in
the durable baseline.
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(buildCaseContractDocumentation());
}
