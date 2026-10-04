import { array, enumeration, exact, exactOptional, iso, text } from '../evidence/artifact-structure.mts';
import { assertWorkspaceInputGraph } from '../workspace/hostile-input.mts';
import { MAX_CASE_EVIDENCE_PINS, MAX_RESPONSE_RATIONALE_LENGTH } from '../contracts/case-portability.mts';
import { SAFE_ID_RE, freshId } from './case-response-values.mts';
import type { CaseEvidencePin } from './case-response-records.mts';

export const CASE_EVIDENCE_LINK_KINDS = ['derived_from', 'shared_source'] as const;
/** Enough for both directed relationships between every admitted pin pair. */
export const MAX_CASE_EVIDENCE_LINKS = MAX_CASE_EVIDENCE_PINS * (MAX_CASE_EVIDENCE_PINS - 1) * CASE_EVIDENCE_LINK_KINDS.length;
export type CaseEvidenceLink = {
  id: string; fromPinId: string; toPinId: string;
  kind: typeof CASE_EVIDENCE_LINK_KINDS[number]; basis: string; createdAt: string;
  withdrawal?: { at: string; reason: string };
};

function identifier(value: unknown): string {
  const id = text(value, 'Evidence link identity', 64);
  if (!SAFE_ID_RE.test(id)) throw new TypeError('Evidence link identity is invalid.');
  return id;
}

function explanation(value: unknown): string {
  const result = text(value, 'Evidence relationship basis', MAX_RESPONSE_RATIONALE_LENGTH).trim();
  if (!result) throw new TypeError('Explain the evidence relationship.');
  return result;
}

export function readCaseEvidenceLinks(value: unknown): CaseEvidenceLink[] | undefined {
  if (value === undefined) return undefined;
  assertWorkspaceInputGraph(value, 'Evidence relationships');
  const links = array(value, 'Evidence relationships', MAX_CASE_EVIDENCE_LINKS).map(raw => {
    const row = exactOptional(raw, ['id', 'fromPinId', 'toPinId', 'kind', 'basis', 'createdAt'], ['withdrawal'], 'Evidence relationship');
    const fromPinId = identifier(row.fromPinId), toPinId = identifier(row.toPinId);
    if (fromPinId === toPinId) throw new TypeError('An evidence pin cannot derive from or share a source with itself.');
    iso(row.createdAt, 'Relationship recording time');
    let withdrawal: CaseEvidenceLink['withdrawal'];
    if (row.withdrawal !== undefined) {
      const item = exact(row.withdrawal, ['at', 'reason'], 'Relationship withdrawal');
      iso(item.at, 'Withdrawal time');
      if (Date.parse(item.at as string) < Date.parse(row.createdAt as string)) throw new TypeError('Withdrawal precedes the relationship.');
      withdrawal = { at: item.at as string, reason: explanation(item.reason) };
    }
    return { id: identifier(row.id), fromPinId, toPinId,
      kind: enumeration(row.kind, CASE_EVIDENCE_LINK_KINDS, 'Evidence relationship kind'),
      basis: explanation(row.basis), createdAt: row.createdAt as string, ...(withdrawal ? { withdrawal } : {}) };
  });
  if (new Set(links.map(link => link.id)).size !== links.length) throw new TypeError('Evidence relationship identities must be unique.');
  return links;
}

function derivationGraph(links: readonly CaseEvidenceLink[]) {
  const graph = new Map<string, string[]>();
  for (const link of links) if (!link.withdrawal && link.kind === 'derived_from') {
    const neighbours = graph.get(link.fromPinId) ?? [];
    neighbours.push(link.toPinId); graph.set(link.fromPinId, neighbours);
  }
  return graph;
}

function reaches(graph: ReadonlyMap<string, readonly string[]>, from: string, to: string): boolean {
  const pending = [from], visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === to) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(graph.get(id) ?? []));
  }
  return false;
}

export function appendCaseEvidenceLink(current: readonly CaseEvidenceLink[], input: unknown, pins: readonly CaseEvidencePin[], now: string): CaseEvidenceLink[] {
  const row = exact(input, ['fromPinId', 'toPinId', 'kind', 'basis'], 'New evidence relationship');
  const link = readCaseEvidenceLinks([{ ...row, id: freshId('evidence-link'), createdAt: now }])![0]!;
  const ids = new Set(pins.map(pin => pin.id));
  if (!ids.has(link.fromPinId) || !ids.has(link.toPinId)) throw new TypeError('Select two retained evidence pins.');
  if (current.some(item => !item.withdrawal && item.kind === link.kind
    && ((item.fromPinId === link.fromPinId && item.toPinId === link.toPinId)
      || (link.kind === 'shared_source' && item.fromPinId === link.toPinId && item.toPinId === link.fromPinId)))) {
    throw new TypeError('This evidence relationship is already recorded. Withdraw it before recording a replacement.');
  }
  if (link.kind === 'derived_from' && reaches(derivationGraph(current), link.toPinId, link.fromPinId)) throw new TypeError('This derivation would create a cycle. Review the existing links first.');
  return readCaseEvidenceLinks([...current, link])!;
}

