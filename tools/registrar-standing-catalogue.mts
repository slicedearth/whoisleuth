#!/usr/bin/env node

// Maintains the small, checked-in projection used for zero-request registrar
// standing context. Runtime Lookup never calls these sources. The scheduled
// audit fetches each fixed official endpoint once, applies strict bounds, and
// reports drift for manual review rather than changing the repository.

import { createHash, randomUUID } from 'node:crypto';
import { realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { readTextCapped, safeFetchDetailed } from '../lib/safe-fetch.mts';
import {
  canonicalControlFreeTimestamp,
  pathIsWithin,
} from './maintainer-tool-helpers.mts';
import {
  ICANN_COMPLIANCE_SOURCE_URL,
  IANA_REGISTRAR_SOURCE_URL,
  MAX_REGISTRAR_STANDING_CATALOGUE_BYTES,
  REGISTRAR_STANDING_AUDIT_SCHEMA,
  REGISTRAR_STANDING_AUDIT_VERSION,
  REGISTRAR_STANDING_CATALOGUE_SCHEMA,
  REGISTRAR_STANDING_CATALOGUE_VERSION,
  REGISTRAR_STANDING_MAX_AGE_DAYS,
  REGISTRAR_STANDING_MAX_FUTURE_SKEW_MS,
  registrarStandingOfficialSourceUrl,
} from '../lib/registrar-standing-catalogue-contract.mts';
import { registrarStandingCatalogueHealth } from '../lib/registrar-standing.mts';

export const REGISTRAR_STANDING_OUTPUT_PATH = 'lib/generated/registrar-standing-catalogue.mts';
export const MAX_IANA_SOURCE_BYTES = 512 * 1024;
export const MAX_ICANN_SOURCE_BYTES = 512 * 1024;
export const MAX_REGISTRAR_ROWS = 10_000;
export const MAX_COMPLIANCE_NOTICES = 500;
export const MAX_NOTICE_OUTCOME_LENGTH = 240;
export const REGISTRAR_STANDING_REQUEST_TIMEOUT_MS = 8_000;
export const REGISTRAR_STANDING_TOTAL_TIMEOUT_MS = 18_000;

type RegistrarStatus = 'Accredited' | 'Reserved' | 'Terminated';
type RegistrarStatusCode = 'A' | 'R' | 'T';
type ComplianceActionType = 'breach' | 'non_renewal' | 'suspension' | 'termination';
type RegistrarRow = Readonly<{ id: number; status: RegistrarStatus }>;
type ComplianceNotice = Readonly<{
  noticeId: string;
  ianaId: number;
  type: ComplianceActionType;
  issuedOn: string;
  sourceUrl: string;
  indexOutcome: string | null;
}>;
type ParsedSources = Readonly<{
  registrarRows: readonly RegistrarRow[];
  notices: readonly ComplianceNotice[];
}>;
type SnapshotMetadata = Readonly<{
  generatedAt: string;
  ianaObservedAt: string;
  catalogueYear: number;
}>;
type CatalogueSnapshot = Readonly<{
  schema: typeof REGISTRAR_STANDING_CATALOGUE_SCHEMA;
  version: typeof REGISTRAR_STANDING_CATALOGUE_VERSION;
  generatedAt: string;
  iana: Readonly<{
    sourceUrl: typeof IANA_REGISTRAR_SOURCE_URL;
    observedAt: string;
    normalizedSha256: string;
    rows: number;
    counts: Readonly<Record<RegistrarStatus, number>>;
    encodedStatuses: string;
  }>;
  icann: Readonly<{
    sourceUrl: typeof ICANN_COMPLIANCE_SOURCE_URL;
    reviewedAt: string;
    catalogueYear: number;
    normalizedSha256: string;
    notices: readonly ComplianceNotice[];
  }>;
}>;
type HtmlAttribute = { name: string; value: string };
type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
};
type FetchSource = (url: string, init: RequestInit) => Promise<Response>;
type WritableLike = { write(value: string): unknown };
type MainOptions = Readonly<{
  repositoryRoot?: string;
  fetchSource?: FetchSource;
  snapshot?: CatalogueSnapshot;
  now?: () => Date;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

const STATUS_CODES: Readonly<Record<RegistrarStatus, RegistrarStatusCode>> = Object.freeze({
  Accredited: 'A',
  Reserved: 'R',
  Terminated: 'T',
});
const CSV_HEADERS = Object.freeze(['ID', 'Registrar Name', 'Status', 'RDAP Base URL']);
const SECTION_TYPES = Object.freeze([
  ['Termination', 'termination'],
  ['Suspension', 'suspension'],
  ['Breach', 'breach'],
  ['Non-Renewal', 'non_renewal'],
] as const);
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u;
const CONTROL_CHAR_GLOBAL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalTimestamp(value: unknown, label: string): string {
  return canonicalControlFreeTimestamp(value, label);
}

function boundedSourceText(value: unknown, maximumBytes: number, label: string): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximumBytes) {
    throw new RangeError(`${label} exceeded ${maximumBytes.toLocaleString('en')} bytes.`);
  }
  if (value.includes('\u0000')) throw new TypeError(`${label} contained a NUL byte.`);
  return value;
}

