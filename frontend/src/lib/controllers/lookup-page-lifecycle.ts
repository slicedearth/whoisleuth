import type { LookupSession } from './lookup-session.ts';
import type { LookupWorkflowState } from '../console-workflow-state.ts';
import type { LookupTaskView } from '../analysis/lookup-presentation.ts';
import type { LookupAnchorController } from './lookup-anchor-controller.ts';

type Anchor = Pick<
  LookupAnchorController,
  'begin' | 'align' | 'contentReady' | 'stop' | 'captureRevealIntent' | 'destroy'
>;
type Browser = Pick<
  Window,
  'addEventListener' | 'removeEventListener' | 'requestAnimationFrame' | 'cancelAnimationFrame'
>;
type Options = Readonly<{
  session: LookupSession;
  restore: () => { saved: LookupWorkflowState | null; task: LookupTaskView };
  retain: (snapshot: LookupWorkflowState) => void;
  request: { readonly revision: number; dispose(): void };
  savedWorkspaces: readonly { dispose(): void }[];
  createAnchor: () => Anchor;
  refreshProfile: () => Promise<void>;
  refreshSaved: (revision: number) => Promise<void>;
  navigateHash: () => void;
}>;

/** One page lifetime: restore before refresh, release resources before retaining
 * transient state. Domain workspaces still own their writes and stale results. */
export class LookupPageLifecycle {
  readonly #options: Options;
  #active = false;
  #disposed = false;
  #anchor: Anchor | null = null;
  #browser: Browser | null = null;
  #frame: number | null = null;
  #restored = false;
  ready: Promise<void> = Promise.resolve();

  constructor(options: Options) {
    this.#options = options;
  }
  get active(): boolean {
    return this.#active;
  }
  get anchor(): Anchor | null {
    return this.#anchor;
  }

  mount(url: URL, browser: Browser): () => void {
    if (this.#active || this.#disposed)
      throw new Error('Lookup page lifetime has already started.');
    this.#active = true;
    this.#browser = browser;
    try {
      this.#anchor = this.#options.createAnchor();
      const { saved, task } = this.#options.restore();
      this.#options.session.restore(saved, task, url);
      this.#restored = true;
      browser.addEventListener('hashchange', this.#options.navigateHash);
      if (this.#options.session.state.observation.response) {
        this.#frame = browser.requestAnimationFrame(() => {
          this.#frame = null;
          if (this.#active) this.#options.navigateHash();
        });
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
    this.ready = this.#refresh();
    return () => this.dispose();
  }

  async #refresh(): Promise<void> {
    try {
      await this.#options.refreshProfile();
      if (this.#active && this.#options.session.state.observation.response) {
        await this.#options.refreshSaved(this.#options.request.revision);
      }
    } catch {
      if (this.#active)
        this.#options.session.state.error =
          'Saved investigation context could not be refreshed. Saved records were not changed.';
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#active = false;
    if (this.#frame !== null) this.#browser?.cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#browser?.removeEventListener('hashchange', this.#options.navigateHash);
    this.#browser = null;
    this.#options.request.dispose();
    for (const workspace of this.#options.savedWorkspaces) workspace.dispose();
    this.#anchor?.destroy();
    this.#anchor = null;
    if (this.#restored) this.#options.retain(this.#options.session.snapshot());
  }
}
