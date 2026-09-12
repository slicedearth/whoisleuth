import { onMount, tick } from 'svelte';
import { restoreSubmittedFocus } from './submitted-draft.ts';
import { readBrowserLocalData, subscribeBrowserLocalData, browserLocalDataProvider, browserLocalDataCollection } from '../browser-local-data-service.ts';
import type { CaseDraftFields, CaseDraftStore } from '../../../../packages/contracts/case-drafts.mts';
import type { CaseRecord } from '../analysis/case-model.ts';
import type { PersistCaseResponse } from '../analysis/case-response-stage.ts';
import { createCaseDraftRecovery, restoreCaseDraftFields, INITIAL_CASE_DRAFT_RECOVERY_STATE, type CaseDraftRecoveryState } from './case-draft-recovery.ts';

const unprotected = new Set<object>();
export function hasUnprotectedCaseDrafts(): boolean { return unprotected.size > 0; }

/** Form defaults own scalar types; the one relation-list form declares its row shape. */
export function createCaseDraft<T extends CaseDraftFields>(
  caseId: () => string, form: string, initial: T,
  objectLists: Partial<Record<keyof T, Record<string, string>>> = {},
) {
  let value = $state<T>(structuredClone(initial));
  let state = $state<CaseDraftRecoveryState>(INITIAL_CASE_DRAFT_RECOVERY_STATE);
  const owner = {};
  const recovery = createCaseDraftRecovery({
    caseId: caseId(), form,
    readFields: () => $state.snapshot(value) as T,
    restoreFields: fields => { value = restoreCaseDraftFields(fields, initial, objectLists); },
    resetFields: () => { value = structuredClone(initial); },
    storage: {
      read: () => readBrowserLocalData('case_drafts'),
      update: async change => {
        const [provider, cases, drafts] = await Promise.all([browserLocalDataProvider(), browserLocalDataCollection('cases'), browserLocalDataCollection('case_drafts')]);
        await provider.updateMany([cases, drafts], documents => {
          if (!(documents.get('cases') as CaseRecord[]).some(record => record.id === caseId())) throw new Error('This Case was deleted. Its recovery drafts cannot be saved.');
          return { documents: new Map(documents).set('case_drafts', change(documents.get('case_drafts') as CaseDraftStore)), result: undefined };
        });
      },
    },
    notify: (next, unsafe) => { state = next; if (unsafe) unprotected.add(owner); else unprotected.delete(owner); },
  });
  onMount(() => {
    void recovery.refresh();
    const unsubscribe = subscribeBrowserLocalData('case_drafts', () => { void recovery.refresh(); });
    return () => { unsubscribe(); recovery.destroy(); unprotected.delete(owner); };
  });
  return {
    form,
    get value() { return value; }, get state() { return state; },
    ...recovery,
    persist: async (persist: PersistCaseResponse, ...args: Parameters<PersistCaseResponse>) => {
      const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const saved = await recovery.submit(receipt => persist(args[0], args[1], args[2], receipt));
      await tick();
      restoreSubmittedFocus(origin, args[2]?.() ?? origin, origin?.closest('form'));
      return saved;
    },
  };
}
