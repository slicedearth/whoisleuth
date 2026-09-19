import { caseDraftFields, replaceCaseDraft, removeCaseDraft } from '../../../../packages/cases/case-drafts.mts';
import type { CaseDraftFields, CaseDraftRecord, CaseDraftStore, CaseDraftReceipt } from '../../../../packages/contracts/case-drafts.mts';
import { failedLocalMutationOutcome } from '../local-mutation-outcome.ts';

export type DraftStorage = Readonly<{
  read: () => Promise<CaseDraftStore>;
  update: (change: (store: CaseDraftStore) => CaseDraftStore) => Promise<void>;
}>;

export function restoreCaseDraftFields<T extends CaseDraftFields>(
  value: unknown, initial: T, objectLists: Partial<Record<keyof T, Record<string, string>>> = {},
): T {
  const candidate = caseDraftFields(value);
  if (Object.keys(candidate).some(key => !Object.hasOwn(initial, key))) throw new Error('Draft fields changed.');
  for (const [key, field] of Object.entries(candidate)) {
    const expected = initial[key];
    if (Array.isArray(expected)) {
      if (!Array.isArray(field)) throw new Error('Draft selection changed.');
      const row = objectLists[key];
      if (!field.every(item => row
        ? item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === Object.keys(row).length && Object.keys(row).every(key => typeof item[key] === 'string')
        : typeof item === 'string')) throw new Error('Draft selection shape changed.');
    } else if (typeof field !== typeof expected) throw new Error('Draft field changed.');
  }
  // New fields use current defaults; removed or renamed fields remain available for manual recovery.
  return { ...structuredClone(initial), ...candidate } as T;
}
export type CaseDraftRecoveryState = Readonly<{
  status: 'idle' | 'pending' | 'saved' | 'error' | 'unknown';
  message: string;
  readError: string | null;
  candidates: readonly CaseDraftRecord[];
  busy: boolean;
  edited: boolean;
}>;
export const INITIAL_CASE_DRAFT_RECOVERY_STATE: CaseDraftRecoveryState = Object.freeze({
  status: 'idle', message: '', readError: null, candidates: Object.freeze([]), busy: false, edited: false,
});

