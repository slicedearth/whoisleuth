<script lang="ts">
  import type { CaseResponsePacket } from '../../../../packages/cases/case-response-packet-types.mts';
  import { preparedPacketTimeline } from '../../../../packages/cases/prepared-packet-timeline.mts';
  import Pagination from './Pagination.svelte';
  let { packet }: { packet: CaseResponsePacket } = $props();
  let page = $state(1);
  const rows = $derived(preparedPacketTimeline(packet));
  const pageCount = $derived(Math.max(1, Math.ceil(rows.length / 25)));
  const currentPage = $derived(Math.min(page, pageCount));
  const pageRows = $derived(rows.slice((currentPage - 1) * 25, currentPage * 25));
</script>

<section aria-label="Prepared packet timeline">
  <h3>Selected packet timeline</h3>
  <p>{rows.length} contained time fields. This is not the full Case history. Preparation is not observation; a declared file time is not verified capture provenance.</p>
  <p>Provider summary: {packet.responseLifecycle.providerOutcomeState}. Independent-review summary: {packet.responseLifecycle.observedChangeState}. Missing or ambiguous summary times remain unavailable.</p>
  <ul>{#each [...packet.escalationHistoryLimitations, ...packet.responseLifecycle.limitations] as limitation}<li>{limitation}</li>{/each}</ul>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -- bounded two-dimensional table has keyboard scroll access -->
  <div class="table-scroll" role="region" tabindex="0" aria-label="Exact selected packet time fields">
    <table><thead><tr><th scope="col">Time field</th><th scope="col">Meaning and source</th><th scope="col">Exact reference</th></tr></thead><tbody>
      {#each pageRows as row (row.id)}<tr><td>{#if row.at}<time datetime={row.at}>{row.at}</time>{:else}Time not included{/if}</td>
        <td><strong>{row.kind}</strong><br />{row.source}</td><td><code>{row.reference}</code></td></tr>{/each}
    </tbody></table>
  </div>
  <Pagination {currentPage} {pageCount} setPage={value => page = value} ariaLabel="Packet timeline pages" pageInputLabel="Packet timeline page" />
</section>

<style>
  section{min-width:0;overflow-wrap:anywhere}h3{font:700 var(--text-lg)/1.4 var(--font-sans);margin:0 0 .75rem}p,li{line-height:1.6}.table-scroll{max-width:100%;overflow:auto}table{width:100%;min-width:560px;border-collapse:collapse;font-size:var(--text-xs)}th,td{text-align:left;vertical-align:top;padding:.75rem;border-bottom:1px solid var(--border);overflow-wrap:anywhere}code{white-space:normal;overflow-wrap:anywhere}time{font-variant-numeric:tabular-nums}
</style>
