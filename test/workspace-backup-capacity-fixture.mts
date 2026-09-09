import {
  MAX_CASES, MAX_CASE_STORE_BYTES, MAX_NOTES_PER_CASE, MAX_NOTE_LENGTH,
  normalizeCaseStore, serializeCaseStore,
} from '../packages/cases/case-model.mts';
import { bulkStoreAtCapacity } from './bulk-session-fixture.mts';
import { brandProfileStoreAtBytes } from './brand-profile-capacity-fixture.mts';
import { MAX_PROFILE_STORE_BYTES } from '../packages/contracts/workspace-portability.mts';

const NOW = '2026-09-09T00:00:00.000Z';

export function caseStoreAtCapacity() {
  const store = normalizeCaseStore(Array.from({ length: MAX_CASES }, (_, index) => ({
    id: `capacity-case-${index}`, domain: `case-${index}.example`, status: 'new',
    disposition: 'unreviewed', source: 'manual', createdAt: NOW, updatedAt: NOW,
  })));
  let remaining = MAX_CASE_STORE_BYTES - Buffer.byteLength(serializeCaseStore(store.cases));
  for (const record of store.cases) {
    for (let index = 0; index < MAX_NOTES_PER_CASE && remaining > 0; index++) {
      const id = `note-${record.id}-${index}`;
      const overhead = Buffer.byteLength(JSON.stringify({ id, createdAt: NOW, body: '' })) + (index ? 1 : 0);
      const length = Math.min(MAX_NOTE_LENGTH, remaining - overhead);
      if (length < 1) throw new Error('The remaining Case capacity cannot hold a note.');
      record.notes.push({ id, createdAt: NOW, body: `${record.id}-${index}`.padEnd(length, 'x').slice(0, length) });
      remaining -= overhead + length;
    }
  }
  const normalized = normalizeCaseStore(store);
  if (remaining !== 0 || Buffer.byteLength(serializeCaseStore(normalized.cases)) !== MAX_CASE_STORE_BYTES) {
    throw new Error('The Case fixture did not retain its exact capacity.');
  }
  return normalized;
}

export function combinedWorkspaceAtCapacity() {
  return {
    cases: caseStoreAtCapacity().cases,
    bulkSessions: bulkStoreAtCapacity().sessions,
    brandProfiles: brandProfileStoreAtBytes(MAX_PROFILE_STORE_BYTES).profiles,
  };
}
