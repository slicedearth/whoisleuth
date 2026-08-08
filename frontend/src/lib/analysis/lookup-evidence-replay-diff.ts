import type { LookupEvidenceReplay } from './lookup-evidence-replay.ts';

export const LOOKUP_EVIDENCE_REPLAY_DIFF_VERSION = 1;
const MAX_DIFF_ROWS = 64;

export type LookupEvidenceReplayDiffRow = Readonly<{
  id: string;
  label: string;
  kind: 'collection_quality_difference' | 'interpretation_difference' | 'observed_change' | 'unchanged';
  left: string;
  right: string;
  explanation: string;
}>;

function sameText(left: unknown, right: unknown): boolean {
  return String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase();
}

function explicitlyCompleteSourceState(state: string, complete: boolean | null): boolean {
  const canonical = state.trim().toLowerCase().replace(/[\s-]+/gu, '_');
  return complete === true && ['complete', 'success', 'provided'].includes(canonical);
}

function factSourceExplicitlyComplete(
  fact: LookupEvidenceReplay['facts'][number] | undefined,
  fallbackFact: LookupEvidenceReplay['facts'][number] | undefined,
  replay: LookupEvidenceReplay,
): boolean {
  if (fact) return explicitlyCompleteSourceState(fact.sourceState, fact.sourceComplete);
  if (!fallbackFact) return false;
  const source = replay.sources.find((item) => item.id === fallbackFact.sourceId);
  return Boolean(source && explicitlyCompleteSourceState(source.state, source.complete));
}

export function buildLookupEvidenceReplayDiff(
  left: LookupEvidenceReplay,
  right: LookupEvidenceReplay,
) {
  if (left.target.toLowerCase() !== right.target.toLowerCase()) {
    throw new Error('Two-capture evidence comparison requires exports for the same target.');
  }
  const rows: LookupEvidenceReplayDiffRow[] = [];
  const sourceIds = [...new Set([...left.sources.map((item) => item.id), ...right.sources.map((item) => item.id)])].sort();
  for (const id of sourceIds) {
    const before = left.sources.find((item) => item.id === id);
    const after = right.sources.find((item) => item.id === id);
    const unchanged = before && after && before.state === after.state && before.complete === after.complete;
    rows.push({
      id: `source:${id}`,
      label: before?.label ?? after?.label ?? id,
      kind: unchanged ? 'unchanged' : 'collection_quality_difference',
      left: before ? `${before.state}${before.complete === false ? ' · incomplete' : ''}` : 'not recorded',
      right: after ? `${after.state}${after.complete === false ? ' · incomplete' : ''}` : 'not recorded',
      explanation: unchanged
        ? 'The retained source state and completeness are unchanged.'
        : 'Source state or completeness differs, so missing or changed facts may reflect collection conditions rather than target change.',
    });
  }
  const factIds = [...new Set([...left.facts.map((item) => item.id), ...right.facts.map((item) => item.id)])].sort();
  for (const id of factIds) {
    const before = left.facts.find((item) => item.id === id);
    const after = right.facts.find((item) => item.id === id);
    const label = before?.label ?? after?.label ?? id;
    const sourcesExplicitlyComplete = factSourceExplicitlyComplete(before, after, left)
      && factSourceExplicitlyComplete(after, before, right);
    const unchanged = before && after && sameText(before.value, after.value);
    const sourceChanged = Boolean(before && after && before.sourceId !== after.sourceId);
    const kind = sourceChanged
      ? 'collection_quality_difference'
      : unchanged
      ? 'unchanged'
      : (!before || !after) && !sourcesExplicitlyComplete
        ? 'collection_quality_difference'
        : 'observed_change';
    rows.push({
      id: `fact:${id}`,
      label,
      kind,
      left: before?.value ?? 'not recorded',
      right: after?.value ?? 'not recorded',
      explanation: kind === 'observed_change'
        ? 'The bounded normalised value differs between two retained observations.'
        : kind === 'collection_quality_difference'
          ? sourceChanged
            ? 'The retained source attribution changed, so the values are not represented as a target change even when they differ.'
            : 'One observation lacks this fact without explicitly complete positive source evidence on both sides; this is a collection or provenance difference, not observed removal.'
          : 'The bounded normalised value is unchanged.',
    });
  }
  if (left.generatorVersion !== right.generatorVersion) {
    rows.push({
      id: 'interpretation:generator-version',
      label: 'WHOISleuth interpretation version',
      kind: 'interpretation_difference',
      left: left.generatorVersion ?? 'not recorded',
      right: right.generatorVersion ?? 'not recorded',
      explanation: 'The exports were produced by different application versions, so derived or normalised output may reflect an interpretation change.',
    });
  }
  const retained = rows.slice(0, MAX_DIFF_ROWS);
  return Object.freeze({
    version: LOOKUP_EVIDENCE_REPLAY_DIFF_VERSION,
    target: left.target,
    left: Object.freeze({ exportedAt: left.exportedAt, digestSha256: left.digestSha256 }),
    right: Object.freeze({ exportedAt: right.exportedAt, digestSha256: right.digestSha256 }),
    rows: Object.freeze(retained),
    counts: Object.freeze({
      observedChanges: retained.filter((item) => item.kind === 'observed_change').length,
      collectionDifferences: retained.filter((item) => item.kind === 'collection_quality_difference').length,
      interpretationDifferences: retained.filter((item) => item.kind === 'interpretation_difference').length,
      unchanged: retained.filter((item) => item.kind === 'unchanged').length,
    }),
    truncated: rows.length > retained.length,
    limitations: Object.freeze([
      'This offline comparison uses only two selected evidence exports and makes no network request.',
      'Observed differences can reflect target change, publication lag, or collection conditions and require analyst review.',
      'Collection-quality and interpretation differences are kept separate from observed evidence changes.',
    ]),
  });
}
