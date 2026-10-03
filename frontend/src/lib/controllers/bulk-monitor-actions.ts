import type { ScanMode, ScanResult } from '../analysis/bulk-result-model.ts';

export type BulkMonitorScope = 'all' | 'selected' | 'row';
export type BulkMonitorRequest = Readonly<{
  rows: readonly ScanResult[];
  name: string;
  mode: ScanMode;
  profileReady: boolean;
  scope: BulkMonitorScope;
}>;

/** All three entry points share one atomic eligibility check and one write. */
export class BulkMonitorActions {
  #busy = false;
  private readonly save: typeof import('../watchlists.ts')['saveWatchlist'];
  constructor(save: typeof import('../watchlists.ts')['saveWatchlist']) { this.save = save; }

  async submit(request: BulkMonitorRequest): Promise<Readonly<{ status: string; clearName: boolean }> | null> {
    if (this.#busy) return null;
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
    try {
      const changes = await this.save(name, findings.map(row => row.saved), mode);
      const excluded = rows.length - findings.length;
      const suffix = excluded ? `; excluded ${excluded} trusted domain${excluded === 1 ? '' : 's'}` : '';
      let status: string;
      if (scope === 'row') status = changes.length
        ? `Updated ${name} with ${findings[0]!.domain} and recorded ${changes.length} material change${changes.length === 1 ? '' : 's'}.`
        : `Saved ${findings[0]!.domain} to ${name}.`;
      else if (scope === 'selected') status = `Saved ${findings.length} explicitly selected result${findings.length === 1 ? '' : 's'} to ${name}.`;
      else status = changes.length
        ? `Updated ${name} and recorded ${changes.length} material change${changes.length === 1 ? '' : 's'}${suffix}.`
        : `Saved ${findings.length} result${findings.length === 1 ? '' : 's'} to ${name}${suffix}.`;
      return { status, clearName: scope !== 'row' };
    } catch (cause) {
      return rejected(cause instanceof Error ? cause.message : 'Could not save the selected results.');
    } finally { this.#busy = false; }
  }
}
