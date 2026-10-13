import type { CaseRecord } from '../cases.ts';
import { MAX_NOTE_LENGTH, MAX_RESPONSE_RATIONALE_LENGTH } from '../../../../packages/contracts/case-portability.mts';
import { canonicalArtifactJsonV2 } from '../../../../packages/evidence/artifact-integrity.mts';
import { sha256IdentityHex } from '../../../../packages/evidence/record-identity.mts';

export const TEMPORARY_BOARD_CARD_LIMIT = 12;
export const TEMPORARY_BOARD_LINK_LIMIT = 24;
export const TEMPORARY_BOARD_TEXT_BYTES = 32 * 1024;
export { MAX_NOTE_LENGTH as TEMPORARY_BOARD_CARD_TEXT_LIMIT, MAX_RESPONSE_RATIONALE_LENGTH as TEMPORARY_BOARD_BASIS_LIMIT };
export const TEMPORARY_BOARD_REFERENCE_KINDS = ['pin','assertion','note'] as const;
export const TEMPORARY_BOARD_TEXT_KINDS = ['question','hypothesis','note'] as const;
export type BoardTextKind = typeof TEMPORARY_BOARD_TEXT_KINDS[number];
export type BoardReference = Readonly<{ kind: typeof TEMPORARY_BOARD_REFERENCE_KINDS[number]; id: string }>;
export type BoardCard = Readonly<{ id: string; kind: 'reference'; reference: BoardReference; fingerprint: string }>
  | Readonly<{ id: string; kind: BoardTextKind; text: string }>;
export const TEMPORARY_BOARD_LINK_KINDS = ['supports', 'contradicts', 'investigate_next', 'analyst_grouping'] as const;
export type BoardLinkKind = typeof TEMPORARY_BOARD_LINK_KINDS[number];
export type BoardLink = Readonly<{ id: string; from: string; to: string; kind: BoardLinkKind; basis: string }>;
export type TemporaryCaseboard = Readonly<{ cards: readonly BoardCard[]; links: readonly BoardLink[] }>;
export const emptyTemporaryCaseboard = (): TemporaryCaseboard => ({ cards: [], links: [] });
type ReadySource = { state: 'ready'; fingerprint: string } & (
  { kind: 'pin'; value: CaseRecord['evidencePins'][number] }
  | { kind: 'assertion'; value: CaseRecord['assertions'][number] }
  | { kind: 'note'; value: CaseRecord['notes'][number] }
);
export type BoardSource = ReadySource | { state: 'missing' | 'ambiguous' | 'unavailable' };
const encoder = new TextEncoder();
const identity = (value: string): boolean => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);

/** Current admitted Case values only; old source content is never copied into the board. */
export function resolveBoardReference(record: CaseRecord, reference: BoardReference): BoardSource {
  const sources = reference.kind === 'pin' ? record.evidencePins : reference.kind === 'assertion' ? record.assertions : reference.kind === 'note' ? record.notes : [];
  const matches = sources.filter(value => value.id === reference.id);
  if (!matches.length) return { state: 'missing' };
  if (matches.length !== 1) return { state: 'ambiguous' };
  try {
    const fingerprint = sha256IdentityHex(encoder.encode(canonicalArtifactJsonV2(matches[0])));
    // Each closed family resolves through its own bounded, already-normalised list.
    if (reference.kind === 'pin') return { state: 'ready', kind: 'pin', value: record.evidencePins.find(value => value.id === reference.id)!, fingerprint };
    if (reference.kind === 'assertion') return { state: 'ready', kind: 'assertion', value: record.assertions.find(value => value.id === reference.id)!, fingerprint };
    return { state: 'ready', kind: 'note', value: record.notes.find(value => value.id === reference.id)!, fingerprint };
  } catch { return { state: 'unavailable' }; }
}

export type BoardOperation =
  | { kind: 'reference'; id: string; reference: BoardReference }
  | { kind: 'text'; id: string; type: BoardTextKind; text: string }
  | { kind: 'edit'; id: string; text: string }
  | { kind: 'move'; id: string; direction: -1 | 1 }
  | { kind: 'remove'; id: string }
  | { kind: 'link'; link: BoardLink }
  | { kind: 'unlink'; id: string };