/** One form owns its buffer; the shared provider owns every persistent write. */
export function createCaseDraftRecovery(options: Readonly<{
  caseId: string;
  form: string;
  version?: number;
  readFields: () => CaseDraftFields;
  restoreFields: (fields: CaseDraftFields) => void;
  resetFields: () => void;
  storage: DraftStorage;
  retention?: 'workspace' | 'document';
  notify: (state: CaseDraftRecoveryState, unprotected: boolean) => void;
  uuid?: () => string;
}>) {
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  let state = INITIAL_CASE_DRAFT_RECOVERY_STATE;
  let identity: CaseDraftReceipt | null = null;
  let editRevision = 0;
  let storedRevision = 0;
  let submitting = false;
  let destroyed = false;
  let writing: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const version = options.version ?? 1;
  const emit = (patch: Partial<CaseDraftRecoveryState> = {}) => {
    state = { ...state, ...patch };
    if (!destroyed) options.notify(state, state.status === 'unknown' || submitting || editRevision !== storedRevision);
  };
  const failure = (cause: unknown) => {
    if (state.status === 'unknown' || failedLocalMutationOutcome(cause) === 'unknown') {
      clearTimeout(timer);
      emit({ status: 'unknown', message: 'The write may have succeeded, but could not be confirmed. Keep this form open to copy any unsaved text, then reload and review saved records before another change.' });
    } else emit({ status: 'error', message: options.retention === 'document'
      ? 'This practice draft could not be retained. Keep the form open and retry.'
      : 'This form could not be saved for recovery. Keep it open and retry; existing drafts were not replaced.' });
  };
  const resumePending = () => {
    if (!destroyed && !submitting && state.status !== 'unknown' && editRevision !== storedRevision) queueMicrotask(() => { void flush().catch(failure); });
  };

  async function refresh() {
    try {
      const store = await options.storage.read();
      if (destroyed) return;
      emit({ readError: null, candidates: store.records.filter(item => item.caseId === options.caseId && item.form === options.form && item.id !== identity?.id) });
    } catch {
      if (!destroyed) emit({ readError: 'Saved recovery drafts could not be read. Their current contents are unavailable.' });
    }
  }

  async function writeSnapshot(fields: CaseDraftFields, revision: number): Promise<void> {
    const previous = identity;
    const draft: CaseDraftRecord = {
      id: previous?.id ?? uuid(), revision: uuid(), caseId: options.caseId,
      form: options.form, formVersion: version, updatedAt: new Date().toISOString(), fields,
    };
    emit({ status: 'pending', message: 'Saving recovery draft…' });
    writing = options.storage.update(store => replaceCaseDraft(store, draft, previous?.revision ?? null)).then(() => {
      identity = { id: draft.id, revision: draft.revision };
      storedRevision = revision;
      emit({ status: 'saved', message: options.retention === 'document'
        ? 'Practice draft retained on this page only. Not yet added to the practice Case.'
        : 'Draft saved in this workspace. Not yet added to the Case.' });
    }).catch(cause => { failure(cause); throw cause; }).finally(() => { writing = null; });
    await writing;
  }

  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (state.status === 'unknown') return;
    if (writing) { await writing; if (editRevision !== storedRevision && !submitting) return flush(); return; }
    if (state.busy || submitting || editRevision === storedRevision || destroyed) return;
    await writeSnapshot(caseDraftFields(options.readFields()), editRevision);
    if (editRevision !== storedRevision && !submitting) return flush();
  }

  function changed() {
    editRevision++;
    clearTimeout(timer);
    if (state.status === 'unknown') { emit({ edited: true }); return; }
    emit({ edited: true, status: 'pending', message: 'Saving recovery draft…' });
    if (!submitting) timer = setTimeout(() => { void flush().catch(failure); }, 250);
  }

  async function restore(candidate: CaseDraftRecord) {
    if (state.edited || state.busy || state.status === 'unknown') return;
    const revision = editRevision;
    emit({ busy: true });
    try {
      const current = (await options.storage.read()).records.find(item => item.id === candidate.id);
      if (editRevision !== revision) throw new Error('The current form was edited during recovery.');
      if (!current || current.revision !== candidate.revision || current.caseId !== options.caseId || current.form !== options.form || current.formVersion !== version) throw new Error('Draft changed or uses another form version.');
      options.restoreFields(caseDraftFields(current.fields));
      identity = { id: current.id, revision: current.revision };
      editRevision++; storedRevision = editRevision;
      emit({ edited: true, status: 'saved', message: 'Recovered this form. Review it before adding it to the Case.', candidates: state.candidates.filter(item => item.id !== current.id) });
    } catch { emit({ status: 'error', message: 'This saved draft cannot be restored into the current form. It has not been changed.' }); }
    finally { emit({ busy: false }); if (editRevision !== revision) resumePending(); }
  }

  async function discard(candidate?: CaseDraftRecord) {
    if (state.busy || submitting || state.status === 'unknown') return;
    const revision = editRevision;
    clearTimeout(timer); emit({ busy: true });
    try {
      if (writing) await writing;
      const receipt = candidate ?? identity;
      if (receipt) await options.storage.update(store => removeCaseDraft(store, receipt, options.caseId));
      if (!candidate) {
        identity = null; storedRevision = revision;
        if (editRevision === revision) {
          options.resetFields(); emit({ edited: false, status: 'idle', message: 'Draft discarded.' });
        } else emit({ status: 'pending', message: 'The previous draft was discarded. Later edits remain in this form.' });
      }
      await refresh();
    } catch (cause) {
      if (failedLocalMutationOutcome(cause) === 'unknown') failure(cause);
      else emit({ status: 'error', message: 'The draft could not be discarded, or changed in another tab. It has not been replaced.' });
    }
    finally { emit({ busy: false }); if (editRevision !== revision) resumePending(); }
  }

  async function leaveForm(): Promise<boolean> {
    if (submitting || state.busy || state.status === 'unknown') return false;
    const revision = editRevision;
    emit({ busy: true });
    try {
      if (writing) await writing;
      if (editRevision !== storedRevision) await writeSnapshot(caseDraftFields(options.readFields()), revision);
      await refresh();
      if (editRevision !== revision) throw new Error('The current form was edited while changing selection.');
      identity = null; editRevision++; storedRevision = editRevision;
      options.resetFields(); emit({ edited: false, status: 'idle', message: '' });
      void refresh(); return true;
    } catch (cause) { failure(cause); return false; }
    finally { emit({ busy: false }); if (editRevision !== revision) resumePending(); }
  }

  async function submit(write: (receipt: CaseDraftReceipt) => Promise<boolean>): Promise<boolean> {
    if (submitting || state.busy || state.status === 'unknown') return false;
    if (!state.edited) emit({ edited: true, status: 'pending' });
    const submittedRevision = editRevision;
    submitting = true; clearTimeout(timer); emit({ busy: true });
    try {
      // Capture before awaiting storage: later edits must not become this submission.
      const submittedFields = caseDraftFields(options.readFields());
      if (writing) await writing;
      await writeSnapshot(submittedFields, submittedRevision);
      if (!identity) return false;
      const receipt = identity;
      const committed = await write(receipt);
      if (committed) {
        identity = null;
        storedRevision = submittedRevision;
        emit({ edited: editRevision !== submittedRevision, status: 'idle', message: 'Added to the Case. The submitted recovery copy was removed.' });
      }
      return committed;
    } catch (cause) { failure(cause); return false; }
    finally {
      submitting = false; emit({ busy: false });
      if (editRevision !== submittedRevision) resumePending();
    }
  }

  return {
    changed, refresh, flush, restore, discard, leaveForm, submit,
    capture: () => { const revision = editRevision; return () => revision === editRevision && !destroyed; },
    destroy: () => { destroyed = true; clearTimeout(timer); },
  };
}
