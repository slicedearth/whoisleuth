import type { ScanMode, ScanResult } from '../analysis/bulk-result-model.ts';
import type { WatchlistUpdatePreview } from '../analysis/watchlist-store.ts';

export type BulkMonitorScope = 'all' | 'selected' | 'row';
export type BulkMonitorRequest = Readonly<{
  rows: readonly ScanResult[];
  name: string;
  mode: ScanMode;
  profileReady: boolean;
  scope: BulkMonitorScope;
}>;
type MonitorStorage = Readonly<{
  previewSnapshot: typeof import('../watchlists.ts')['previewWatchlistUpdate'];
  saveSnapshot: typeof import('../watchlists.ts')['saveReviewedWatchlistUpdate'];
  saveSingle: typeof import('../watchlists.ts')['saveSingleDomainWatchlist'];
}>;

/** Shared admission; aggregate updates require an exact reviewed transaction. */
export class BulkMonitorActions {
  #busy = false;
  #generation = 0;
  #disposed = false;
  #review: WatchlistUpdatePreview | null = null;
  #pending: Readonly<{ excluded: number; scope: BulkMonitorScope }> | null = null;
  private readonly storage: MonitorStorage;
  readonly #publish: (state: Readonly<{ busy: boolean; review: WatchlistUpdatePreview | null }>) => void;
  constructor(storage: MonitorStorage, publish: (state: Readonly<{ busy: boolean; review: WatchlistUpdatePreview | null }>) => void = () => {}) { this.storage = storage; this.#publish = publish; }
  get state() { return { busy: this.#busy, review: this.#review }; }
  #update(): void { if (!this.#disposed) this.#publish(this.state); }
  cancel(): void { this.#generation++; this.#review = null; this.#pending = null; this.#update(); }
  dispose(): void { this.#disposed = true; this.cancel(); }

  async submit(request: BulkMonitorRequest): Promise<Readonly<{ status: string; clearName: boolean }> | null> {
    if (this.#busy || this.#disposed) return null;
    const { scope, mode, profileReady } = request;
    const rows = [...request.rows];
    const name = request.name.trim();
    const rejected = (status: string) => ({ status, clearName: false });
    if (scope === 'row' && rows.length !== 1) return rejected('The current review row is no longer available.');
    if (!name) return rejected('Enter a watchlist name.');
    if (!profileReady) return rejected('Brand Profile context is unavailable, so trusted and allowlisted exclusions are inconclusive. Reload before saving these results to Monitor.');
    const blocked = rows.filter(row => row.saved.profileContext.sourceState !== 'ready').length;
    if (blocked) return rejected(`Nothing was saved. ${blocked} ${scope === 'selected' ? 'selected' : 'target'} row${blocked === 1 ? ' has' : 's have'} unevaluated Brand Profile context, so this Monitor update was blocked atomically until every target is rescanned.`);
    const findings = rows.filter(row => !row.trusted);
    if (!findings.length) return rejected(scope === 'all'
      ? 'Every result is trusted by the active profile; nothing was added to Monitor.'
      : scope === 'row' ? 'Domains trusted by the active Brand Profile are excluded from watchlists.'
      : 'Select at least one non-trusted result before saving to Monitor.');
    this.#busy = true;
    const generation = ++this.#generation;
    this.#review = null;
    this.#pending = null;
    this.#update();
    try {
      const excluded = rows.length - findings.length;
      if (scope !== 'row') {
        const reviewed = await this.storage.previewSnapshot(name, findings.map(row => row.saved), mode, scope === 'selected' ? 'merge' : 'replace');
        if (this.#disposed || generation !== this.#generation) return null;
        this.#review = reviewed;
        this.#pending = { excluded, scope };
        this.#update();
        return { status: 'Review retained, added and removed Monitor members before confirming. Nothing has been saved yet.', clearName: false };
      }
      const changes = (await this.storage.saveSingle(name, findings[0]!.saved, mode)).changes;
      if (this.#disposed || generation !== this.#generation) return null;
      const status = changes.length
        ? `Updated ${name} with ${findings[0]!.domain} and recorded ${changes.length} material change${changes.length === 1 ? '' : 's'}.`
        : `Saved ${findings[0]!.domain} to ${name}.`;
      return { status, clearName: false };
    } catch (cause) {
      if (this.#disposed || generation !== this.#generation) return null;
      return rejected(cause instanceof Error ? cause.message : 'Could not save the selected results.');
    } finally { this.#busy = false; this.#update(); }
  }

  async confirm(): Promise<Readonly<{ status: string; clearName: boolean }> | null> {
    const reviewed = this.#review, pending = this.#pending;
    if (this.#busy || this.#disposed || !reviewed || !pending) return null;
    const generation = this.#generation;
    this.#busy = true;
    this.#update();
    try {
      const changes = await this.storage.saveSnapshot(reviewed);
      if (this.#disposed || generation !== this.#generation) return null;
      this.#review = null;
      this.#pending = null;
      return { status: `${reviewed.operation === 'merge' ? 'Merged' : 'Saved'} ${reviewed.input.length} explicitly reviewed result${reviewed.input.length === 1 ? '' : 's'} to ${reviewed.name}${changes.length ? `; recorded ${changes.length} material change${changes.length === 1 ? '' : 's'}` : ''}${pending.excluded ? `; excluded ${pending.excluded} trusted domain${pending.excluded === 1 ? '' : 's'}` : ''}.`, clearName: true };
    } catch (cause) {
      if (this.#disposed || generation !== this.#generation) return null;
      this.#review = null;
      this.#pending = null;
      return { status: cause instanceof Error ? cause.message : 'Could not save the reviewed Monitor update.', clearName: false };
    } finally { this.#busy = false; this.#update(); }
  }
}
