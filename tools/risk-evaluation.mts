#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedRegularFile, readBoundedRegularTextFile, decodeBoundedUtf8 } from '../lib/bounded-file.mts';
import { parseBoundedJsonObject } from '../lib/bounded-json.mts';
import { canonicalRegistrableDomain } from '../lib/registrable-domain.mts';
import { explainRiskScore, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';
import { extractBoundedZipEntries } from '../packages/interchange/bounded-zip-extraction.mts';
import { RISK_CALIBRATION_DATASET_SCHEMA, RISK_CALIBRATION_DATASET_VERSION } from '../packages/contracts/risk-calibration.mts';
import { buildRiskCalibrationReport, parseRiskCalibrationDataset } from '../cli/risk-calibration.mts';
import { buildRiskCalibrationSummaryReport } from '../lib/risk-calibration-summary.mts';

export const EVALUATION_SOURCE = Object.freeze({
  title: 'PhiUSIIL Phishing URL (Website)',
  authors: ['Arvind Prasad', 'Shalini Chandra'],
  year: 2024,
  reference: 'https://archive.ics.uci.edu/dataset/967/phiusiil+phishing+url+dataset',
  citation: 'https://doi.org/10.1016/j.cose.2023.103545',
  licence: 'CC-BY-4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  archiveUrl: 'https://archive.ics.uci.edu/static/public/967/phiusiil%2Bphishing%2Burl%2Bdataset.zip',
  archiveSha256: '0a639fd03aea6308c5b1c10c92aa23c2ce1505447a9137271865cd0badc9a59a',
  csvSha256: 'a236549cd369cd80bd478ff8e1779cbf44c58d5c3f79f7a51a1adbed7d06d1c6',
});

export const EVALUATION_LIMITATIONS = Object.freeze([
  'Labels are the historical source dataset classifications, not current analyst findings.',
  'Domains are reserved placeholders. Source URLs, titles and page bodies are omitted.',
  'Source collection times, current registration, ownership and same-form linkage are unknown.',
  'This feature-reduced, deliberately stratified sample is not a population accuracy benchmark.',
]);

const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_CSV_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_ROWS = 250_000;
const ROWS_PER_STRATUM = 8;
const CSV_NAME = 'PhiUSIIL_Phishing_URL_Dataset.csv';
const FIXTURE = new URL('../fixtures/risk-evaluation/rows.json', import.meta.url);
const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

type SourceRow = Readonly<{
  sourceRow: number;
  domainGroup: string;
  split: 'development' | 'evaluation';
  label: 0 | 1;
  passwordField: boolean;
  externalFormSubmit: boolean;
}>;

// A row iterator keeps unused URL/title columns transient. Bounds apply before
// field/row accumulation; quoted commas, quotes and line breaks remain data.
export function* evaluationCsvRows(text: string): Generator<string[]> {
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES || text.includes('\0')) throw new Error('Invalid evaluation CSV size or encoding.');
  let row: string[] = [], field = '', quoted = false, closed = false, count = 0;
  const append = (value: string): void => {
    if (field.length + value.length > 65_536) throw new Error('Evaluation CSV field is too large.');
    field += value;
  };
  const finish = (): void => {
    if (row.length >= 64) throw new Error('Evaluation CSV has too many columns.');
    row.push(field); field = ''; closed = false;
  };
  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { append('"'); index += 1; }
      else if (char === '"') { quoted = false; closed = true; }
      else append(char);
    } else if (char === ',') finish();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      finish();
      if (++count > MAX_SOURCE_ROWS + 1) throw new Error('Evaluation CSV has too many rows.');
      yield row; row = [];
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error('Invalid evaluation CSV quoting.');
      append(char);
    }
  }
  if (quoted) throw new Error('Unterminated evaluation CSV field.');
  if (field || closed || row.length) {
    finish();
    if (++count > MAX_SOURCE_ROWS + 1) throw new Error('Evaluation CSV has too many rows.');
    yield row;
  }
}

