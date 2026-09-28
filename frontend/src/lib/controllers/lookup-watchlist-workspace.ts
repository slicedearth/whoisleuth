import {
  buildLookupWatchlistRecord,
  defaultLookupWatchlistName,
  lookupWatchlistsForDomain,
} from '../analysis/lookup-watchlist-handoff.ts';
import { createLookupWatchlistState, type LookupWatchlistState } from './lookup-view-state.ts';
import type { loadWatchlists, saveSingleDomainWatchlist } from '../watchlists.ts';

type Context = Readonly<{ target: string; revision: number; evidence: unknown; depth: 'fast' | 'deep' }>;
type Options = Readonly<{
  context: () => Context;
  load: typeof loadWatchlists;
  save: typeof saveSingleDomainWatchlist;
  publish: (state: LookupWatchlistState) => void;
}>;

/** Owns the Lookup watchlist draft, reads and save publication. Storage remains
 * with the transactional watchlist adapter; a late result cannot change targets. */
export class LookupWatchlistWorkspace {
  readonly #options: Options;
  #state = createLookupWatchlistState();
  #read = 0;
  #write = 0;
  #disposed = false;

  constructor(options: Options) { this.#options = options; }
  get state(): LookupWatchlistState { return this.#state; }

  #publish(next: LookupWatchlistState): void {
    if (this.#disposed) return;
    this.#state = next;
    this.#options.publish(next);
  }

  #update(patch: Partial<LookupWatchlistState>): void { this.#publish({ ...this.#state, ...patch }); }

  #current(context: Context): boolean {
    const current = this.#options.context();
    return !this.#disposed && context.revision === current.revision && context.target === current.target;
  }

  setName(name: string): void { this.#update({ name }); }

  reset(preserveDraft = false): void {
    this.#read++;
    this.#write++;
    this.#publish(createLookupWatchlistState(preserveDraft ? this.#state : undefined));
  }

  dispose(): void {
    this.#read++;
    this.#write++;
    this.#disposed = true;
  }

  async refresh(expectedRevision?: number): Promise<void> {
    const context = this.#options.context();
    if (this.#disposed || expectedRevision !== undefined && expectedRevision !== context.revision) return;
    const read = ++this.#read;
    const targetChanged = context.target !== this.#state.target;
    if (!context.target) {
      this.#update({ names: [], sourceState: 'ready', target: '', name: '' });
      return;
    }
    this.#update({ sourceState: 'loading', ...(targetChanged ? {
      names: [], name: defaultLookupWatchlistName(context.target), target: context.target,
    } : {}) });
    try {
      const all = await this.#options.load();
      if (read !== this.#read || !this.#current(context)) return;
      const names = lookupWatchlistsForDomain(all, context.target);
      this.#update({ names, sourceState: 'ready',
        name: names.length === 1 && (targetChanged || !this.#state.name.trim()) ? names[0]! : this.#state.name });
    } catch {
      if (read === this.#read && this.#current(context)) this.#update({ sourceState: 'unavailable' });
    }
  }

  async save(): Promise<void> {
    if (this.#disposed || this.#state.busy) return;
    const context = this.#options.context();
    const name = this.#state.name;
    const record = buildLookupWatchlistRecord(context.target, context.evidence, context.depth);
    if (!record) {
      this.#update({ status: 'The current Lookup result cannot be saved as a domain watchlist observation.' });
      return;
    }
    const write = ++this.#write;
    this.#read++;
    this.#update({ busy: true });
    try {
      const saved = await this.#options.save(name, record, context.depth);
      if (write !== this.#write || !this.#current(context)) return;
      this.#update({ name: saved.name, status: saved.created
        ? `Created the watchlist “${saved.name}” with this ${context.depth} observation.`
        : saved.changes.length
          ? `Updated “${saved.name}” and retained ${saved.changes.length} material change${saved.changes.length === 1 ? '' : 's'}.`
          : `Updated “${saved.name}”; no comparable material change was observed.` });
      // Refresh failure changes source readiness, not the already committed save.
      await this.refresh(context.revision);
    } catch (cause) {
      if (write === this.#write && this.#current(context)) {
        this.#update({ status: cause instanceof Error ? cause.message : 'Could not save the watchlist observation.' });
      }
    } finally {
      if (write === this.#write) this.#update({ busy: false });
    }
  }
}
