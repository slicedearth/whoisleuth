import {
  bulkSessionInputDigest,
  createBulkSessionId,
  toBulkSessionResult,
  type ScanMode,
  type ScanResult,
} from '../analysis/bulk-result-model.ts';
import { summarizeBulkProfileContexts } from '../analysis/bulk-session-model.ts';
import type { BulkSession, BulkSessionSavePreview } from '../bulk-sessions.ts';
import type { BrowserLocalCollectionLoadState } from '../browser-local-data-service.ts';
import { failedLocalMutationOutcome } from '../local-mutation-outcome.ts';
import { MAX_BULK_SESSION_ROWS } from '../../../../packages/contracts/workspace-portability.mts';
import { normalizeDomain } from '../../../../packages/evidence/domain-name.mts';

type Storage = Pick<
  typeof import('../bulk-sessions.ts'),
  | 'loadBulkSessions'
  | 'saveBulkSession'
  | 'deleteBulkSession'
  | 'exportBulkSessions'
  | 'BulkSessionCapacityError'
>;
type Scan = Readonly<{
  running: boolean;
  results: readonly ScanResult[];
  cancelled: boolean;
}>;
export type BulkSessionInput = Readonly<{ mode: ScanMode; domains: readonly string[] }>;
function snapshotInput(input: BulkSessionInput): BulkSessionInput {
  if (!['fast', 'deep'].includes(input.mode) || !Array.isArray(input.domains)
    || !input.domains.length || input.domains.length > MAX_BULK_SESSION_ROWS) {
    throw new Error('The admitted Bulk input exceeds the supported session bounds.');
  }
  const domains = input.domains.map(domain => normalizeDomain(domain));
  if (domains.some(domain => domain === null)) throw new Error('The admitted Bulk input contains an invalid domain.');
  return Object.freeze({ mode: input.mode, domains: Object.freeze([...new Set(domains as string[])]) });
}
export type BulkSessionWorkspaceState = Readonly<{
  sessions: BulkSession[];
  sourceState: BrowserLocalCollectionLoadState;
  name: string;
  status: string;
  currentId: string;
  startedAt: string;
  busy: boolean;
  retention: BulkSessionSavePreview | null;
  refreshRequired: boolean;
  input: BulkSessionInput | null;
}>;
type Options = Readonly<{
  loadStorage: () => Promise<Storage>;
  scan: () => Scan;
  publish: (state: BulkSessionWorkspaceState) => void;
  confirm: (message: string) => boolean;
  now?: () => string;
}>;

/** Owns the saved-session draft, admission and mutation outcome. The scan
 * controller owns collection; the storage adapter owns transactions/conflicts. */