export function parseCsvRows(value: unknown): string[][] {
  const text = boundedSourceText(value, MAX_IANA_SOURCE_BYTES, 'The IANA registrar-ID CSV');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
      if (rows.length > MAX_REGISTRAR_ROWS + 1) {
        throw new RangeError(`The IANA registrar-ID CSV exceeded ${MAX_REGISTRAR_ROWS.toLocaleString('en')} records.`);
      }
    } else {
      field += character ?? '';
    }
  }
  if (quoted) throw new TypeError('The IANA registrar-ID CSV ended inside a quoted field.');
  row.push(field);
  if (row.some((item) => item.length > 0)) rows.push(row);
  return rows;
}

export function parseIanaRegistrarCsv(value: unknown): readonly RegistrarRow[] {
  const rows = parseCsvRows(value);
  if (rows.length < 2 || rows.length > MAX_REGISTRAR_ROWS + 1) {
    throw new RangeError('The IANA registrar-ID CSV did not contain a bounded non-empty catalogue.');
  }
  if (rows[0]?.length !== CSV_HEADERS.length
    || !CSV_HEADERS.every((header, index) => rows[0]?.[index] === header)) {
    throw new TypeError('The IANA registrar-ID CSV headers changed.');
  }
  const seen = new Set<number>();
  const result = rows.slice(1).map((row, index): RegistrarRow => {
    if (row.length !== CSV_HEADERS.length) throw new TypeError(`IANA registrar row ${index + 1} had an unexpected field count.`);
    const idText = row[0] ?? '';
    const name = row[1] ?? '';
    const status = row[2] ?? '';
    const rdapUrl = row[3] ?? '';
    if (!/^[1-9]\d{0,7}$/u.test(idText) || !name || name.length > 500 || CONTROL_CHAR_RE.test(name)) {
      throw new TypeError(`IANA registrar row ${index + 1} had an invalid ID or name.`);
    }
    if (!(status in STATUS_CODES)) throw new TypeError(`IANA registrar row ${index + 1} had an unsupported status.`);
    if (rdapUrl) {
      try {
        const parsed = new URL(rdapUrl);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
      } catch {
        throw new TypeError(`IANA registrar row ${index + 1} had an invalid RDAP URL.`);
      }
    }
    const id = Number(idText);
    if (seen.has(id)) throw new TypeError(`The IANA registrar-ID CSV repeated ID ${id}.`);
    seen.add(id);
    return Object.freeze({ id, status: status as RegistrarStatus });
  });
  return Object.freeze(result.sort((left, right) => left.id - right.id));
}

function attribute(node: HtmlNode, name: string): string | null {
  return node.attrs?.find((item) => item.name === name)?.value ?? null;
}

function hasClass(node: HtmlNode, name: string): boolean {
  return (attribute(node, 'class') ?? '').split(/\s+/u).includes(name);
}

