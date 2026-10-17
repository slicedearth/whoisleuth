import { LOCAL_WORKSPACE_MAX_DIRECTORY_CHARACTERS } from '../../../../packages/contracts/local-application.mts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

export const TEMPORARY_WORKSPACE_REFERENCE_COUNT = 5;
export const TEMPORARY_WORKSPACE_LABEL_CHARACTERS = 100;
const MEMORY_BYTES = 64 * 1024;
export type TemporaryWorkspaceReference = Readonly<{
  id: string; label: string; path: string; addedAt: string; basis: 'current_launch' | 'supplied';
}>;

export function addTemporaryWorkspaceReference(current: readonly TemporaryWorkspaceReference[], input: {
  label: string; path: string; basis: TemporaryWorkspaceReference['basis'];
}, addedAt: string): readonly TemporaryWorkspaceReference[] {
  if (current.length >= TEMPORARY_WORKSPACE_REFERENCE_COUNT) throw new TypeError('Remove a temporary reference before adding another. No reference was removed automatically.');
  if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > TEMPORARY_WORKSPACE_LABEL_CHARACTERS
    || typeof input.path !== 'string' || !input.path.trim() || input.path.length > LOCAL_WORKSPACE_MAX_DIRECTORY_CHARACTERS
    || /[\u0000-\u001f\u007f]/u.test(input.label + input.path)
    || !['current_launch', 'supplied'].includes(input.basis))
    throw new TypeError('Supply a bounded label and folder reference without control characters. No folder was inspected.');
  if (current.some(row => row.label === input.label.trim() || row.path === input.path))
    throw new TypeError('That label or exact supplied path is already in this temporary shortlist.');
  const time = normalizeExplicitIsoTimestamp(addedAt);
  if (!time) throw new TypeError('The local reference-addition time is unavailable.');
  const row = Object.freeze({ id: crypto.randomUUID(), label: input.label.trim(), path: input.path, basis: input.basis, addedAt: time });
  const result = [row, ...current];
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MEMORY_BYTES)
    throw new TypeError('The temporary references exceed their combined text budget. No reference was removed automatically.');
  return Object.freeze(result);
}