export class BulkSessionWorkspace {
  readonly #options: Options;
  #storage: Storage | null = null;
  #loading: Promise<void> | null = null;
  #disposed = false;
  #state: BulkSessionWorkspaceState = {
    sessions: [],
    sourceState: 'idle',
    name: '',
    status: '',
    currentId: '',
    startedAt: '',
    busy: false,
    retention: null,
    refreshRequired: false,
    input: null,
  };

  constructor(options: Options) {
    this.#options = options;
  }
  get state(): BulkSessionWorkspaceState {
    return this.#state;
  }
  #now(): string {
    return this.#options.now?.() ?? new Date().toISOString();
  }
  #update(patch: Partial<BulkSessionWorkspaceState>): void {
    if (this.#disposed) return;
    this.#state = { ...this.#state, ...patch };
    this.#options.publish(this.#state);
  }
  dispose(): void {
    this.#disposed = true;
  }
  setName(name: string): void {
    this.#update({ name, retention: null });
  }
  setStatus(status: string): void {
    this.#update({ status });
  }

  /** A scan and a saved-session write must never race over the active result. */
  beginScan(replace: boolean, input: BulkSessionInput): boolean {
    if (this.#disposed || this.#state.busy) return false;
    let admitted: BulkSessionInput;
    try {
      admitted = snapshotInput(input);
      if (!replace && this.#state.input) admitted = snapshotInput({
        mode: admitted.mode,
        domains: [...new Set([...this.#state.input.domains, ...admitted.domains])],
      });
    } catch (cause) {
      this.setStatus(cause instanceof Error ? cause.message : 'The Bulk input could not be admitted.');
      return false;
    }
    this.#update({
      retention: null,
      input: admitted,
      ...(replace
        ? {
            currentId: '',
            name: this.#state.currentId ? '' : this.#state.name,
            startedAt: this.#now(),
          }
        : {}),
    });
    return true;
  }

  /** Navigation restores the result input separately from the next-run queue. */
  restoreInput(input: BulkSessionInput | null): void {
    if (this.#disposed || this.#state.busy || this.#options.scan().running) return;
    this.#update({ input: input ? snapshotInput(input) : null });
  }

  select(session: BulkSession): boolean {
    if (this.#disposed || this.#state.busy) return false;
    if (this.#options.scan().running) {
      this.setStatus('Cancel or wait for the active scan before loading a saved session.');
      return false;
    }
    this.#update({
      currentId: session.id,
      name: session.name,
      startedAt: session.startedAt,
      retention: null,
      input: snapshotInput(session),
    });
    return true;
  }

  async ensureLoaded(): Promise<void> {
    if (this.#disposed || this.#state.sourceState === 'ready') return;
    if (this.#loading) return this.#loading;
    this.#update({ sourceState: 'loading' });
    this.#loading = (async () => {
      try {
        const storage = this.#storage ?? (await this.#options.loadStorage());
        if (this.#disposed) return;
        this.#storage = storage;
        this.#update({ sessions: await storage.loadBulkSessions(), sourceState: 'ready' });
      } catch {
        this.#update({ sourceState: 'unavailable' });
      } finally {
        this.#loading = null;
      }
    })();
    return this.#loading;
  }

  async #persist(session: unknown, retention?: BulkSessionSavePreview): Promise<void> {
    const storage = this.#storage;
    if (!storage || this.#disposed) return;
    try {
      const expected =
        this.#state.sessions.find((value) => value.id === this.#state.currentId) ?? null;
      const result = await storage.saveBulkSession(session, {
        expected,
        ...(retention ? { retention } : {}),
      });
      this.#update({ currentId: result.session.id, retention: null });
      const saved = `${result.added ? 'Saved' : 'Updated'} ${result.session.name}.${result.pruned ? ` Removed ${result.pruned} reviewed session${result.pruned === 1 ? '' : 's'}.` : ''}`;
      if (this.#disposed) return;
      try {
        this.#update({ sessions: await storage.loadBulkSessions(), status: saved });
      } catch {
        this.#update({
          refreshRequired: true,
          status: `${saved} Refreshing the saved list failed. Reload it; do not repeat the save.`,
        });
      }
    } catch (cause) {
      if (cause instanceof storage.BulkSessionCapacityError) {
        this.#update({ retention: cause.preview, status: cause.message });
      } else if (failedLocalMutationOutcome(cause) === 'unknown') {
        this.#update({
          refreshRequired: true,
          retention: null,
          status:
            'Saving could not be confirmed. The session may already be stored. Reload the saved list and review it before trying again.',
        });
      } else
        this.setStatus(cause instanceof Error ? cause.message : 'Could not save the Bulk session.');
    }
  }

  async save(): Promise<void> {
    if (this.#disposed || this.#state.busy || this.#state.refreshRequired) return;
    const scan = this.#options.scan();
    if (scan.running) return;
    const name = this.#state.name.trim();
    const input = this.#state.input;
    if (!input) {
      this.setStatus('The original admitted input is unavailable. Start a new scan or load a saved session before saving.');
      return;
    }
    const domains = [...input.domains];
    if (!name || !domains.length || !scan.results.length) {
      this.setStatus('Enter a session name and complete at least one result before saving.');
      return;
    }
    this.#update({ busy: true });
    try {
      // Snapshot before any await: editing the queue cannot change a submitted save.
      const results = scan.results.map(toBulkSessionResult);
      const settled = new Set(results.map((row) => row.domain));
      // Stored state describes retained row coverage, not the last refresh attempt.
      const complete = domains.every((domain) => settled.has(domain));
      const now = this.#now();
      const session = {
        id: this.#state.currentId || createBulkSessionId(),
        name,
        mode: input.mode,
        state: complete ? 'complete' : scan.cancelled ? 'cancelled' : 'partial',
        domains,
        results,
        profileContext: summarizeBulkProfileContexts(results),
        startedAt: this.#state.startedAt || now,
        updatedAt: now,
        completedAt: complete ? now : null,
      };
      await this.ensureLoaded();
      if (this.#disposed) return;
      if (this.#state.sourceState !== 'ready') {
        this.setStatus('Saved Bulk sessions are unavailable. Reload before saving.');
        return;
      }
      await this.#persist({
        ...session,
        inputDigest: await bulkSessionInputDigest(domains, session.mode),
      });
    } catch (cause) {
      this.setStatus(
        cause instanceof Error ? cause.message : 'Could not prepare the Bulk session.',
      );
    } finally {
      this.#update({ busy: false });
    }
  }

  async confirmRetention(): Promise<void> {
    if (
      this.#disposed ||
      this.#state.busy ||
      this.#state.refreshRequired ||
      this.#options.scan().running
    )
      return;
    const retention = this.#state.retention;
    if (!retention) return;
    this.#update({ busy: true });
    try {
      await this.#persist(retention.session, retention);
    } finally {
      this.#update({ busy: false });
    }
  }

  cancelRetention(): void {
    if (this.#state.busy) return;
    this.#update({
      retention: null,
      status:
        'Save cancelled. Saved sessions were not changed; the current results remain available.',
    });
  }

  async refresh(): Promise<void> {
    if (this.#disposed || this.#state.busy || !this.#storage) return;
    this.#update({ busy: true });
    try {
      this.#update({
        sessions: await this.#storage.loadBulkSessions(),
        sourceState: 'ready',
        refreshRequired: false,
        status: 'Saved sessions reloaded. Review the list before saving again.',
      });
    } catch {
      this.setStatus(
        'Saved sessions could not be reloaded. The previous save outcome has not changed.',
      );
    } finally {
      this.#update({ busy: false });
    }
  }

  async remove(session: BulkSession): Promise<void> {
    if (this.#disposed || this.#state.busy) return;
    if (this.#options.scan().running) {
      this.setStatus('Cancel or wait for the active scan before deleting a saved session.');
      return;
    }
    if (!this.#options.confirm(`Delete the saved session “${session.name}”?`)) return;
    this.#update({ busy: true });
    try {
      await this.ensureLoaded();
      if (!this.#storage || this.#disposed || this.#state.sourceState !== 'ready') return;
      const sessions = await this.#storage.deleteBulkSession(session);
      this.#update({
        sessions,
        ...(this.#state.currentId === session.id
          ? { currentId: '', name: '', retention: null }
          : {}),
        status: `Deleted ${session.name}.`,
      });
    } catch (cause) {
      this.setStatus(cause instanceof Error ? cause.message : 'Could not delete the Bulk session.');
    } finally {
      this.#update({ busy: false });
    }
  }

  async export(): Promise<void> {
    if (this.#disposed || this.#state.busy) return;
    this.#update({ busy: true });
    try {
      await this.ensureLoaded();
      if (!this.#storage || this.#disposed || this.#state.sourceState !== 'ready') return;
      await this.#storage.exportBulkSessions();
      this.setStatus(
        `Exported ${this.#state.sessions.length} saved session${this.#state.sessions.length === 1 ? '' : 's'}.`,
      );
    } catch (cause) {
      this.setStatus(
        cause instanceof Error ? cause.message : 'Could not export saved Bulk sessions.',
      );
    } finally {
      this.#update({ busy: false });
    }
  }
}
