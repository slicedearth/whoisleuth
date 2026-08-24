import { BrowserLocalDataError } from '../browser-local-data.ts';

export function rethrowUnknownWorkspaceCommit(cause: unknown): void {
  if (cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_COMMIT_UNKNOWN') throw cause;
}
