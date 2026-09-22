<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { ContextReview } from '../../../../packages/contracts/context-review.mts';
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseOperation } from '$lib/analysis/case-response-stage.ts';
  import { prepareCaseAttachmentFiles, retainCaseAttachments } from '$lib/case-attachments.ts';
  import type { LocalCaseReviewSummary } from '../../../../packages/cases/case-review-summary.mts';
  import { downloadLocalFile } from '$lib/download-local-file.ts';
  import Pagination from './Pagination.svelte';
  import './context-review.css';
  let { report, record, mutationBusy, persistOperation, reusableInput = null, retainReusableInput = true }: { report: ContextReview; record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation; reusableInput?: unknown; retainReusableInput?: boolean } = $props();
  let saving = $state(false), message = $state(''), page = $state(1), active = true;
  let heading = $state<HTMLHeadingElement>();
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
  <ol start={(page - 1) * 12 + 1}>{#each report.observations.slice((page - 1) * 12, page * 12) as row}<li><strong>{row.label} · {row.state}</strong><p>{row.detail}</p><p class="meta">{row.source} · {row.observedAt ?? 'Time not supplied'}</p>
    {#if row.hostname}<a class="btn small" href={`/lookup?${new URLSearchParams({ q: row.hostname, case: record.id })}`}>Review {row.hostname} in Lookup</a>{/if}
  </li>{/each}</ol>
  <Pagination currentPage={page} pageCount={Math.ceil(report.observations.length / 12)} setPage={next => page = next} ariaLabel={`${report.title} observations`} />
  <details><summary>Next reviews and evidence boundaries</summary><ul>{#each report.nextSteps as step}<li>{step}</li>{/each}</ul><ul>{#each report.limitations as detail}<li>{detail}</li>{/each}</ul></details>
  <p class="meta">Review these values before sharing. Saving retains this report{reusableInput !== null && retainReusableInput ? ' and its reusable input' : ''} in the Case; no input is opened or sent.</p>
  <div class="actions"><button class="btn" type="button" onclick={download}>Download review</button><button class="btn" type="button" disabled={saving || mutationBusy} onclick={() => void save()}>{saving ? 'Saving…' : 'Save review in Case'}</button>
    {#if reusableInput !== null}<button class="btn" type="button" onclick={() => downloadLocalFile(new Blob([JSON.stringify(reusableInput, null, 2)], { type: 'application/json' }), `${report.kind}-input.json`)}>Download reusable input</button>{/if}</div>
  <p role="status">{message}</p>
</section>
