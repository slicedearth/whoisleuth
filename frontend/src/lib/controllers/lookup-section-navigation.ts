import { lookupEvidenceFamilyForHref, lookupEvidenceTargetForHref } from '../analysis/lookup-page-actions.ts';
import type { LookupAnchorController } from './lookup-anchor-controller.ts';

type Options = Readonly<{
  expanded: () => readonly string[];
  publish: (sections: string[]) => void;
  sections: () => readonly Readonly<{ href: string }>[];
  preload: (section: string) => void;
  anchor: () => Pick<LookupAnchorController, 'begin' | 'align' | 'contentReady'> | null;
  hash: () => string;
  replaceHash: (href: string) => void;
  rendered: () => Promise<void>;
}>;

/** Section buttons, evidence links and restored hashes use the same sequence:
 * establish scroll ownership, reveal/preload, render, then align. */
export class LookupSectionNavigation {
  readonly #options: Options;
  constructor(options: Options) { this.#options = options; }

  #sections(): string[] {
    return this.#options.sections().map(section => section.href.slice(1)).filter(section => section !== 'overview');
  }
  visible(section: string): boolean { return this.#options.expanded().includes(section); }
  allVisible(): boolean { const sections = this.#sections(); return sections.length > 0 && sections.every(section => this.visible(section)); }
  anyVisible(): boolean { return this.#sections().some(section => this.visible(section)); }

  async navigate(href: string, expand = true): Promise<void> {
    const family = lookupEvidenceFamilyForHref(href);
    if (!family) return;
    const target = lookupEvidenceTargetForHref(href);
    this.#options.replaceHash(target);
    this.#options.anchor()?.begin(target, `#${family}`);
    if (expand) this.#options.preload(family);
    const expanded = this.#options.expanded();
    this.#options.publish(expand && family !== 'overview'
      ? expanded.includes(family) ? [...expanded] : [...expanded, family]
      : expanded.filter(section => section !== family));
    await this.#options.rendered();
    this.#options.anchor()?.align();
  }

  async setAll(expand: boolean): Promise<void> {
    const href = lookupEvidenceTargetForHref(this.#options.hash());
    const family = lookupEvidenceFamilyForHref(href);
    const realign = family ? this.#options.anchor()?.begin(href, `#${family}`) : false;
    const sections = expand ? this.#sections() : [];
    for (const section of sections) this.#options.preload(section);
    this.#options.publish(sections);
    if (realign) {
      await this.#options.rendered();
      this.#options.anchor()?.align();
    }
  }

  async contentReady(): Promise<void> {
    await this.#options.rendered();
    this.#options.anchor()?.contentReady();
  }

  /** Preserve normal modified-click/browser navigation for every other link. */
  links(node: HTMLElement): Readonly<{ destroy: () => void }> {
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const href = event.target.closest<HTMLAnchorElement>('a[href^="#"]')?.getAttribute('href') ?? '';
      if (!lookupEvidenceFamilyForHref(href)) return;
      event.preventDefault();
      void this.navigate(href);
    };
    node.addEventListener('click', click);
    return { destroy: () => node.removeEventListener('click', click) };
  }
}
