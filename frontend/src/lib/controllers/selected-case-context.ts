import type { CaseRecord } from '../analysis/case-model.ts';

export type SelectedCaseContextState = Readonly<{
  id: string;
  phase: 'loading' | 'ready' | 'missing' | 'unavailable';
  record: CaseRecord | null;
}>;

/** One in-flight read, with later requests superseding its view result. */
export function createSelectedCaseContextReader(options: Readonly<{
  selectedId: () => string;
  read: (id: string) => Promise<CaseRecord | null>;
  publish: (state: SelectedCaseContextState) => void;
}>) {
  let revision = 0;
  let stopped = false;
  let running: Promise<void> | null = null;
  let retained: CaseRecord | null = null;

  async function drain(): Promise<void> {
    while (!stopped) {
      const requested = revision;
      const id = options.selectedId();
      if (!id) return;
      options.publish({ id, phase: 'loading', record: retained?.id === id ? retained : null });
      let state: SelectedCaseContextState;
      try {
        const record = await options.read(id);
        if (record && record.id !== id) throw new Error('The requested Case was not returned.');
        state = { id, phase: record ? 'ready' : 'missing', record };
      } catch {
        state = { id, phase: 'unavailable', record: null };
      }
      if (stopped) return;
      if (requested !== revision || id !== options.selectedId()) continue;
      retained = state.record;
      options.publish(state);
      return;
    }
  }

  return Object.freeze({
    refresh(): Promise<void> {
      if (stopped) return Promise.resolve();
      revision += 1;
      if (!running) running = Promise.resolve().then(drain).finally(() => { running = null; });
      return running;
    },
    stop(): void { stopped = true; revision += 1; retained = null; },
  });
}