const bucket = (row: SourceRow): string => `${row.split}:${row.label}:${Number(row.passwordField)}:${Number(row.externalFormSubmit)}`;
const priority = (row: SourceRow): string => sha256(`row:${row.sourceRow}`);
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export function curateEvaluationCsv(text: string) {
  const iterator = evaluationCsvRows(text);
  const header = iterator.next().value as string[] | undefined;
  if (!header || new Set(header).size !== header.length) throw new Error('Invalid evaluation CSV header.');
  const required = ['URL', 'label', 'HasPasswordField', 'HasExternalFormSubmit'];
  const indices = required.map(name => header.indexOf(name));
  if (indices.includes(-1)) throw new Error('Evaluation CSV is missing a required column.');
  const groups = new Map<string, SourceRow>();
  const groupLabels = new Map<string, number>();
  const population: Record<string, number> = {};
  let sourceRows = 0, invalidUrls = 0;
  for (const values of iterator) {
    sourceRows += 1;
    if (values.length !== header.length) throw new Error(`Evaluation row ${sourceRows} has the wrong column count.`);
    const [url, label, password, external] = indices.map(index => values[index]!);
    if (![label, password, external].every(value => value === '0' || value === '1')) throw new Error(`Evaluation row ${sourceRows} has invalid boolean/label values.`);
    let hostname: string;
    try {
      const parsed = new URL(url!);
      if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname) throw new Error();
      hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
    } catch { invalidUrls += 1; continue; }
    // One registrable-domain group per split, including all its subdomains.
    // Unknown suffixes and numeric hosts still use their exact normalised host.
    const domainGroup = sha256(canonicalRegistrableDomain(hostname) ?? hostname);
    const row: SourceRow = {
      sourceRow: sourceRows, domainGroup,
      split: parseInt(domainGroup.slice(0, 2), 16) < 128 ? 'development' : 'evaluation',
      label: label === '0' ? 0 : 1,
      passwordField: password === '1', externalFormSubmit: external === '1',
    };
    const stratum = bucket(row);
    population[stratum] = (population[stratum] ?? 0) + 1;
    groupLabels.set(domainGroup, (groupLabels.get(domainGroup) ?? 0) | (row.label === 0 ? 1 : 2));
    const previous = groups.get(domainGroup);
    if (!previous || priority(row) < priority(previous)) groups.set(domainGroup, row);
  }
  const strata = new Map<string, SourceRow[]>();
  for (const row of groups.values()) {
    const key = bucket(row);
    const candidates = strata.get(key) ?? [];
    candidates.push(row); strata.set(key, candidates);
  }
  const rows = [...strata.entries()].sort(([a], [b]) => compare(a, b))
    .flatMap(([, entries]) => entries.sort((a, b) => compare(priority(a), priority(b))).slice(0, ROWS_PER_STRATUM));
  return { source: EVALUATION_SOURCE, sourceRows, invalidUrls, domainGroups: groups.size,
    mixedLabelDomainGroups: [...groupLabels.values()].filter(labels => labels === 3).length, population, rows };
}

export async function curateEvaluationArchive(filename: string) {
  const bytes = await readBoundedRegularFile(filename, { maximumBytes: MAX_ARCHIVE_BYTES, label: 'Evaluation source archive' });
  if (sha256(bytes) !== EVALUATION_SOURCE.archiveSha256) throw new Error('Evaluation source archive does not match the reviewed digest.');
  const { files } = extractBoundedZipEntries(bytes, {
    maximumEntries: 1, maximumSelectedBytes: MAX_CSV_BYTES,
    selectedBytesExceededMessage: 'Evaluation CSV is too large.', metadataMismatchMessage: 'Invalid evaluation ZIP metadata.',
    keyForName: name => name,
    inspect(entry, metadata) {
      if (entry.name !== CSV_NAME || ['special', 'directory'].includes(metadata.kind)) throw new Error('Unexpected evaluation archive entry.');
      return { key: entry.name, selected: true, maximumBytes: MAX_CSV_BYTES, exceededMessage: 'Evaluation CSV is too large.' };
    },
  });
  const csv = files.get(CSV_NAME);
  if (!csv || sha256(csv) !== EVALUATION_SOURCE.csvSha256) throw new Error('Evaluation CSV does not match the reviewed digest.');
  return curateEvaluationCsv(decodeBoundedUtf8(csv, 'Evaluation CSV'));
}

export function evaluationDataset(rows: readonly SourceRow[], split: SourceRow['split']) {
  return parseRiskCalibrationDataset(JSON.stringify({
    schema: RISK_CALIBRATION_DATASET_SCHEMA, version: RISK_CALIBRATION_DATASET_VERSION,
    records: rows.filter(row => row.split === split).map(row => ({
      id: `uci-967-row-${row.sourceRow}`, domain: `row-${row.sourceRow}.example.test`,
      analystDisposition: row.label === 0 ? 'confirmed_abuse' : 'false_positive',
      // Independent page-wide flags do not establish that a password form
      // submits externally. No inferred registration or linked form is added.
      evidence: { availability: 'unknown', hasPasswordField: row.passwordField },
    })),
    limitations: EVALUATION_LIMITATIONS,
  }));
}

