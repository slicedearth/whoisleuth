<script lang="ts">
  import type { MessageIntakeReport } from '../../../../packages/contracts/message-intake.mts';
  import { HAR_TIMING_PHASES } from '../../../../packages/contracts/har-review.mts';
  import Pagination from './Pagination.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  let { report, headingTag = 'h4' }: { report: MessageIntakeReport; headingTag?: 'h3' | 'h4' } = $props();
  let page = $state(1);
  const PAGE_SIZE = 20;
  const entries = $derived(report.harReview?.entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? []);
</script>

{#if report.documentReview}
  {@const document = report.documentReview}
  <section class="input-evidence" aria-label="Document extraction coverage">
    <svelte:element this={headingTag} class="heading">Document extraction</svelte:element>
    <p>{document.state}{document.pageCount !== null ? ` · Pages reviewed: ${document.reviewedPages} of ${document.pageCount}` : ' · Source parts, not rendered page layout'}</p>
    {#if document.notes.length}<ul>{#each document.notes as note}<li>{note}</li>{/each}</ul>{/if}
    <details><summary>Part identities ({document.parts.length})</summary>
      <p>Original part hashes identify selected bytes. Extracted text, links and decoded pixels identify derived content; they are not original page-byte hashes.</p>
      <ul>{#each document.parts as part}<li>{part.id}{part.page ? ` · page ${part.page}` : ''} · {part.kind} · {part.identity.replaceAll('_', ' ')} · {part.state}<br><code>{part.digestSha256}</code></li>{/each}</ul>
    </details>
  </section>
{/if}
{#if report.harReview}
  <section class="input-evidence" aria-label="Recorded HTTP sequence">
    <svelte:element this={headingTag} class="heading">Recorded HTTP sequence</svelte:element>
    <p>{report.harReview.entries.length} request records · {report.harReview.invalidEntries} invalid entries omitted. File order is preserved; requests are not replayed.</p>
    <ol start={(page - 1) * PAGE_SIZE + 1}>
      {#each entries as entry (entry.sequence)}
        <li>
          <strong>#{entry.sequence} · {entry.method} · {entry.origin ?? 'Origin unavailable'}</strong>
          <p><EvidenceTimestamp value={entry.startedAt} label="reported request time" /></p>
          <p>Status: {entry.status ?? 'unavailable'} · {entry.mimeCategory} · {entry.resourceType} · {entry.durationMs === null ? 'Duration unavailable' : `${entry.durationMs} ms`}{entry.reportedFailure ? ' · Failure reported' : ''}</p>
          <details><summary>Reported timings</summary><dl>{#each HAR_TIMING_PHASES as phase}<div><dt>{phase}</dt><dd>{entry.timings[phase] === null ? 'Unavailable' : `${entry.timings[phase]} ms`}</dd></div>{/each}</dl></details>
        </li>
      {/each}
    </ol>
    {#if report.harReview.entries.length > PAGE_SIZE}<Pagination currentPage={page} pageCount={Math.ceil(report.harReview.entries.length / PAGE_SIZE)} setPage={next => page = next} ariaLabel="HTTP sequence pages" />{/if}
  </section>
{/if}

<style>
  .input-evidence{display:grid;gap:12px;min-width:0}.heading,p{margin:0}.heading{font-size:var(--text-sm)}p,li,dt,dd{font-size:var(--text-xs);line-height:1.6;overflow-wrap:anywhere}ol,ul{display:grid;gap:12px;margin:0;padding-left:24px}ol>li{border-top:1px solid var(--border);padding-top:10px}ol>li>*+*{margin-top:8px}code{font-size:inherit;overflow-wrap:anywhere}summary{cursor:pointer;min-height:32px;padding-block:6px}dl{display:grid;gap:4px;margin:8px 0}dl>div{display:grid;grid-template-columns:minmax(80px,1fr) minmax(0,3fr);gap:12px}dd{margin:0}details>p{margin-block:8px}
</style>
