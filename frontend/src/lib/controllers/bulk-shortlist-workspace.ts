import { parseBoundedJson } from '../bounded-json.ts';
import type { ScanResult } from '../analysis/bulk-result-model.ts';
import type { ShortlistRecord } from '../shortlist.ts';
import type { BrowserLocalCollectionLoadState } from '../browser-local-data-service.ts';
import type { registerAnalystUndo } from '../analyst-undo.ts';

type Storage = Pick<
  typeof import('../shortlist.ts'),
  | 'loadShortlist'
  | 'setShortlistSelection'
  | 'restoreShortlistSelection'
  | 'clearShortlist'
  | 'exportShortlist'
  | 'importShortlist'
  | 'MAX_SHORTLIST_IMPORT_BYTES'
>;
type Selection = Awaited<ReturnType<Storage['setShortlistSelection']>>;
export type BulkShortlistState = Readonly<{
  records: ShortlistRecord[];
  sourceState: BrowserLocalCollectionLoadState;
  status: string;
}>;
type Options = Readonly<{
  loadStorage: () => Promise<Storage>;
  publish: (state: BulkShortlistState) => void;
  confirm: (message: string) => boolean;
  registerUndo: typeof registerAnalystUndo;
  now?: () => string;
}>;

/** Saved shortlist membership, import and undo. Storage owns atomic writes and
 * conflict checks; the route supplies selected result rows and file controls. */
export class BulkShortlistWorkspace {
  readonly #options: Options;
  #storage: Storage | null = null;
  #loading: Promise<void> | null = null;
  #disposed = false;
  #state: BulkShortlistState = { records: [], sourceState: 'idle', status: '' };
  constructor(options: Options) {
    this.#options = options;
  }
  get state(): BulkShortlistState {
    return this.#state;
  }
  dispose(): void {
    this.#disposed = true;
  }
  #update(patch: Partial<BulkShortlistState>): void {
    if (this.#disposed) return;
    this.#state = { ...this.#state, ...patch };
    this.#options.publish(this.#state);
  }
  async ensureLoaded(): Promise<void> {
    if (
      this.#disposed ||
      this.#state.sourceState === 'ready' ||
      this.#state.sourceState === 'unavailable'
    )
      return;
    if (this.#loading) return this.#loading;
    this.#update({ sourceState: 'loading' });
    this.#loading = (async () => {
      try {
        this.#storage = await this.#options.loadStorage();
        if (!this.#disposed)
          this.#update({ records: await this.#storage.loadShortlist(), sourceState: 'ready' });
      } catch {
        this.#update({ sourceState: 'unavailable' });
      } finally {
        this.#loading = null;
      }
    })();
    return this.#loading;
  }
  async #ready(action: string): Promise<Storage | null> {
    await this.ensureLoaded();
    if (this.#disposed) return null;
    if (this.#state.sourceState === 'ready' && this.#storage) return this.#storage;
    this.#update({ status: `The shortlist is unavailable. Reload before ${action}.` });
    return null;
  }
  async toggle(row: ScanResult): Promise<void> {
    await this.ensureLoaded();
    const selected = !this.#state.records.some((record) => record.domain === row.domain);
    if (await this.select([row], selected))
      this.#update({
        status: selected
          ? `Added ${row.domain} to the shortlist.`
          : `Removed ${row.domain} from the shortlist.`,
      });
  }
  async select(rows: readonly ScanResult[], selected = true): Promise<boolean> {
    const storage = await this.#ready('changing the selection');
    if (!storage) return false;
    const domains = new Set(this.#state.records.map((record) => record.domain));
    const affected = selected ? rows : rows.filter((row) => domains.has(row.domain));
    try {
      const result = await storage.setShortlistSelection(
        affected.map((row) => ({
          ...row.saved,
          riskScore: row.risk,
          opportunityScore: row.opportunity,
          savedAt: this.#options.now?.() ?? new Date().toISOString(),
        })),
        selected,
      );
      this.#update({ records: result.records, status: selectionStatus(result, selected) });
      if (result.undo.length)
        this.#options.registerUndo({
          kind: 'shortlist_membership',
          action: selected ? 'Updated shortlist selection' : 'Removed shortlist selection',
          affectedRecord: `${result.undo.length} domain${result.undo.length === 1 ? '' : 's'}`,
          // Undo remains usable after navigation; disposal suppresses only this view.
          undo: async () => {
            const records = await storage.restoreShortlistSelection(result.undo);
            this.#update({ records });
            return `Restored the prior shortlist membership for ${result.undo.length} domain${result.undo.length === 1 ? '' : 's'}.`;
          },
        });
      return result.skipped === 0;
    } catch (cause) {
      this.#update({
        status: cause instanceof Error ? cause.message : 'Could not update the selection.',
      });
      return false;
    }
  }
  async clear(): Promise<void> {
    const storage = await this.#ready('changing it');
    if (
      !storage ||
      !this.#state.records.length ||
      !this.#options.confirm('Remove every domain from the shortlist?')
    )
      return;
    try {
      await storage.clearShortlist();
      this.#update({ records: [], status: 'Shortlist cleared.' });
    } catch (cause) {
      this.#update({
        status: cause instanceof Error ? cause.message : 'Could not clear the shortlist.',
      });
    }
  }
  async download(): Promise<void> {
    const storage = await this.#ready('exporting it');
    if (!storage) return;
    try {
      await storage.exportShortlist();
    } catch (cause) {
      this.#update({
        status: cause instanceof Error ? cause.message : 'Could not export the shortlist.',
      });
    }
  }
  async import(file: Pick<File, 'size' | 'text'>): Promise<void> {
    const storage = await this.#ready('importing');
    if (!storage) return;
    let committed = false;
    try {
      const maximumBytes = storage.MAX_SHORTLIST_IMPORT_BYTES;
      if (file.size > maximumBytes) throw new Error('Shortlist imports are limited to 2 MB.');
      const result = await storage.importShortlist(
        parseBoundedJson(await file.text(), { label: 'Shortlist import', maximumBytes }),
      );
      committed = true;
      const records = await storage.loadShortlist();
      const skipped = result.skipped
        ? `; skipped ${result.skipped} invalid, duplicate, or over-limit entr${result.skipped === 1 ? 'y' : 'ies'}`
        : '';
      this.#update({
        records,
        status: `Imported ${result.added} new and ${result.updated} updated shortlist entries${skipped}.`,
      });
    } catch (cause) {
      this.#update(
        committed
          ? {
              sourceState: 'unavailable',
              status:
                'The shortlist import was saved, but the list could not be refreshed. Reload before changing it; do not import it again.',
            }
          : { status: cause instanceof Error ? cause.message : 'Shortlist import failed' },
      );
    }
  }
}

function selectionStatus(result: Selection, selected: boolean): string {
  if (!selected)
    return `Removed ${result.removed} domain${result.removed === 1 ? '' : 's'} from the shortlist.`;
  const changed = result.added + result.updated;
  const skipped = result.skipped
    ? `; skipped ${result.skipped} invalid or over-limit row${result.skipped === 1 ? '' : 's'}`
    : '';
  return `Selected ${result.added} new and refreshed ${result.updated} existing domain${changed === 1 ? '' : 's'}${skipped}.`;
}
