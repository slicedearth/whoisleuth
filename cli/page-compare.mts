import { buildBulkComparisonEvidence } from '../lib/bulk-comparison-evidence.mts';
import { createPageBaseline } from '../frontend/src/lib/analysis/page-baseline.ts';
import { comparePageBaselines } from '../frontend/src/lib/analysis/page-similarity.ts';
import { CliUsageError } from './errors.mts';
import { parseSavedLookupDocument, type SavedLookupDocument, type UnknownRecord } from './saved-lookup.mts';

export const CLI_PAGE_COMPARE_SCHEMA = 'whoisleuth.cli.page-compare';
export const CLI_PAGE_COMPARE_VERSION = 3;

type ComparisonState = 'different' | 'equal' | 'overlap' | 'partial' | 'unavailable';

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((candidate) => typeof candidate === 'string' ? [candidate] : []))].sort().slice(0, 20);
}

function setComparison(left: readonly string[], right: readonly string[]): ComparisonState {
  if (!left.length || !right.length) return 'unavailable';
  const shared = left.filter((value) => right.includes(value));
  if (shared.length === left.length && shared.length === right.length) return 'equal';
  return shared.length ? 'overlap' : 'different';
}

function scalarComparison(left: string | null, right: string | null): ComparisonState {
  if (!left || !right) return 'unavailable';
  return left === right ? 'equal' : 'different';
}

function comparisonContext(document: SavedLookupDocument) {
  const availability = record(document.availability);
  const pageBaseline = createPageBaseline(document.registrableDomain, availability);
  if (!pageBaseline) {
    throw new CliUsageError(`${document.registrableDomain} does not contain a complete, supported static page-identity observation. Run a deep lookup and save its JSON output first.`);
  }
  return {
    availability,
    pageBaseline,
    compact: buildBulkComparisonEvidence(availability),
  };
}

function buildCliPageComparison(
  leftText: string,
  rightText: string,
  generatedAt = new Date().toISOString(),
) {
  const leftDocument = parseSavedLookupDocument(leftText, { label: 'Left page-comparison input' });
  const rightDocument = parseSavedLookupDocument(rightText, { label: 'Right page-comparison input' });
  if (leftDocument.registrableDomain === rightDocument.registrableDomain) {
    throw new CliUsageError('Page comparison requires lookup documents for two different domains.');
  }
  const left = comparisonContext(leftDocument);
  const right = comparisonContext(rightDocument);
  const page = comparePageBaselines(left.pageBaseline, right.pageBaseline);
  if (!page) throw new CliUsageError('The static page observations could not be compared.');
  const leftTechnology = stringList(left.compact.technology.ids);
  const rightTechnology = stringList(right.compact.technology.ids);
  const sharedTechnology = leftTechnology.filter((id) => rightTechnology.includes(id));
  const technologyUsable = ['success', 'partial'].includes(left.compact.technology.state)
    && ['success', 'partial'].includes(right.compact.technology.state);
  const tlsUsable = ['success', 'partial'].includes(left.compact.tls.state)
    && ['success', 'partial'].includes(right.compact.tls.state);
  const technologyPartial = left.compact.technology.truncated || right.compact.technology.truncated
    || left.compact.technology.state === 'partial' || right.compact.technology.state === 'partial';
  return {
    schema: CLI_PAGE_COMPARE_SCHEMA,
    version: CLI_PAGE_COMPARE_VERSION,
    generatedAt,
    left: {
      domain: leftDocument.registrableDomain,
      observedAt: left.pageBaseline.observedAt,
      complete: left.pageBaseline.complete,
    },
    right: {
      domain: rightDocument.registrableDomain,
      observedAt: right.pageBaseline.observedAt,
      complete: right.pageBaseline.complete,
    },
    page,
    technology: {
      state: technologyUsable
        ? technologyPartial ? 'partial' as const : setComparison(leftTechnology, rightTechnology)
        : 'unavailable' as ComparisonState,
      leftSourceState: left.compact.technology.state,
      rightSourceState: right.compact.technology.state,
      leftIds: leftTechnology,
      rightIds: rightTechnology,
      sharedIds: sharedTechnology,
      partial: technologyPartial,
    },
    tls: {
      leftSourceState: left.compact.tls.state,
      rightSourceState: right.compact.tls.state,
      issuer: {
        state: tlsUsable ? scalarComparison(left.compact.tls.issuerLabel, right.compact.tls.issuerLabel) : 'unavailable' as ComparisonState,
        left: left.compact.tls.issuerLabel,
        right: right.compact.tls.issuerLabel,
      },
      publicKey: {
        state: tlsUsable ? scalarComparison(left.compact.tls.spkiSha256, right.compact.tls.spkiSha256) : 'unavailable' as ComparisonState,
        leftSha256: left.compact.tls.spkiSha256,
        rightSha256: right.compact.tls.spkiSha256,
      },
    },
    limitations: [
      'This comparison is offline and uses only bounded static page, favicon, technology, and TLS evidence retained in two saved deep lookups.',
      'A partial, missing, or unavailable component is never interpreted as an observed difference or absence.',
      'Matching components are investigative relationships and do not establish copying, common ownership, control, intent, safety, or maliciousness.',
      'Static page collection does not execute JavaScript and can differ from a rendered browser capture.',
    ],
  };
}

function formatCliPageComparison(document: ReturnType<typeof buildCliPageComparison>): string {
  const lines = [
    'Static page comparison',
    `Left             ${document.left.domain}`,
    `Right            ${document.right.domain}`,
    `Page evidence    ${document.page.partial ? 'Partial' : 'Complete'}`,
    '',
    'Page identity',
  ];
  for (const component of document.page.components) {
    lines.push(`${component.label.padEnd(18)} ${component.outcome}`);
  }
  lines.push(
    '',
    'Technology',
    `Relationship     ${document.technology.state}`,
    `Evidence         ${document.technology.partial ? 'Partial; equality and disjointness withheld' : 'Complete retained sets'}`,
    `Shared           ${document.technology.sharedIds.join(', ') || 'None observed'}`,
    `Left             ${document.technology.leftIds.join(', ') || 'Unavailable'}`,
    `Right            ${document.technology.rightIds.join(', ') || 'Unavailable'}`,
    '',
    'TLS',
    `Issuer           ${document.tls.issuer.state}`,
    `Public key       ${document.tls.publicKey.state}`,
    '',
    'Limitations:',
  );
  for (const limitation of document.limitations) lines.push(`  - ${limitation}`);
  return `${lines.join('\n')}\n`;
}

export { buildCliPageComparison, formatCliPageComparison };