export function parseEvaluationRows(text: string): SourceRow[] {
  const corpus = parseBoundedJsonObject(text, { maximumBytes: 128 * 1024, label: 'Evaluation fixture',
    limits: { maximumDepth: 5, maximumContainerItems: 128, maximumKeys: 2_000, maximumValues: 3_000 } });
  if (!corpus || typeof corpus !== 'object' || !Array.isArray(corpus.rows) || !corpus.rows.length || corpus.rows.length > 128) throw new Error('Invalid evaluation rows.');
  const seenRows = new Set<number>(), seenGroups = new Set<string>();
  return corpus.rows.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid evaluation row.');
    const row = value as Record<string, unknown>;
    if (Object.keys(row).sort().join(',') !== 'domainGroup,externalFormSubmit,label,passwordField,sourceRow,split'
      || !Number.isSafeInteger(row.sourceRow) || Number(row.sourceRow) < 1 || Number(row.sourceRow) > MAX_SOURCE_ROWS
      || typeof row.domainGroup !== 'string' || !/^[a-f0-9]{64}$/u.test(row.domainGroup)
      || !['development', 'evaluation'].includes(String(row.split))
      || (parseInt(row.domainGroup.slice(0, 2), 16) < 128 ? 'development' : 'evaluation') !== row.split
      || (row.label !== 0 && row.label !== 1)
      || typeof row.passwordField !== 'boolean' || typeof row.externalFormSubmit !== 'boolean'
      || seenRows.has(Number(row.sourceRow)) || seenGroups.has(row.domainGroup)) throw new Error('Invalid or repeated evaluation row.');
    seenRows.add(Number(row.sourceRow)); seenGroups.add(row.domainGroup);
    return row as SourceRow;
  });
}

export function evaluationReports(rows: readonly SourceRow[], generatedAt = new Date().toISOString()) {
  return (['development', 'evaluation'] as const).map(split => {
    const selected = rows.filter(row => row.split === split);
    const calibration = buildRiskCalibrationReport(evaluationDataset(rows, split), explainRiskScore, {
      modelVersion: RISK_MODEL_VERSION, reviewThreshold: RISK_REVIEW_THRESHOLD,
      generatedAt,
    });
    const summary = buildRiskCalibrationSummaryReport(calibration);
    const included = summary.summary.positive + summary.summary.negative;
    const withheld = summary.summary.scoreBands.not_scored;
    return {
      split,
      coverage: {
        state: included === 0 ? 'not_evaluable' : included < selected.length ? 'partial' : 'evaluated',
        selectedRecords: selected.length,
        scoredRecords: selected.length - withheld,
        withheldRecords: withheld,
        includedLabels: included,
        excludedLabels: summary.summary.excluded,
        scoredFraction: selected.length ? (selected.length - withheld) / selected.length : null,
        unknownEvidence: {
          registration: selected.length,
          observationTime: selected.length,
          currentDisposition: selected.length,
          sameFormLinkage: selected.length,
        },
      },
      sourceLabels: { phishing: selected.filter(row => row.label === 0).length, legitimate: selected.filter(row => row.label === 1).length },
      featureOverlap: [false, true].flatMap(passwordField => [false, true].map(externalFormSubmit => ({
        passwordField, externalFormSubmit,
        phishing: selected.filter(row => row.label === 0 && row.passwordField === passwordField && row.externalFormSubmit === externalFormSubmit).length,
        legitimate: selected.filter(row => row.label === 1 && row.passwordField === passwordField && row.externalFormSubmit === externalFormSubmit).length,
      }))),
      calibration: summary,
    };
  });
}

async function main(args: string[]): Promise<void> {
  if (args[0] === '--curate' && args.length === 3) {
    const corpus = await curateEvaluationArchive(args[1]!);
    await writeFile(args[2]!, `${JSON.stringify(corpus, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    process.stdout.write(`Curated ${corpus.rows.length} examples without retaining source URLs or titles.\n`);
    return;
  }
  if (args.length) throw new Error('Usage: node tools/risk-evaluation.mts [--curate SOURCE.zip NEW-OUTPUT.json]');
  const rows = parseEvaluationRows(await readBoundedRegularTextFile(fileURLToPath(FIXTURE), { maximumBytes: 128 * 1024, label: 'Evaluation fixture' }));
  process.stdout.write(`${JSON.stringify({ source: EVALUATION_SOURCE, limitations: EVALUATION_LIMITATIONS, reports: evaluationReports(rows) }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(cause => {
    const detail = cause instanceof Error ? cause.message.replace(/[\u0000-\u001f\u007f]+/gu, ' ').slice(0, 300) : 'Unknown failure.';
    process.stderr.write(`Evaluation failed: ${detail}\n`);
    process.exitCode = 1;
  });
}