/** Reversible document-only operations; no Case operation or serializer is accepted. */
export function changeTemporaryCaseboard(board: TemporaryCaseboard, record: CaseRecord, operation: BoardOperation) {
  const reject = (message: string) => ({ ok: false as const, board, message });
  let cards = [...board.cards], links = [...board.links], message = 'Temporary board updated. Nothing was saved to the Case.';
  if (operation.kind === 'reference' || operation.kind === 'text') {
    if (!identity(operation.id) || cards.some(card => card.id === operation.id)) return reject('This temporary card identity is unavailable.');
    if (cards.length >= TEMPORARY_BOARD_CARD_LIMIT) return reject('The board is full. Remove a card before adding another.');
    if (operation.kind === 'reference') {
      if (!identity(operation.reference.id) || !TEMPORARY_BOARD_REFERENCE_KINDS.includes(operation.reference.kind)) return reject('Choose an exact retained reference.');
      if (cards.some(card => card.kind === 'reference' && card.reference.kind === operation.reference.kind && card.reference.id === operation.reference.id)) return reject('This exact reference is already on the board.');
      const source = resolveBoardReference(record, operation.reference);
      if (source.state !== 'ready') return reject('This reference is unavailable or ambiguous. Nothing was substituted.');
      cards.push({ id: operation.id, kind: 'reference', reference: { ...operation.reference }, fingerprint: source.fingerprint });
    } else {
      if (!TEMPORARY_BOARD_TEXT_KINDS.includes(operation.type) || typeof operation.text !== 'string' || !operation.text.trim() || operation.text.length > MAX_NOTE_LENGTH) return reject('Enter bounded text for a question, hypothesis or temporary note.');
      cards.push({ id: operation.id, kind: operation.type, text: operation.text });
    }
  } else if (operation.kind === 'link') {
    const link = operation.link;
    if (links.length >= TEMPORARY_BOARD_LINK_LIMIT) return reject('The link list is full. Remove a link before adding another.');
    if (!identity(link.id) || links.some(value => value.id === link.id) || !TEMPORARY_BOARD_LINK_KINDS.includes(link.kind)
      || link.from === link.to || !cards.some(card => card.id === link.from) || !cards.some(card => card.id === link.to)
      || typeof link.basis !== 'string' || !link.basis.trim() || link.basis.length > MAX_RESPONSE_RATIONALE_LENGTH) return reject('Choose two different current cards, a relationship and bounded reasoning.');
    if (links.some(value => value.from === link.from && value.to === link.to && value.kind === link.kind)) return reject('That authored relationship is already present.');
    links.push({ ...link });
  } else if (operation.kind === 'unlink') {
    if (!links.some(link => link.id === operation.id)) return reject('That temporary link is no longer present.');
    links = links.filter(link => link.id !== operation.id);
  } else {
    const index = cards.findIndex(card => card.id === operation.id), card = cards[index];
    if (!card) return reject('That temporary card is no longer present.');
    if (operation.kind === 'edit') {
      if (card.kind === 'reference' || typeof operation.text !== 'string' || !operation.text.trim() || operation.text.length > MAX_NOTE_LENGTH) return reject('Only authored cards accept bounded text edits.');
      cards[index] = { ...card, text: operation.text };
    } else if (operation.kind === 'move') {
      const next = index + operation.direction;
      if (![1,-1].includes(operation.direction) || next < 0 || next >= cards.length) return reject('The card cannot move further in that direction.');
      cards.splice(index, 1); cards.splice(next, 0, card);
    } else if (operation.kind === 'remove') {
      cards.splice(index, 1);
      const previous = links.length; links = links.filter(link => link.from !== card.id && link.to !== card.id);
      message = `Temporary card removed with ${previous - links.length} authored link${previous - links.length === 1 ? '' : 's'}. Saved evidence is unchanged.`;
    } else return reject('This temporary operation is unsupported.');
  }
  const bytes = cards.reduce((sum, card) => sum + (card.kind === 'reference' ? 0 : encoder.encode(card.text).length), 0)
    + links.reduce((sum, link) => sum + encoder.encode(link.basis).length, 0);
  if (bytes > TEMPORARY_BOARD_TEXT_BYTES) return reject('The authored-text byte limit is reached. Shorten text or remove a card or link; nothing was truncated.');
  return { ok: true as const, board: { cards, links } satisfies TemporaryCaseboard, message };
}