function collectNodes(root: HtmlNode, predicate: (node: HtmlNode) => boolean, maximum = 200_000): HtmlNode[] {
  const matches: HtmlNode[] = [];
  const stack: HtmlNode[] = [root];
  let visited = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    visited += 1;
    if (visited > maximum) throw new RangeError('The ICANN notices document exceeded its bounded node count.');
    if (predicate(node)) matches.push(node);
    const children = node.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) stack.push(child);
    }
  }
  return matches;
}

function textContent(root: HtmlNode): string {
  const pieces = collectNodes(root, (node) => node.nodeName === '#text', 20_000)
    .map((node) => node.value ?? '');
  return pieces.join('')
    .replace(CONTROL_CHAR_GLOBAL_RE, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function canonicalNoticeUrl(value: string, noticeNumber: string): string {
  const resolved = registrarStandingOfficialSourceUrl(
    new URL(value, ICANN_COMPLIANCE_SOURCE_URL).href,
    'icann_notice',
    `notice-${noticeNumber}`,
  );
  if (!resolved) {
    throw new TypeError(`ICANN notice ${noticeNumber} had an unexpected source URL.`);
  }
  return resolved;
}

function canonicalNoticeDate(value: string): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/u.exec(value);
  if (!match) throw new TypeError('An ICANN notice had an invalid publication date.');
  const [, day, month, year] = match;
  const result = `${year}-${month}-${day}`;
  if (new Date(`${result}T00:00:00.000Z`).toISOString().slice(0, 10) !== result) {
    throw new TypeError('An ICANN notice had an impossible publication date.');
  }
  return result;
}

export function parseIcannComplianceNotices(value: unknown, catalogueYear: number): readonly ComplianceNotice[] {
  const text = boundedSourceText(value, MAX_ICANN_SOURCE_BYTES, 'The ICANN compliance-notices page');
  if (!Number.isInteger(catalogueYear) || catalogueYear < 2000 || catalogueYear > 9999) {
    throw new TypeError('The ICANN compliance catalogue year is invalid.');
  }
  const document = parse(text) as unknown as HtmlNode;
  const seen = new Set<string>();
  const notices: ComplianceNotice[] = [];
  for (const [sectionLabel, type] of SECTION_TYPES) {
    const sectionId = `${catalogueYear}-${sectionLabel}`;
    const sections = collectNodes(document, (node) => attribute(node, 'id') === sectionId);
    if (sections.length !== 1) throw new TypeError(`The ICANN notices page did not contain exactly one ${sectionId} section.`);
    const sectionNotices = collectNodes(sections[0]!, (node) => hasClass(node, 'compliance-notice'));
    for (const node of sectionNotices) {
      const rawNoticeId = attribute(node, 'id') ?? '';
      const noticeMatch = /^notice-([1-9]\d{0,7})$/u.exec(rawNoticeId);
      const issuedOn = canonicalNoticeDate(attribute(node, 'data-id') ?? '');
      const fullText = textContent(node);
      const ianaMatch = /\(IANA\s*#?\s*([1-9]\d{0,7})\)/iu.exec(fullText);
      const links = collectNodes(node, (child) => child.tagName === 'a' && typeof attribute(child, 'href') === 'string');
      if (!noticeMatch || !ianaMatch || links.length !== 1) throw new TypeError(`The ${sectionId} section contained a malformed registrar notice.`);
      if (seen.has(rawNoticeId)) throw new TypeError(`The ICANN notices page repeated ${rawNoticeId}.`);
      seen.add(rawNoticeId);
      const actionSpans = collectNodes(node, (child) => child.tagName === 'span' && hasClass(child, 'action'));
      if (actionSpans.length > 1) throw new TypeError(`${rawNoticeId} contained more than one outcome field.`);
      const outcome = actionSpans[0] ? textContent(actionSpans[0]) : '';
      if (outcome.length > MAX_NOTICE_OUTCOME_LENGTH) throw new RangeError(`${rawNoticeId} outcome exceeded its text limit.`);
      notices.push(Object.freeze({
        noticeId: rawNoticeId,
        ianaId: Number(ianaMatch[1]),
        type,
        issuedOn,
        sourceUrl: canonicalNoticeUrl(attribute(links[0]!, 'href') ?? '', noticeMatch[1]!),
        indexOutcome: outcome || null,
      }));
      if (notices.length > MAX_COMPLIANCE_NOTICES) {
        throw new RangeError(`The ICANN notices page exceeded ${MAX_COMPLIANCE_NOTICES} current-year records.`);
      }
    }
  }
  return Object.freeze(notices.sort((left, right) => (
    right.issuedOn.localeCompare(left.issuedOn) || right.noticeId.localeCompare(left.noticeId)
  )));
}

function normalizedRegistrarRows(rows: readonly RegistrarRow[]): string {
  return rows.map((row) => `${row.id}:${STATUS_CODES[row.status]}`).join(',');
}

function normalizedNotices(notices: readonly ComplianceNotice[]): string {
  return JSON.stringify(notices);
}

export function buildRegistrarStandingSnapshot(
  sources: ParsedSources,
  metadata: SnapshotMetadata,
): CatalogueSnapshot {
  const generatedAt = canonicalTimestamp(metadata.generatedAt, 'Snapshot generation time');
  const ianaObservedAt = canonicalTimestamp(metadata.ianaObservedAt, 'IANA observation time');
  if (!Number.isInteger(metadata.catalogueYear)
    || metadata.catalogueYear < 2000
    || metadata.catalogueYear > 9999) throw new TypeError('The catalogue year is invalid.');
  if (Date.parse(ianaObservedAt) > Date.parse(generatedAt)) {
    throw new TypeError('The IANA observation time cannot follow the snapshot generation time.');
  }
  if (sources.registrarRows.length < 1 || sources.registrarRows.length > MAX_REGISTRAR_ROWS
    || sources.notices.length > MAX_COMPLIANCE_NOTICES) {
    throw new RangeError('The registrar standing projection exceeded its item boundaries.');
  }
  let previousRegistrarId = 0;
  for (const row of sources.registrarRows) {
    if (!Number.isSafeInteger(row.id)
      || row.id <= previousRegistrarId
      || row.id > 99_999_999
      || !(row.status in STATUS_CODES)) {
      throw new TypeError('The registrar projection must contain unique, ascending bounded status records.');
    }
    previousRegistrarId = row.id;
  }
  const registrarIds = new Set(sources.registrarRows.map((row) => row.id));
  const noticeIds = new Set<string>();
  for (const [index, notice] of sources.notices.entries()) {
    const noticeTime = Date.parse(`${notice.issuedOn}T00:00:00.000Z`);
    if (noticeIds.has(notice.noticeId)
      || !registrarIds.has(notice.ianaId)
      || !/^notice-[1-9]\d{0,7}$/u.test(notice.noticeId)
      || !SECTION_TYPES.some(([, type]) => type === notice.type)
      || !/^\d{4}-\d{2}-\d{2}$/u.test(notice.issuedOn)
      || !Number.isFinite(noticeTime)
      || new Date(noticeTime).toISOString().slice(0, 10) !== notice.issuedOn
      || Number(notice.issuedOn.slice(0, 4)) !== metadata.catalogueYear
      || noticeTime > Date.parse(generatedAt)) {
      throw new TypeError('The compliance projection does not match the bounded registrar catalogue and year.');
    }
    if (canonicalNoticeUrl(notice.sourceUrl, notice.noticeId.slice('notice-'.length)) !== notice.sourceUrl
      || (notice.indexOutcome !== null
        && (!notice.indexOutcome
          || notice.indexOutcome.length > MAX_NOTICE_OUTCOME_LENGTH
          || CONTROL_CHAR_RE.test(notice.indexOutcome)))) {
      throw new TypeError('The compliance projection contains an invalid bounded source field.');
    }
    const previous = sources.notices[index - 1];
    if (previous
      && (previous.issuedOn < notice.issuedOn
        || (previous.issuedOn === notice.issuedOn && previous.noticeId < notice.noticeId))) {
      throw new TypeError('The compliance projection must use deterministic newest-first order.');
    }
    noticeIds.add(notice.noticeId);
  }
  const encodedStatuses = normalizedRegistrarRows(sources.registrarRows);
  const counts: Record<RegistrarStatus, number> = { Accredited: 0, Reserved: 0, Terminated: 0 };
  for (const row of sources.registrarRows) counts[row.status] += 1;
  return Object.freeze({
    schema: REGISTRAR_STANDING_CATALOGUE_SCHEMA,
    version: REGISTRAR_STANDING_CATALOGUE_VERSION,
    generatedAt,
    iana: Object.freeze({
      sourceUrl: IANA_REGISTRAR_SOURCE_URL,
      observedAt: ianaObservedAt,
      normalizedSha256: sha256(encodedStatuses),
      rows: sources.registrarRows.length,
      counts: Object.freeze(counts),
      encodedStatuses,
    }),
    icann: Object.freeze({
      sourceUrl: ICANN_COMPLIANCE_SOURCE_URL,
      reviewedAt: generatedAt,
      catalogueYear: metadata.catalogueYear,
      normalizedSha256: sha256(normalizedNotices(sources.notices)),
      notices: Object.freeze([...sources.notices]),
    }),
  });
}

export function renderRegistrarStandingCatalogue(snapshot: CatalogueSnapshot): string {
  const projection = {
    generatedAt: snapshot.generatedAt,
    iana: snapshot.iana,
    icann: snapshot.icann,
  };
  const output = `// Generated by tools/registrar-standing-catalogue.mts from bounded official-source projections.\n`
    + `// Do not edit by hand. Runtime Lookup performs no source request.\n\n`
    + `import { REGISTRAR_STANDING_CATALOGUE_SCHEMA, REGISTRAR_STANDING_CATALOGUE_VERSION } from '../registrar-standing-catalogue-contract.mts';\n\n`
    + `const REGISTRAR_STANDING_CATALOGUE = Object.freeze({\n`
    + `  schema: REGISTRAR_STANDING_CATALOGUE_SCHEMA,\n`
    + `  version: REGISTRAR_STANDING_CATALOGUE_VERSION,\n`
    + `  ...${JSON.stringify(projection, null, 2)},\n`
    + `});\n\n`
    + `export { REGISTRAR_STANDING_CATALOGUE };\n`;
  if (Buffer.byteLength(output, 'utf8') > MAX_REGISTRAR_STANDING_CATALOGUE_BYTES) {
    throw new RangeError('The generated registrar standing catalogue exceeded its byte limit.');
  }
  return output;
}

function parseArguments(args: readonly string[]): Readonly<{
  json: boolean;
  write: boolean;
  ianaSource: string | null;
  icannSource: string | null;
  observedAt: string | null;
}> {
  let json = false;
  let write = false;
  let ianaSource: string | null = null;
  let icannSource: string | null = null;
  let observedAt: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json' && !json) json = true;
    else if (argument === '--write' && !write) write = true;
    else if (argument === '--iana-source' && !ianaSource && args[index + 1]) ianaSource = args[++index] ?? null;
    else if (argument === '--icann-source' && !icannSource && args[index + 1]) icannSource = args[++index] ?? null;
    else if (argument === '--observed-at' && !observedAt && args[index + 1]) observedAt = args[++index] ?? null;
    else throw new TypeError('Usage: npm run registrar:standing:check -- [--json] OR npm run registrar:standing:update -- --iana-source <csv> --icann-source <html> --observed-at <ISO timestamp>');
  }
  if (write !== Boolean(ianaSource && icannSource && observedAt) || (write && json)) {
    throw new TypeError('Catalogue updates require --write, both source files, and --observed-at; audits accept only --json.');
  }
  if (!write && (ianaSource || icannSource || observedAt)) throw new TypeError('Local source paths are accepted only for an explicit catalogue update.');
  return { json, write, ianaSource, icannSource, observedAt };
}

async function fetchOfficialSource(
  url: string,
  maximumBytes: number,
  fetchSource: FetchSource,
  signal: AbortSignal,
): Promise<Readonly<{ text: string }>> {
  const detailed = fetchSource === fetch
    ? await safeFetchDetailed(url, { headers: { accept: 'text/html,text/csv;q=0.9,*/*;q=0.1' }, signal })
    : { response: await fetchSource(url, { headers: { accept: 'text/html,text/csv;q=0.9,*/*;q=0.1' }, signal }), finalUrl: url };
  if (detailed.finalUrl !== url || detailed.response.status !== 200) throw new Error(`${url} returned an unexpected endpoint or status.`);
  const body = await readTextCapped(detailed.response, maximumBytes, { fatalUtf8: true });
  if (body.truncated) throw new RangeError(`${url} exceeded its response byte limit.`);
  return Object.freeze({ text: body.text });
}

async function importedSnapshot(repositoryRoot: string): Promise<CatalogueSnapshot> {
  const moduleUrl = new URL(`../${REGISTRAR_STANDING_OUTPUT_PATH}?audit=${Date.now()}`, import.meta.url);
  if (path.resolve(repositoryRoot) !== path.resolve(fileURLToPath(new URL('..', import.meta.url)))) {
    throw new TypeError('Registrar standing audit requires the repository root.');
  }
  const module = await import(moduleUrl.href) as { REGISTRAR_STANDING_CATALOGUE?: CatalogueSnapshot };
  if (!module.REGISTRAR_STANDING_CATALOGUE) throw new TypeError('The generated registrar-standing catalogue is unavailable.');
  return module.REGISTRAR_STANDING_CATALOGUE;
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  try {
    const parsed = parseArguments(args);
    const repositoryRoot = await realpath(path.resolve(options.repositoryRoot ?? process.cwd()));
    const now = options.now?.() ?? new Date();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Audit time is invalid.');
    if (parsed.write) {
      const [ianaText, icannText] = await Promise.all([
        readBoundedRegularTextFile(path.resolve(repositoryRoot, parsed.ianaSource!), {
          minimumBytes: 1,
          maximumBytes: MAX_IANA_SOURCE_BYTES,
          label: 'IANA registrar-ID source',
        }),
        readBoundedRegularTextFile(path.resolve(repositoryRoot, parsed.icannSource!), {
          minimumBytes: 1,
          maximumBytes: MAX_ICANN_SOURCE_BYTES,
          label: 'ICANN compliance-notices source',
        }),
      ]);
      const observedAt = canonicalTimestamp(parsed.observedAt, 'Catalogue observation time');
      if (Date.parse(observedAt) > now.getTime() + REGISTRAR_STANDING_MAX_FUTURE_SKEW_MS) {
        throw new TypeError('Catalogue observation time is too far in the future.');
      }
      const catalogueYear = new Date(observedAt).getUTCFullYear();
      const snapshot = buildRegistrarStandingSnapshot({
        registrarRows: parseIanaRegistrarCsv(ianaText),
        notices: parseIcannComplianceNotices(icannText, catalogueYear),
      }, { generatedAt: observedAt, ianaObservedAt: observedAt, catalogueYear });
      const output = renderRegistrarStandingCatalogue(snapshot);
      const outputParent = await realpath(path.dirname(path.resolve(repositoryRoot, REGISTRAR_STANDING_OUTPUT_PATH)));
      if (!pathIsWithin(repositoryRoot, outputParent)) {
        throw new TypeError('Registrar standing output directory resolves outside the repository root.');
      }
      const outputPath = path.join(outputParent, path.basename(REGISTRAR_STANDING_OUTPUT_PATH));
      const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, output, { encoding: 'utf8', flag: 'wx' });
        await rename(temporaryPath, outputPath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
      stdout.write(`Wrote ${REGISTRAR_STANDING_OUTPUT_PATH}: ${snapshot.iana.rows} registrar IDs and ${snapshot.icann.notices.length} current-year notices.\n`);
      return 0;
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error('Registrar standing audit timed out.')), REGISTRAR_STANDING_TOTAL_TIMEOUT_MS);
    const fetchSource = options.fetchSource ?? fetch;
    let ianaSource: Awaited<ReturnType<typeof fetchOfficialSource>>;
    let icannSource: Awaited<ReturnType<typeof fetchOfficialSource>>;
    try {
      [ianaSource, icannSource] = await Promise.all([
        fetchOfficialSource(IANA_REGISTRAR_SOURCE_URL, MAX_IANA_SOURCE_BYTES, fetchSource, AbortSignal.any([
          abort.signal,
          AbortSignal.timeout(REGISTRAR_STANDING_REQUEST_TIMEOUT_MS),
        ])),
        fetchOfficialSource(ICANN_COMPLIANCE_SOURCE_URL, MAX_ICANN_SOURCE_BYTES, fetchSource, AbortSignal.any([
          abort.signal,
          AbortSignal.timeout(REGISTRAR_STANDING_REQUEST_TIMEOUT_MS),
        ])),
      ]);
    } finally {
      clearTimeout(timer);
    }
    const current = options.snapshot ?? await importedSnapshot(repositoryRoot);
    if (registrarStandingCatalogueHealth(now, current).state === 'unavailable') {
      throw new TypeError('The retained registrar standing catalogue failed its schema or digest checks.');
    }
    const rows = parseIanaRegistrarCsv(ianaSource.text);
    const auditYear = now.getUTCFullYear();
    const notices = parseIcannComplianceNotices(icannSource.text, auditYear);
    const observedIanaDigest = sha256(normalizedRegistrarRows(rows));
    const observedIcannDigest = sha256(normalizedNotices(notices));
    const retainedObservedAt = [
      canonicalTimestamp(current.iana.observedAt, 'Retained IANA observation time'),
      canonicalTimestamp(current.icann.reviewedAt, 'Retained ICANN review time'),
    ].sort((left, right) => Date.parse(left) - Date.parse(right))[0]!;
    const retainedAgeDays = Math.max(0, Math.floor((now.getTime() - Date.parse(retainedObservedAt)) / 86_400_000));
    const checks = Object.freeze([
      Object.freeze({
        id: 'iana_registrar_ids',
        status: observedIanaDigest === current.iana.normalizedSha256 ? 'current' : 'drift',
        expectedDigest: current.iana.normalizedSha256,
        observedDigest: observedIanaDigest,
        expectedItems: current.iana.rows,
        observedItems: rows.length,
      }),
      Object.freeze({
        id: 'icann_current_year_notices',
        status: auditYear === current.icann.catalogueYear
          && observedIcannDigest === current.icann.normalizedSha256 ? 'current' : 'drift',
        expectedDigest: current.icann.normalizedSha256,
        observedDigest: observedIcannDigest,
        expectedItems: current.icann.notices.length,
        observedItems: notices.length,
        expectedYear: current.icann.catalogueYear,
        observedYear: auditYear,
      }),
      Object.freeze({
        id: 'catalogue_freshness',
        status: retainedAgeDays <= REGISTRAR_STANDING_MAX_AGE_DAYS ? 'current' : 'drift',
        observedAt: retainedObservedAt,
        ageDays: retainedAgeDays,
        maximumAgeDays: REGISTRAR_STANDING_MAX_AGE_DAYS,
        expectedItems: 2,
        observedItems: 2,
      }),
    ]);
    const report = Object.freeze({
      schema: REGISTRAR_STANDING_AUDIT_SCHEMA,
      version: REGISTRAR_STANDING_AUDIT_VERSION,
      generatedAt: now.toISOString(),
      networkRequests: 2,
      checks,
      status: checks.every((check) => check.status === 'current') ? 'current' : 'drift',
      limitations: Object.freeze([
        'The audit compares bounded normalized official-source projections; it does not change the catalogue.',
        'The ICANN projection covers the recorded current-year notice index, not allegations or a complete historical compliance record.',
      ]),
    });
    stdout.write(parsed.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : [
          'WHOISleuth registrar standing audit',
          `State: ${report.status}`,
          ...checks.map((check) => `${check.status.toUpperCase().padEnd(8)} ${check.id}: ${check.observedItems} records`),
          'Network requests: 2',
          '',
        ].join('\n'));
    return report.status === 'current' ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Registrar standing catalogue maintenance failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) process.exitCode = await main();

export type {
  CatalogueSnapshot,
  ComplianceNotice,
  RegistrarRow,
};
