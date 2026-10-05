import { MAX_DOMAIN_INPUT_BYTES, parseDomainInput } from '../analysis/utils.ts';
import { createDraftRevision } from './submitted-draft.ts';

type DomainFile = Pick<File, 'name' | 'size' | 'text'>;
type Publication = Readonly<{ input?: string; status: string }>;

/** File reading belongs to one queue draft, not to a later edit or admitted run. */
export class BulkDomainImport {
  readonly #revision = createDraftRevision(() => 'bulk-queue');
  readonly #publish: (value: Publication) => void;
  #disposed = false;
  constructor(publish: (value: Publication) => void) { this.#publish = publish; }
  changed(): void { this.#revision.changed(); }
  dispose(): void { this.#disposed = true; this.changed(); }

  async import(file: DomainFile): Promise<void> {
    if (this.#disposed) return;
    this.changed();
    const unchanged = this.#revision.capture();
    const current = () => !this.#disposed && unchanged();
    try {
      if (file.size > MAX_DOMAIN_INPUT_BYTES) throw new Error('Domain-list imports are limited to 2 MB.');
      const text = await file.text();
      if (!current()) return;
      const parsed = parseDomainInput(text);
      if (parsed.tooLarge) throw new Error('The domain-list file exceeds the bounded row or cell limit.');
      if (!parsed.entries.length) throw new Error('No domain entries were found in that file.');
      this.#publish({
        input: parsed.entries.join('\n'),
        status: `Loaded ${parsed.entries.length} unique entries from ${file.name}${parsed.usedHeader ? ' using its domain column' : ''}${parsed.duplicates ? `; removed ${parsed.duplicates} duplicate${parsed.duplicates === 1 ? '' : 's'}` : ''}.`,
      });
    } catch (cause) {
      if (current()) this.#publish({ status: cause instanceof Error ? cause.message : 'Could not import the domain list.' });
    }
  }
}
