import type { BrandProfile } from '../../../../packages/workspace/brand-profile-model.mts';
import { parseProfileList } from '../analysis/brand-profile-signals.ts';
import { normalizePageBaseline } from '../analysis/page-baseline.ts';
import { createDraftRevision } from './submitted-draft.ts';

function editorValues(profile: BrandProfile | null, official = '') {
  return {
    name: profile?.name ?? '',
    official: profile?.officialDomains.join('\n') ?? official,
    products: profile?.productNames.join(', ') ?? '',
    tlds: profile?.tlds.join(', ') ?? 'com, net, org',
    partners: profile?.approvedPartnerDomains.join('\n') ?? '',
    selectors: profile?.dkimSelectors.join(', ') ?? '',
    retiredSelectors: profile?.retiredDkimSelectors.join(', ') ?? '',
    mailProtectionProfile: profile?.mailProtectionProfile ?? 'standard',
    trademarkOwner: profile?.trademarkOwner ?? '',
    trademarkRegistration: profile?.trademarkRegistration ?? '',
    faviconHash: profile?.officialFaviconHash ?? '',
  } satisfies Record<string, string>;
}

export type BrandEditorValues = ReturnType<typeof editorValues>;
export type BrandEditorField = keyof BrandEditorValues;
export type BrandProfileCommitIssue = 'active-preference' | 'reread' | null;
export type BrandEditorSaveResult = Readonly<{
  profile: BrandProfile;
  issue: BrandProfileCommitIssue;
}>;
export type BrandEditorSubmission = Readonly<{
  profile: Partial<BrandProfile>;
  editingId: string;
  expected: BrandProfile | null;
}>;
export type BrandEditorState = Readonly<{
  visible: boolean;
  identity: string;
  editingId: string;
  expected: BrandProfile | null;
  values: BrandEditorValues;
  officialChannels: BrandProfile['officialChannels'];
  rightsReferences: BrandProfile['rightsReferences'];
  baseline: BrandProfile['pageBaseline'];
  faviconPHash: string;
  saving: boolean;
  capturing: boolean;
}>;

const CAPTURING_MESSAGE = 'Capturing official-site identity…';
type BrandEditorOptions = Readonly<{
  publish: (state: BrandEditorState) => void;
  message: (value: string) => void;
  clearMessage: (expected: string) => void;
  createId?: () => string;
}>;

