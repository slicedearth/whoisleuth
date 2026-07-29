<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { dispositionLabel, type RiskCalibrationExportPreview } from '$lib/cases';

  let {
    preview,
    busy,
    confirm,
    cancel,
  }: {
    preview: RiskCalibrationExportPreview;
    busy: boolean;
    confirm: () => void | Promise<void>;
    cancel: () => void;
  } = $props();

  let dialog: HTMLElement;
  let confirmButton: HTMLButtonElement;
  const DISPLAY_LIMIT = 20;
  const displayedRecords = $derived(preview.records.slice(0, DISPLAY_LIMIT));
  const omittedCount = $derived(Math.max(0, preview.records.length - displayedRecords.length));

  function focusableElements(): HTMLElement[] {
    return dialog
      ? [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      : [];
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = focusableElements();
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onMount(() => {
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    void tick().then(() => confirmButton?.focus());
    return () => previous?.focus();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="review-layer">
  <button
    class="review-backdrop"
    type="button"
    aria-label="Cancel calibration export"
    disabled={busy}
    onclick={cancel}
  ></button>
  <div
    class="review-dialog card"
    role="dialog"
    aria-modal="true"
    aria-labelledby="calibration-review-title"
    aria-describedby="calibration-review-summary"
    bind:this={dialog}
  >
    <header>
      <div>
        <p class="eyebrow">Local export review</p>
        <h2 id="calibration-review-title">Confirm Risk calibration dataset</h2>
      </div>
      <button class="close" type="button" disabled={busy} aria-label="Cancel calibration export" onclick={cancel}>Esc</button>
    </header>

    <div class="review-body">
      <p id="calibration-review-summary">
        The file will include <strong>{preview.included} reviewed case{preview.included === 1 ? '' : 's'}</strong>
        with domain names, analyst dispositions, and bounded normalized scoring inputs.
      </p>
      <div class="counts" aria-label="Calibration export counts">
        <span><strong>{preview.selected}</strong> selected</span>
        <span><strong>{preview.included}</strong> included</span>
        <span><strong>{preview.excluded}</strong> excluded</span>
      </div>
      <div class="included">
        <h3>Records to include</h3>
        <ul>
          {#each displayedRecords as record (record.domain)}
            <li><span>{record.domain}</span><small>{dispositionLabel(record.analystDisposition)}</small></li>
          {/each}
        </ul>
        {#if omittedCount}
          <p class="omitted">Plus {omittedCount} more selected record{omittedCount === 1 ? '' : 's'}.</p>
        {/if}
      </div>
      <p class="privacy-note">
        Notes, tags, assertions, actions, contacts, raw evidence, provider payloads, and stored Risk scores are excluded.
        The file stays local unless you share it, and exporting it does not train or change Risk.
      </p>
    </div>

    <footer>
      <button class="btn" type="button" disabled={busy} onclick={cancel}>Cancel</button>
      <button
        class="primary"
        type="button"
        disabled={busy}
        bind:this={confirmButton}
        onclick={() => void confirm()}
      >{busy ? 'Preparing export…' : 'Confirm local export'}</button>
    </footer>
  </div>
</div>

<style>
  .review-layer{position:fixed;inset:0;z-index:110;display:grid;place-items:center;padding:18px}
  .review-backdrop{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:0;background:rgb(var(--shadow-rgb) / .78);backdrop-filter:blur(4px)}
  .review-dialog{position:relative;display:flex;flex-direction:column;width:min(660px,100%);max-height:calc(100dvh - 36px);padding:0;overflow:hidden;border-color:var(--border-strong);box-shadow:0 32px 100px rgb(var(--shadow-rgb) / .52)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px;border-bottom:1px solid var(--border);background:rgb(var(--overlay-rgb) / .025)}
  header p{margin:0}h2{margin:3px 0 0;font:700 var(--text-lg) var(--mono)}
  .close{min-height:30px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .review-body{display:grid;gap:16px;min-height:0;padding:18px;overflow-y:auto}
  .review-body>p{margin:0;line-height:1.6}
  .counts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .counts span{display:grid;gap:3px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .counts strong{color:var(--text);font-size:var(--text-md)}
  .included{display:grid;gap:8px}
  h3{margin:0;font:700 var(--text-sm) var(--mono)}
  ul{display:grid;gap:5px;max-height:240px;margin:0;padding:0;overflow-y:auto;list-style:none}
  li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  li span{min-width:0;overflow-wrap:anywhere;font:650 var(--text-xs) var(--mono)}
  li small{color:var(--muted);font-size:var(--text-2xs)}
  .omitted,.privacy-note{color:var(--muted);font-size:var(--text-xs)}
  footer{display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid var(--border)}
  @media(max-width:600px){
    .review-layer{padding:10px}
    .review-dialog{max-height:calc(100dvh - 20px)}
    header,.review-body,footer{padding:13px}
    .counts{grid-template-columns:1fr}
    li{grid-template-columns:1fr;gap:3px}
    footer{display:grid;grid-template-columns:1fr 1fr}
  }
  @media(prefers-reduced-motion:no-preference){
    .review-dialog{animation:review-enter .16s ease-out both}
    @keyframes review-enter{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}
  }
</style>
