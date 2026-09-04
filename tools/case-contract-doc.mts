#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CASE_BROWSER_SUPPORTED_VERSIONS,
  CASE_PORTABILITY_LIFECYCLE_FAMILY,
  CASE_REPORT_OUTPUT_VERSIONS,
  CASE_RESPONSE_PACKET_OUTPUT_VERSIONS,
  CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  PUBLISHED_V2_CASE_REPORT_SCHEMA_VERSION,
  PUBLISHED_V2_CASE_RESPONSE_PACKET_VERSION,
  PUBLISHED_V2_CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  PUBLISHED_V2_CASE_SCHEMA_VERSION,
  PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION,
  SUPPORTED_CASE_RESPONSE_REVIEW_INPUTS_VERSIONS,
  CLI_CASE_PACK_CASE_REPORT_EPOCHS,
  SUPPORTED_CLI_CASE_PACK_VERSIONS,
  SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
  LATEST_PUBLIC_APPLICATION_VERSION,
  LATEST_PUBLIC_CASE_SCHEMA_VERSION,
  LATEST_PUBLIC_CASE_REPORT_SCHEMA_VERSION,
  LATEST_PUBLIC_CASE_RESPONSE_PACKET_VERSION,
  LATEST_PUBLIC_CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  LATEST_PUBLIC_WORKSPACE_ARCHIVE_VERSION,
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

function proseVersions(values: readonly number[]): string {
  if (values.length < 2) return versions(values);
  return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
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
${versions(CASE_BROWSER_SUPPORTED_VERSIONS)}. The current writers emit Case report
schema ${CASE_REPORT_OUTPUT_VERSIONS.at(-1)} and response-packet schema
${CASE_RESPONSE_PACKET_OUTPUT_VERSIONS.at(-1)}; the compatible output epochs are
listed above. Response-packet verification accepts schema
${versions(CASE_RESPONSE_PACKET_OUTPUT_VERSIONS)}. Review-input digest material
accepts exact versions ${versions(SUPPORTED_CASE_RESPONSE_REVIEW_INPUTS_VERSIONS)}
and the current writer emits version ${CASE_RESPONSE_REVIEW_INPUTS_VERSION}.

## CLI Case/report epochs

The Case-pack verifier accepts the exact public v1, published v2, and current
Case/report epochs.

| Case versions | Matching report versions |
| ---: | ---: |
${epochs.join('\n')}

The durable CLI Case-pack envelope is version ${versions(SUPPORTED_CLI_CASE_PACK_VERSIONS)}.
The durable workspace archive envelope supports versions ${proseVersions(SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS)};
its embedded Case section consumes the supported Case contract shown above.
The encrypted workspace envelope remains version ${ENCRYPTED_WORKSPACE_ARCHIVE_VERSION}
and authenticates an ordinary workspace document without changing either the
workspace or embedded Case version.

## Public compatibility boundary

Release ${LATEST_PUBLIC_APPLICATION_VERSION} is the immediately preceding public writer. It emitted
Case schema ${LATEST_PUBLIC_CASE_SCHEMA_VERSION}, Case report schema ${LATEST_PUBLIC_CASE_REPORT_SCHEMA_VERSION}, response-packet schema
${LATEST_PUBLIC_CASE_RESPONSE_PACKET_VERSION}, review-input digest material version ${LATEST_PUBLIC_CASE_RESPONSE_REVIEW_INPUTS_VERSION}, and workspace
archive schema ${LATEST_PUBLIC_WORKSPACE_ARCHIVE_VERSION}. Version ${WHOISLEUTH_APPLICATION_VERSION} is the current writer in this
checkout. It emits Case schema ${CASE_BROWSER_SUPPORTED_VERSIONS.at(-1)}, report schema ${CASE_REPORT_OUTPUT_VERSIONS.at(-1)},
response-packet schema ${CASE_RESPONSE_PACKET_OUTPUT_VERSIONS.at(-1)}, review-input version ${CASE_RESPONSE_REVIEW_INPUTS_VERSION}, and workspace
archive schema ${SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS.at(-1)}.

Both the latest public formats and the current writers directly preserve the
formats written by public release 1.47.4:
browser and portable Case schema 12, Case report schema 8, response-packet schema 6,
CLI Case-pack schema 2 with its Case 12/report 8 epoch, workspace archive schema
5, workspace settings schema 1, and encrypted workspace archive schema 1.
Case schemas 12 and ${PUBLISHED_V2_CASE_SCHEMA_VERSION} migrate directly to schema
${CASE_BROWSER_SUPPORTED_VERSIONS.at(-1)}; response packets 6 and
${PUBLISHED_V2_CASE_RESPONSE_PACKET_VERSION} verify alongside packet
${CASE_RESPONSE_PACKET_OUTPUT_VERSIONS.at(-1)}. Every declared CLI epoch remains
readable without passing through an unreleased checkpoint.

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
