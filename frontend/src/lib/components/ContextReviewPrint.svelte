<script lang="ts">
  import { onMount } from 'svelte';
  import type { ContextReview } from '../../../../packages/contracts/context-review.mts';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  import './print-surface.css';

  let { report, onclose }: { report: ContextReview; onclose: () => void } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let heading: HTMLHeadingElement;
  onMount(() => {
    dialog.showModal();
    heading.focus({ preventScroll: true });
    return () => dialog.close();
  });
</script>

<dialog bind:this={dialog} data-print-surface aria-labelledby={id} onclose={onclose}>
  <div class="controls">
    <button type="button" class="btn" onclick={() => window.print()}>Print or save PDF</button>
    <button type="button" class="btn" onclick={() => dialog.close()}>Close print preview</button>
  </div>
  <article>
    <header>
      <p>Review summary · {report.state}</p>
      <h2 {id} bind:this={heading} tabindex="-1">{report.title}</h2>
      <EvidenceTimestamp value={report.reviewedAt} label="review time" />
      <p>{report.summary}</p>
      <p class="context">This is a review summary, not an authorised response packet.</p>
    </header>
    <section><h3>Observations · {report.observations.length}</h3>
      <ol>{#each report.observations as observation}<li>
        <h4>{observation.label} · {observation.state}</h4>
        <p>{observation.detail}</p>
        <p>Source: {observation.source}</p>
        <EvidenceTimestamp value={observation.observedAt} label="observation time" unavailable="Time not supplied" />
        {#if observation.hostname}<p>Target: <code>{observation.hostname}</code></p>{/if}
      </li>{/each}</ol>
    </section>
    <section><h3>Suggested next reviews</h3><ul>{#each report.nextSteps as step}<li>{step}</li>{/each}</ul></section>
    <section><h3>Interpretation and coverage</h3><ul>{#each report.limitations as limitation}<li>{limitation}</li>{/each}</ul></section>
    <footer>{report.schema} · version {report.version}. The JSON download retains the structured review.</footer>
  </article>
</dialog>

<style>
  dialog { width: min(960px, calc(100% - 24px)); max-width: none; max-height: calc(100dvh - 24px); margin: auto; padding: 0; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--panel); color: var(--text); overflow: auto; }
  dialog::backdrop { background: rgb(0 0 0 / .58); }
  .controls { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 14px 24px; border-bottom: 1px solid var(--border); }
  article { padding: 24px 32px; font: 400 var(--text-sm)/1.65 var(--font-sans); overflow-wrap: anywhere; }
  header { display: grid; gap: 10px; } h2,h3,h4,p { margin: 0; } h2 { font: 700 var(--text-xl)/1.3 var(--font-sans); } h3 { font-size: var(--text-lg); } h4 { font-size: var(--text-sm); }
  section,footer { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); } li { margin-bottom: 14px; } li p { margin-top: 5px; }
  .context,footer { color: var(--muted); font-size: var(--text-xs); } code { overflow-wrap: anywhere; }
  @media(max-width: 600px) { article { padding: 20px 16px; } .controls { padding: 12px; } }
  @media print {
    dialog { position: static !important; inset: auto !important; display: block !important; width: 100% !important; height: auto !important; max-height: none !important; max-width: none !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; border: 0 !important; border-radius: 0 !important; background: white !important; color: #111 !important; --muted: #333; --border: #aaa; }
    dialog::backdrop,.controls { display: none !important; } article { padding: 0; font-size: 10pt; } h2 { font-size: 22pt; } h3 { font-size: 14pt; } h4 { font-size: 11pt; }
    h2,h3,h4 { break-after: avoid; } li { break-inside: avoid; }
  }
</style>
