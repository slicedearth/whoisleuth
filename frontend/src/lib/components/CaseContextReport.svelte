<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { ContextReview } from '../../../../packages/contracts/context-review.mts';
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseOperation } from '$lib/analysis/case-response-stage.ts';
  import { prepareCaseAttachmentFiles, retainCaseAttachments } from '$lib/case-attachments.ts';
  import type { LocalCaseReviewSummary } from '../../../../packages/cases/case-review-summary.mts';
  import { downloadLocalFile } from '$lib/download-local-file.ts';
  import Pagination from './Pagination.svelte';
  import ContextReviewDetails from './ContextReviewDetails.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  import CopyButton from './CopyButton.svelte';
  import ContextReviewPrint from './ContextReviewPrint.svelte';
  import { contextReviewSources, contextReviewTargets, type ContextReviewPresentation } from '$lib/analysis/context-review-presentation.ts';
  import { defangedIndicator, evidenceCitation } from '$lib/analysis/evidence-copy.ts';
  import './context-review.css';
  let { report, record, mutationBusy, persistOperation, reusableInput = null, retainReusableInput = true, presentation = null }: { report: ContextReview; record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation; reusableInput?: unknown; retainReusableInput?: boolean; presentation?: ContextReviewPresentation | null } = $props();
  const sources = $derived(contextReviewSources(report));
  const targets = $derived(contextReviewTargets(report));
  let saving = $state(false), message = $state(''), page = $state(1), active = true;
  let heading = $state<HTMLHeadingElement>();
  let printReport = $state.raw<ContextReview | null>(null);
  $effect(() => { report; page = 1; message = ''; });
  onDestroy(() => { active = false; });
  function download() { downloadLocalFile(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `${report.kind}-review.json`); }
  async function save() {
    if (saving || mutationBusy) return;
    saving = true; message = '';
    const selected = report, id = record.id;
    try {
      const files = [new File([JSON.stringify(selected, null, 2)], `${selected.kind}-review.json`, { type: 'application/json' })];
      if (reusableInput !== null && retainReusableInput) files.push(new File([JSON.stringify(reusableInput, null, 2)], `${selected.kind}-input.json`, { type: 'application/json' }));
      const prepared = await prepareCaseAttachmentFiles(files, selected.title, null);
      const reviewSummary: LocalCaseReviewSummary = { title: selected.title, reviewedAt: selected.reviewedAt, reportDigestSha256: prepared[0]!.attachment.digestSha256,
        completeness: selected.state === 'partial' ? 'partial' : 'inconclusive', summary: `${selected.summary} Source-qualified observations in the retained review: ${selected.observations.length}.`,
        limitations: ['Inputs are analyst-selected and do not independently establish maliciousness.', 'Select the retained report deliberately when preparing a response packet.'] };
      if (!active || id !== record.id || selected !== report) return;
      if (await persistOperation(() => retainCaseAttachments(id, prepared, { reviewSummary }), 'Saved the contextual review and its source-qualified summary.', () => heading ?? null)) {
        message = 'Review saved. Select the retained review file when preparing the response packet.';
        await tick(); if (active) heading?.focus();
      } else message = 'The save was not confirmed. Review the workspace message and existing files before retrying; this draft is preserved.';
    } catch { message = 'The review could not be saved. No successful save is claimed; keep the draft and retry after checking workspace storage.'; }
    finally { if (active) saving = false; }
  }
</script>

<section class="context-report" aria-label={report.title}>
  <h4 tabindex="-1" bind:this={heading}>{report.title}</h4><p>{report.summary}</p>
  {#if report.state === 'partial'}<p>Some comparison evidence is unavailable; see the individual observations.</p>{/if}
  {#if presentation}<ContextReviewDetails {presentation} {report} />{:else}
  <ol start={(page - 1) * 12 + 1}>{#each report.observations.slice((page - 1) * 12, page * 12) as row}<li><strong>{row.label} · {row.state}</strong><p>{row.detail}</p><p class="meta">{row.source} · <EvidenceTimestamp value={row.observedAt} label="observation time" unavailable="Time not supplied" /></p>
  </li>{/each}</ol>
  <Pagination currentPage={page} pageCount={Math.ceil(report.observations.length / 12)} setPage={next => page = next} ariaLabel={`${report.title} observations`} />
  {/if}
  {#if targets.length}<nav class="review-targets" aria-label="Review related targets">{#each targets as target}<div><a href={`/lookup?${new URLSearchParams({ q: target, case: record.id })}`}>Review {target} in Lookup</a><CopyButton value={target} label="Copy domain" description={`Copy domain ${target}`} /><CopyButton value={defangedIndicator(target)} label="Copy defanged" description={`Copy defanged indicator for ${target}`} /></div>{/each}</nav>{/if}
  <section><h5>Suggested next reviews</h5><ul>{#each report.nextSteps as step}<li>{step}</li>{/each}</ul></section>
  <details><summary>Sources and interpretation</summary><ol>{#each sources as source}<li><strong>{source.source}</strong><p><EvidenceTimestamp value={source.observedAt} label="source observation time" unavailable="Time not supplied" /></p><p>Supports: {source.observations.join('; ')}</p><CopyButton value={evidenceCitation(source.observations.join('; '), source.source, source.observedAt)} label="Copy citation" description={`Copy citation for ${source.observations[0]}`} /></li>{/each}</ol><ul>{#each report.limitations as detail}<li>{detail}</li>{/each}</ul></details>
  <div class="actions"><button class="primary" type="button" disabled={saving || mutationBusy} onclick={() => void save()}>{saving ? 'Saving…' : 'Save review in Case'}</button><button class="btn" type="button" onclick={download}>Download review</button><button class="btn" type="button" onclick={event => { event.currentTarget.focus({ preventScroll: true }); printReport = report; }}>Print review</button>
    {#if reusableInput !== null}<details class="input-download"><summary>Reuse inputs</summary><p>The download contains the selected {retainReusableInput ? 'review inputs' : 'Case record and declarations'}. Review it before sharing.</p><button class="btn" type="button" onclick={() => downloadLocalFile(new Blob([JSON.stringify(reusableInput, null, 2)], { type: 'application/json' }), `${report.kind}-input.json`)}>Download inputs for reuse</button></details>{/if}</div>
  <p class="meta">Saving retains the review{reusableInput !== null && retainReusableInput ? ' and its inputs' : ''} in this Case.</p>
  <p role="status">{message}</p>
</section>
{#if printReport}<ContextReviewPrint report={printReport} onclose={() => printReport = null} />{/if}

<style>
  h5{font-size:var(--text-sm);margin:0 0 8px}.review-targets{display:grid;gap:8px}.review-targets>div{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;min-width:0}.review-targets a{overflow-wrap:anywhere;font-size:var(--text-xs);padding-block:10px;color:var(--interface-accent);text-decoration:underline;text-underline-offset:3px}.input-download{min-width:0;max-width:100%}.input-download summary{padding:10px!important}.input-download p{margin-block:8px}.primary{min-height:44px;font:600 var(--text-sm) var(--font-sans)}
  @media print{.actions,.review-targets{display:none}}
</style>
