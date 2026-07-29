import {
  analystUndoExpired,
  createAnalystUndoDescriptor,
  type AnalystUndoDescriptor,
  type AnalystUndoKind,
} from './analysis/analyst-undo.ts';

export type AnalystUndoAction = AnalystUndoDescriptor & {
  undo: () => Promise<string | void>;
};

export type AnalystUndoResult =
  | { state: 'undone'; message: string }
  | { state: 'expired' | 'unavailable' | 'failed'; message: string };

type UndoListener = (action: AnalystUndoAction | null) => void;

let activeAction: AnalystUndoAction | null = null;
const listeners = new Set<UndoListener>();

function notify(): void {
  for (const listener of listeners) listener(activeAction);
}

export function subscribeAnalystUndo(listener: UndoListener): () => void {
  listeners.add(listener);
  listener(activeAction);
  return () => listeners.delete(listener);
}

export function registerAnalystUndo(input: {
  kind: AnalystUndoKind;
  action: string;
  affectedRecord: string;
  undo: () => Promise<string | void>;
}): AnalystUndoAction {
  activeAction = {
    ...createAnalystUndoDescriptor(input),
    undo: input.undo,
  };
  notify();
  return activeAction;
}

export function expireAnalystUndo(id: string, now = Date.now()): boolean {
  if (!activeAction || activeAction.id !== id || !analystUndoExpired(activeAction, now)) return false;
  activeAction = null;
  notify();
  return true;
}

export function dismissAnalystUndo(id: string): boolean {
  if (!activeAction || activeAction.id !== id) return false;
  activeAction = null;
  notify();
  return true;
}

export async function runAnalystUndo(id: string, now = Date.now()): Promise<AnalystUndoResult> {
  const action = activeAction;
  if (!action || action.id !== id) {
    return { state: 'unavailable', message: 'That undo action is no longer available.' };
  }
  if (analystUndoExpired(action, now)) {
    expireAnalystUndo(id, now);
    return { state: 'expired', message: `Undo expired for ${action.affectedRecord}.` };
  }
  activeAction = null;
  notify();
  try {
    const outcome = await action.undo();
    return {
      state: 'undone',
      message: outcome?.trim() || `Undid ${action.action.toLowerCase()} for ${action.affectedRecord}.`,
    };
  } catch {
    return {
      state: 'failed',
      message: `Could not undo ${action.action.toLowerCase()} for ${action.affectedRecord}.`,
    };
  }
}