/** Owns one form draft; persistence and collection admission remain with the route's coordinators. */
export class BrandProfileEditorController {
  #state: BrandEditorState = {
    visible: false,
    identity: '',
    editingId: '',
    expected: null,
    values: editorValues(null),
    officialChannels: [],
    rightsReferences: [],
    baseline: null,
    faviconPHash: '',
    saving: false,
    capturing: false,
  };
  readonly #revision = createDraftRevision(() => this.#state.identity);
  #capture: AbortController | null = null;
  #disposed = false;

  readonly options: BrandEditorOptions;
  constructor(options: BrandEditorOptions) {
    this.options = options;
  }

  get state(): BrandEditorState {
    return this.#state;
  }

  #update(patch: Partial<BrandEditorState>): void {
    if (this.#disposed) return;
    this.#state = { ...this.#state, ...patch };
    this.options.publish(this.#state);
  }

  unchanged(): () => boolean {
    return this.#revision.capture();
  }

  #open(profile: BrandProfile | null, official = ''): void {
    this.#revision.changed();
    this.cancelCapture();
    const detached = profile ? structuredClone(profile) : null;
    this.#update({
      visible: true,
      identity: detached?.id ?? (this.options.createId ?? crypto.randomUUID.bind(crypto))(),
      editingId: detached?.id ?? '',
      expected: detached,
      values: editorValues(detached, official),
      officialChannels: detached?.officialChannels.map((value) => ({ ...value })) ?? [],
      rightsReferences: detached?.rightsReferences.map((value) => ({ ...value })) ?? [],
      baseline: normalizePageBaseline(detached?.pageBaseline),
      faviconPHash: detached?.officialFaviconPHash ?? '',
    });
  }

  create(official = ''): void {
    this.#open(null, official);
  }
  edit(profile: BrandProfile): void {
    this.#open(profile);
  }

  close(): void {
    if (this.#state.saving) return;
    this.cancelCapture();
    this.#update({ visible: false });
  }

  setValue(field: BrandEditorField, value: string): void {
    this.#revision.changed();
    const values = { ...this.#state.values, [field]: value };
    if (field === 'official') {
      const previous = parseProfileList(this.#state.values.official, true)[0] ?? '';
      const next = parseProfileList(value, true)[0] ?? '';
      if (previous !== next) {
        this.cancelCapture();
        if (this.#state.baseline?.domain !== next) {
          this.#update({
            values: { ...values, faviconHash: '' },
            faviconPHash: '',
            baseline: null,
          });
          return;
        }
      }
    }
    this.#update({ values });
  }

  setOfficialChannels(value: BrandProfile['officialChannels']): void {
    this.#revision.changed();
    this.#update({ officialChannels: structuredClone(value) });
  }

  setRightsReferences(value: BrandProfile['rightsReferences']): void {
    this.#revision.changed();
    this.#update({ rightsReferences: structuredClone(value) });
  }

  saveAsNew(): void {
    this.#revision.changed();
    this.cancelCapture();
    this.#update({
      editingId: '',
      expected: null,
      identity: (this.options.createId ?? crypto.randomUUID.bind(crypto))(),
    });
  }

  removed(id: string, unchanged: () => boolean): void {
    if (this.#state.editingId !== id || !unchanged()) return;
    this.cancelCapture();
    this.#update({ editingId: '', expected: null, visible: false });
  }

  #submission(): BrandEditorSubmission {
    const {
      values,
      identity,
      editingId,
      expected,
      officialChannels,
      rightsReferences,
      faviconPHash,
      baseline,
    } = this.#state;
    return {
      profile: {
        id: identity,
        name: values.name,
        officialDomains: parseProfileList(values.official, true),
        productNames: parseProfileList(values.products),
        tlds: parseProfileList(values.tlds, true),
        approvedPartnerDomains: parseProfileList(values.partners, true),
        dkimSelectors: parseProfileList(values.selectors, true),
        retiredDkimSelectors: parseProfileList(values.retiredSelectors, true),
        mailProtectionProfile:
          values.mailProtectionProfile as BrandProfile['mailProtectionProfile'],
        trademarkOwner: values.trademarkOwner,
        trademarkRegistration: values.trademarkRegistration,
        officialChannels: structuredClone(officialChannels),
        rightsReferences: structuredClone(rightsReferences),
        officialFaviconHash: values.faviconHash,
        officialFaviconPHash: faviconPHash,
        pageBaseline: structuredClone(baseline),
      },
      editingId,
      expected: expected ? structuredClone(expected) : null,
    };
  }

  async save(
    write: (submission: BrandEditorSubmission) => Promise<BrandEditorSaveResult>,
  ): Promise<BrandEditorSaveResult | null> {
    if (this.#disposed || this.#state.saving) return null;
    this.cancelCapture();
    const submitted = this.#submission();
    const unchanged = this.unchanged();
    this.#update({ saving: true });
    try {
      const result = await write(submitted);
      if (this.#state.identity === submitted.profile.id) {
        this.#update({
          editingId: result.profile.id,
          expected: structuredClone(result.profile),
          visible: !unchanged() || result.issue !== null,
        });
      }
      return result;
    } finally {
      this.#update({ saving: false });
    }
  }

  cancelCapture(): void {
    this.#capture?.abort();
    this.#capture = null;
    this.#update({ capturing: false });
    this.options.clearMessage(CAPTURING_MESSAGE);
  }

  async capture(
    collect: (domain: string, signal: AbortSignal) => Promise<BrandProfile['pageBaseline']>,
  ): Promise<void> {
    if (this.#disposed) return;
    const domain = parseProfileList(this.#state.values.official, true)[0];
    if (!domain) {
      this.options.message('Enter an official domain first.');
      return;
    }
    this.cancelCapture();
    const identity = this.#state.identity;
    const controller = new AbortController();
    this.#capture = controller;
    const ownsRequest = () => !this.#disposed && this.#capture === controller;
    const canPublish = () =>
      ownsRequest() &&
      this.#state.visible &&
      this.#state.identity === identity &&
      parseProfileList(this.#state.values.official, true)[0] === domain;
    this.#update({ capturing: true });
    this.options.message(CAPTURING_MESSAGE);
    try {
      const baseline = await collect(domain, controller.signal);
      if (!canPublish()) return;
      if (!baseline) {
        this.options.message(
          `No page fingerprint baseline was available for ${domain}.${this.#state.baseline ? ' The existing baseline is unchanged.' : ''}`,
        );
        return;
      }
      this.#update({
        values: { ...this.#state.values, faviconHash: baseline.faviconHash || '' },
        faviconPHash: baseline.faviconPHash || '',
        baseline,
      });
      this.options.message(
        `Captured a ${baseline.complete ? 'complete' : 'partial'} page baseline for ${domain}. Save the profile to retain it.`,
      );
    } catch (cause) {
      if (canPublish() && !controller.signal.aborted)
        this.options.message(
          cause instanceof Error ? cause.message : 'Official-site capture failed',
        );
    } finally {
      if (ownsRequest()) {
        this.#capture = null;
        this.#update({ capturing: false });
      }
    }
  }

  dispose(): void {
    this.cancelCapture();
    this.#disposed = true;
  }
}
