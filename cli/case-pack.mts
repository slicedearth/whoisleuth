import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import { canonicalArtifactJson } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import { buildCaseReport } from '../frontend/src/lib/analysis/case-report.ts';
import {
  CASE_IMPORT_VERSIONS,
  CASE_SCHEMA_VERSION,
  normalizeCaseStore,
  type CaseRecord,
} from '../frontend/src/lib/analysis/case-model.ts';
import { CliUsageError } from './errors.mts';

export const CLI_CASE_PACK_SCHEMA = 'whoisleuth.cli.case-pack';
export const CLI_CASE_PACK_VERSION = 1;
export const MAX_CASE_PACK_INPUT_BYTES = 4 * 1024 * 1024;
export type CasePackAudience = 'internal' | 'public' | 'trusted';

function redactedCase(record: CaseRecord, audience: CasePackAudience): CaseRecord {
  if (audience === 'internal') return structuredClone(record);
  return {
    ...structuredClone(record),
    notes: [],
    actions: audience === 'public' ? [] : record.actions.map((item) => ({ ...item, recipient: '[redacted]' })),
    manualTrail: record.manualTrail.map((item) => ({ ...item, target: null })),
    assertions: audience === 'public' ? [] : structuredClone(record.assertions),
  };
}

export function buildCliCasePack(
  input: string,
  options: Readonly<{ audience: CasePackAudience; reviewed: boolean }>,
  generatedAt = new Date().toISOString(),
) {
  if (!options.reviewed) throw new CliUsageError('case-pack requires --reviewed after the audience-specific output has been checked.');
  if (Buffer.byteLength(input, 'utf8') > MAX_CASE_PACK_INPUT_BYTES) throw new CliUsageError('Case-pack input is limited to 4 MiB.');
  let parsed: unknown;
  try { parsed = JSON.parse(input.replace(/^\uFEFF/u, '')); } catch { throw new CliUsageError('Case-pack input must be valid JSON.'); }
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  if (typeof root.version !== 'number' || !CASE_IMPORT_VERSIONS.includes(root.version as typeof CASE_IMPORT_VERSIONS[number]) || !Array.isArray(root.cases)) {
    throw new CliUsageError(`Case-pack input must be a supported WHOISleuth case export through schema ${CASE_SCHEMA_VERSION}.`);
  }
  const normalised = normalizeCaseStore(root).cases.slice(0, 25);
  if (!normalised.length) throw new CliUsageError('Case-pack input did not contain a valid case.');
  const cases = normalised.map((item) => redactedCase(item, options.audience));
  const reports = cases.map((item) => buildCaseReport(item, { includeNotes: false, generatedAt }).json);
  const exclusions = options.audience === 'internal'
    ? ['Raw upstream payloads and credentials are outside the case schema.']
    : options.audience === 'trusted'
      ? ['Case notes', 'Recipient values', 'Manual trail targets', 'Raw upstream payloads and credentials']
      : ['Case notes', 'Actions and recipient values', 'Analyst assertions', 'Manual trail targets', 'Raw upstream payloads and credentials'];
  const packet = Object.freeze({
    schema: CLI_CASE_PACK_SCHEMA,
    version: CLI_CASE_PACK_VERSION,
    audience: options.audience,
    reviewed: true,
    reports: Object.freeze(reports),
    redactionManifest: Object.freeze({ excluded: Object.freeze(exclusions), sourceCaseCount: normalised.length }),
    limitations: Object.freeze([
      'This local package is browser-importable through its top-level case collection and does not upload or submit evidence.',
      'The reviewed flag records a deliberate CLI choice; it does not prove recipient authorisation, factual correctness, or legal sufficiency.',
      'Importing the package does not restore fields excluded by its audience profile.',
    ]),
  });
  const unsigned = { version: CASE_SCHEMA_VERSION, exportedAt: generatedAt, cases, packet };
  return Object.freeze({
    ...unsigned,
    integrity: Object.freeze({
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v1',
      digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJson(unsigned)).digest('hex')}`,
    }),
  });
}

export function formatCliCasePack(document: ReturnType<typeof buildCliCasePack>): string {
  return [
    'Reviewed case pack',
    `Audience   ${document.packet.audience}`,
    `Cases      ${document.cases.length}`,
    `Reports    ${document.packet.reports.length}`,
    `Digest     ${document.integrity.digestSha256}`,
    '',
    ...document.packet.redactionManifest.excluded.map((item) => `Excluded: ${item}`),
    '',
  ].join('\n');
}
