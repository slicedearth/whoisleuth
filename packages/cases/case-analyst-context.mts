import { ANALYST_CONTEXT_CASE_SCHEMA_VERSION } from '../contracts/case-portability.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';

// Analyst-selected context retained beside a Case, separate from its domain
// evidence. A popularity rank shows only what one selected list asserts about
// the Case domain; it is not an observation of the domain, never enters the
// evidence fingerprint and is left out of public packs.

export const MAX_CASE_ANALYST_CONTEXT = 8;
export const CASE_POPULARITY_RANK_LIMITATION = 'The rank shows only what the selected list asserts. It does not show that the domain is safe, legitimate or connected to the brand.';

export type CasePopularityRankContext = Readonly<{
  id: string;
  kind: 'popularity_rank';
  rank: number;
  /** SHA-256 of the selected list file, as Discover and the CLI report it. */
  listSha256: string;
  recordedAt: string;
}>;
export type CaseAnalystContext = CasePopularityRankContext;

const ID = /^[A-Za-z0-9_-]{1,64}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const KEYS = ['id', 'kind', 'rank', 'listSha256', 'recordedAt'] as const;

function readEntry(raw: unknown): CaseAnalystContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('A Case analyst context entry is malformed.');
  const item = raw as Record<string, unknown>;
  const keys = Object.keys(item);
  if (keys.length !== KEYS.length || KEYS.some((key) => !Object.hasOwn(item, key))) throw new TypeError('A Case analyst context entry is malformed.');
  if (typeof item.id !== 'string' || !ID.test(item.id) || item.kind !== 'popularity_rank'
    || !Number.isSafeInteger(item.rank) || Number(item.rank) < 1
    || typeof item.listSha256 !== 'string' || !DIGEST.test(item.listSha256)) {
    throw new TypeError('A Case popularity rank is malformed.');
  }
  const recordedAt = normalizeExplicitIsoTimestamp(item.recordedAt);
  if (!recordedAt || recordedAt !== item.recordedAt) throw new TypeError('A Case popularity rank needs an exact recording time.');
  return Object.freeze({ id: item.id, kind: 'popularity_rank', rank: Number(item.rank), listSha256: item.listSha256, recordedAt });
}

function ordered(entries: Iterable<CaseAnalystContext>): CaseAnalystContext[] {
  return [...entries].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** Strict admission; one rank per selected list. Absent and empty both read as undefined. */
export function readCaseAnalystContext(value: unknown, sourceVersion?: number | null): CaseAnalystContext[] | undefined {
  if (value === undefined) return undefined;
  if (sourceVersion != null && sourceVersion < ANALYST_CONTEXT_CASE_SCHEMA_VERSION) {
    throw new TypeError(`Analyst context requires Case schema ${ANALYST_CONTEXT_CASE_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(value) || value.length > MAX_CASE_ANALYST_CONTEXT) {
    throw new TypeError(`A Case can retain at most ${MAX_CASE_ANALYST_CONTEXT} analyst context entries.`);
  }
  const entries = value.map(readEntry);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length
    || new Set(entries.map((entry) => entry.listSha256)).size !== entries.length) {
    throw new TypeError('Case analyst context identities and selected lists must be unique.');
  }
  return entries.length ? ordered(entries) : undefined;
}

/** Records the rank a selected list gives this Case's domain, replacing an earlier rank from the same list. */
export function recordCasePopularityRank(
  current: readonly CaseAnalystContext[] | undefined,
  input: unknown,
  now: string,
  makeId: () => string,
): CaseAnalystContext[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Select a popularity rank to record.');
  const raw = input as Record<string, unknown>;
  const entry = readEntry({ id: makeId(), kind: 'popularity_rank', rank: raw.rank, listSha256: raw.listSha256, recordedAt: now });
  const others = (current ?? []).filter((item) => item.listSha256 !== entry.listSha256);
  if (others.length >= MAX_CASE_ANALYST_CONTEXT) {
    throw new Error(`This Case already retains ${MAX_CASE_ANALYST_CONTEXT} list ranks. No rank was added.`);
  }
  return ordered([...others, entry]);
}

/** Additive import merge: one entry per list, keeping the later recording; bounded deterministically. */
export function mergeCaseAnalystContext(
  local: readonly CaseAnalystContext[] | undefined,
  incoming: readonly CaseAnalystContext[] | undefined,
): CaseAnalystContext[] | undefined {
  const byList = new Map<string, CaseAnalystContext>();
  for (const entry of [...(local ?? []), ...(incoming ?? [])]) {
    const previous = byList.get(entry.listSha256);
    if (!previous || previous.recordedAt < entry.recordedAt || (previous.recordedAt === entry.recordedAt && previous.id < entry.id)) {
      byList.set(entry.listSha256, entry);
    }
  }
  const merged = ordered(byList.values()).slice(-MAX_CASE_ANALYST_CONTEXT);
  if (new Set(merged.map((entry) => entry.id)).size !== merged.length) {
    throw new TypeError('Conflicting analyst context entries share an identity. No context was changed.');
  }
  return merged.length ? merged : undefined;
}
