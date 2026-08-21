#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CASE_BROWSER_SUPPORTED_VERSIONS,
  CASE_IMPORT_VERSIONS,
  CASE_PORTABILITY_LIFECYCLE_FAMILY,
  CASE_REPORT_OUTPUT_VERSIONS,
  CASE_RESPONSE_PACKET_OUTPUT_VERSIONS,
  CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  CLI_CASE_PACK_CASE_REPORT_EPOCHS,
  SUPPORTED_CLI_CASE_PACK_VERSIONS,
  SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
} from '../packages/contracts/case-portability.mts';

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

“Retained history” records deployed or published shapes whose bytes remain
frozen. “Readable” means an exact reader or verifier and matching fixture are
retained now. A frozen output fixture alone does not make a historical format
readable. Every writer emits only the version shown in “Current writer”.

| Contract | Canonical lifecycle schema | Retained history | Readable | Current writer | Future version | Migration |
| --- | --- | ---: | ---: | ---: | --- | --- |
${rows.join('\n')}

Browser-local unversioned legacy input has its own frozen normalisation result.
The versioned browser reader retains versions ${versions(CASE_BROWSER_SUPPORTED_VERSIONS)};
portable Case import retains versions ${versions(CASE_IMPORT_VERSIONS)}. Case
report versions ${versions(CASE_REPORT_OUTPUT_VERSIONS)} are output history and
are not described as readable. Response-packet output history covers versions
${versions(CASE_RESPONSE_PACKET_OUTPUT_VERSIONS)}, while the table lists only
the versions with exact current verification as readable. Review-input digest
material is exact-current version ${CASE_RESPONSE_REVIEW_INPUTS_VERSION}.

## CLI Case/report epochs

The Case-pack verifier selects the report shape from the retained Case epoch;
it never applies the current report shape to a historical Case.

| Case versions | Matching report versions |
| ---: | ---: |
${epochs.join('\n')}

CLI Case-pack envelope history is ${versions(SUPPORTED_CLI_CASE_PACK_VERSIONS)}.
Workspace archive envelope history is ${versions(SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS)};
its embedded Case section retains the independent Case versions shown above.
The encrypted workspace envelope remains version ${ENCRYPTED_WORKSPACE_ARCHIVE_VERSION}
and authenticates an ordinary workspace document without changing either the
workspace or embedded Case version.

## Frozen compatibility evidence

The lifecycle family binds ${family.fixtures.length} immutable fixture documents
to exact byte counts and SHA-256 identities. The set covers browser-local Case
history and unversioned legacy input, portable Case migration outputs, report
output history, structurally and cryptographically verifiable response packets,
both CLI Case-pack epochs, every readable workspace envelope, the bounded
workspace-settings section, and the encrypted workspace envelope. Historical
fixtures are retained bytes; they are never
regenerated from a current writer.

Malformed, oversized, ambiguous, unknown-key, and unsupported-future inputs
remain rejection cases. Browser-local future data is preserved by the storage
adapter without being rewritten; portable import and verifier paths reject
future versions.
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(buildCaseContractDocumentation());
}
