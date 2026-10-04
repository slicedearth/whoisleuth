import { snapshotSelectedCaseIds, type RiskCalibrationExportPreview } from '../analysis/risk-calibration-export.ts';
import { createDraftRevision } from './submitted-draft.ts';

export type CalibrationExportState = Readonly<{ preview: RiskCalibrationExportPreview | null; busy: boolean }>;
type Options = Readonly<{
  preview: (ids: readonly string[]) => Promise<RiskCalibrationExportPreview>;
  download: (reviewed: RiskCalibrationExportPreview) => Promise<{ included: number; excluded: number }>;
  publish: (state: CalibrationExportState) => void;
  status: (message: string) => void;
}>;

/** Owns delayed review publication and the exact reviewed local download. */
export class CalibrationExportWorkspace {
  readonly #options: Options;
  readonly #revision = createDraftRevision(() => 'calibration-export');
  #disposed = false;
  #state: CalibrationExportState = { preview: null, busy: false };
  constructor(options: Options) { this.#options = options; }
  get state(): CalibrationExportState { return this.#state; }
  #update(patch: Partial<CalibrationExportState>) {
    if (this.#disposed) return;
    this.#state = { ...this.#state, ...patch };
    this.#options.publish(this.#state);
  }
  changed(): void { this.#revision.changed(); this.#update({ preview: null }); }
  cancel(): void { if (!this.#state.busy) this.changed(); }
  dispose(): void { this.#disposed = true; this.#revision.changed(); }

  async review(ids: readonly string[]): Promise<void> {
    if (this.#disposed || this.#state.busy) return;
    this.changed();
    const unchanged = this.#revision.capture();
    try {
      const selected = snapshotSelectedCaseIds(ids);
      const preview = await this.#options.preview(selected);
      if (!this.#disposed && unchanged()) this.#update({ preview });
    } catch (cause) {
      if (!this.#disposed && unchanged()) this.#options.status(cause instanceof Error ? cause.message : 'Could not review the Risk calibration dataset.');
    }
  }
  async confirm(): Promise<void> {
    const reviewed = this.#state.preview;
    if (this.#disposed || this.#state.busy || !reviewed) return;
    this.#update({ busy: true });
    try {
      const result = await this.#options.download(reviewed);
      if (this.#disposed) return;
      this.changed();
      this.#options.status(`Exported ${result.included} reviewed case${result.included === 1 ? '' : 's'} for offline Risk calibration${result.excluded ? `; excluded ${result.excluded} incompatible selection${result.excluded === 1 ? '' : 's'}` : ''}. No model setting was changed.`);
    } catch (cause) {
      if (!this.#disposed) this.#options.status(cause instanceof Error ? cause.message : 'Could not export the Risk calibration dataset.');
    } finally { this.#update({ busy: false }); }
  }
}