export function withdrawCaseEvidenceLink(current: readonly CaseEvidenceLink[], input: unknown, now: string): CaseEvidenceLink[] {
  const row = exact(input, ['id', 'reason'], 'Evidence relationship withdrawal');
  const id = identifier(row.id), existing = current.find(link => link.id === id);
  if (!existing || existing.withdrawal) throw new TypeError('This relationship is missing or already withdrawn. Refresh before reviewing it.');
  return readCaseEvidenceLinks(current.map(link => link.id === id ? { ...link, withdrawal: { at: now, reason: explanation(row.reason) } } : link))!;
}

/** Keep unresolved references; an imported pin can have been omitted by its source. */
export function mergeCaseEvidenceLinks(local: readonly CaseEvidenceLink[] | undefined, incoming: readonly CaseEvidenceLink[] | undefined): CaseEvidenceLink[] | undefined {
  if (local === undefined && incoming === undefined) return undefined;
  const merged = new Map((readCaseEvidenceLinks(local) ?? []).map(link => [link.id, link]));
  for (const link of readCaseEvidenceLinks(incoming) ?? []) {
    const existing = merged.get(link.id);
    if (!existing) { merged.set(link.id, link); continue; }
    const { withdrawal: left, ...a } = existing, { withdrawal: right, ...b } = link;
    if (JSON.stringify(a) !== JSON.stringify(b) || (left && right && JSON.stringify(left) !== JSON.stringify(right))) {
      throw new TypeError('An imported evidence relationship conflicts with retained provenance. No relationship was overwritten.');
    }
    merged.set(link.id, { ...a, ...((left ?? right) ? { withdrawal: left ?? right } : {}) });
  }
  return readCaseEvidenceLinks([...merged.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function caseEvidenceLinkIssues(links: readonly CaseEvidenceLink[], pins: readonly CaseEvidencePin[]) {
  const ids = new Set(pins.map(pin => pin.id));
  const graph = derivationGraph(links);
  return links.map(link => ({ link,
    missingPinIds: [link.fromPinId, link.toPinId].filter(id => !ids.has(id)),
    cyclic: !link.withdrawal && link.kind === 'derived_from' && reaches(graph, link.toPinId, link.fromPinId),
  }));
}

/** Matching context is disclosed, never counted as independent corroboration. */
export function caseEvidenceSharedContext(pins: readonly CaseEvidencePin[]) {
  const groups = new Map<string, { kind: 'checkpoint' | 'import' | 'source'; label: string; pinIds: string[] }>();
  function add(kind: 'checkpoint' | 'import' | 'source', identity: string | null | undefined, label: string, id: string) {
    if (!identity?.trim()) return;
    const key = JSON.stringify([kind, identity]);
    const group = groups.get(key) ?? { kind, label, pinIds: [] };
    group.pinIds.push(id); groups.set(key, group);
  }
  for (const pin of pins) {
    add('checkpoint', pin.checkpointId, 'Same collection checkpoint', pin.id);
    add('import', pin.importContentSha256, 'Same imported content', pin.id);
    add('source', pin.source, `Same declared source: ${pin.source}`, pin.id);
  }
  return [...groups.values()].filter(group => group.pinIds.length > 1);
}

export const CASE_SELECTED_EVIDENCE_SOURCE_LIMITATION = 'Selected evidence has retained shared-source or derivation context. Multiple references do not establish independent observations; underlying reporting or collection methods may remain unknown. Relationship details are not included in this output.';

/** Qualify a narrow disclosure without exposing relationship identities or private basis text. */
export function caseSelectedEvidenceSourceLimitations(
  pins: readonly CaseEvidencePin[],
  links: readonly CaseEvidenceLink[] | undefined,
  selectedPinIds: readonly string[],
): string[] {
  array(pins, 'Retained evidence pins', MAX_CASE_EVIDENCE_PINS);
  array(links ?? [], 'Retained evidence relationships', MAX_CASE_EVIDENCE_LINKS);
  array(selectedPinIds, 'Selected evidence pins', MAX_CASE_EVIDENCE_PINS);
  const requested = new Set(selectedPinIds);
  const selectedPins = pins.filter(pin => requested.has(pin.id));
  const selected = new Set(selectedPins.map(pin => pin.id));
  if (!selected.size) return [];
  const declared = links?.some(link => !link.withdrawal
    && (selected.has(link.fromPinId) || selected.has(link.toPinId)));
  return declared || caseEvidenceSharedContext(selectedPins).length
    ? [CASE_SELECTED_EVIDENCE_SOURCE_LIMITATION] : [];
}
