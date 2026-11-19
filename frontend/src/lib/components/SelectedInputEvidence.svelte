<script lang="ts">
  import type { MessageIntakeReport } from '../../../../packages/contracts/message-intake.mts';
  import { HAR_TIMING_PHASES } from '../../../../packages/contracts/har-review.mts';
  import { projectHarWaterfall, type HarRequestOrder } from '../../../../packages/investigation/har-waterfall.mts';
  import { summariseHarHosts } from '../../../../packages/investigation/har-host-summary.mts';
  import Pagination from './Pagination.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  let { report, headingTag = 'h4' }: { report: MessageIntakeReport; headingTag?: 'h3' | 'h4' } = $props();
  let page = $state(1);
  let order = $state<HarRequestOrder>('archive');
  const PAGE_SIZE = 20;
  const waterfall = $derived(projectHarWaterfall(report.harReview?.entries ?? [], order));
  const entries = $derived(waterfall.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
  const hosts = $derived(summariseHarHosts(report.harReview?.entries ?? []));
  const partyLabel = (firstParty: boolean | null) => firstParty === null ? 'Party unknown' : firstParty ? 'Page domain' : 'Third party';
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
    <p>{report.harReview.entries.length} request records · {report.harReview.invalidEntries} invalid entries omitted. Request numbers identify their original archive position.</p>
    {#if hosts.groups.length}
      <section class="hosts" aria-label="Hosts contacted">
        <svelte:element this={headingTag === 'h3' ? 'h4' : 'h5'}>Hosts contacted</svelte:element>
        <p>{hosts.pageDomain ? `Page domain ${hosts.pageDomain}, from the first recorded document.` : 'The page domain could not be identified, so hosts are not classified as first or third party.'}{hosts.thirdPartyWrites ? ` ${hosts.thirdPartyWrites} state-changing request${hosts.thirdPartyWrites === 1 ? '' : 's'} went to third-party hosts; the archive does not show what was sent.` : ''}</p>
        <table>
          <thead><tr><th scope="col">Host</th><th scope="col">Requests</th><th scope="col">Writes</th><th scope="col">Failures</th></tr></thead>
          <tbody>
            {#each hosts.groups as group (group.label)}
              <tr data-party={group.firstParty === null ? 'unknown' : group.firstParty ? 'first' : 'third'}>
                <th scope="row"><span>{group.label}</span><small>{partyLabel(group.firstParty)} · {group.origins.map(origin => origin.origin).join(', ')}{group.omittedOrigins ? ` +${group.omittedOrigins} more` : ''}</small></th>
                <td>{group.requests}</td><td>{group.writes}</td><td>{group.failures}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if hosts.omittedGroups || hosts.requestsWithoutOrigin}<p>{hosts.omittedGroups ? `${hosts.omittedGroups} more host groups are outside this summary. ` : ''}{hosts.requestsWithoutOrigin ? `${hosts.requestsWithoutOrigin} request${hosts.requestsWithoutOrigin === 1 ? '' : 's'} had no usable origin.` : ''}</p>{/if}
      </section>
    {/if}
    <label class="request-order">Request order
      <select bind:value={order} onchange={() => page = 1}>
        <option value="archive">Archive order</option>
        <option value="started">Reported start time</option>
      </select>
    </label>
    {#if waterfall.referenceTime}
      <p>Timing starts at <EvidenceTimestamp value={waterfall.referenceTime} label="earliest reported request time" />.
        {#if waterfall.rangeMs !== null}The track spans {waterfall.rangeMs} ms. Vertical marks show starts; bars show available total durations.{:else}The visual scale is unavailable; exact reported timings remain below.{/if}
      </p>
    {:else}<p>No usable start times were reported. Exact durations and phase details remain below.</p>{/if}
    {#if order === 'started'}<p>Records without a usable start time follow dated records. Tied starts retain archive order.</p>{/if}
    {#if !entries.length}<p>No request records to display.</p>{/if}
    <ol class="request-records" aria-label="HTTP request records">
      {#each entries as row (row.entry.sequence)}
        {@const entry = row.entry}
        {@const maximumPhase = Math.max(0, ...HAR_TIMING_PHASES.map(phase => entry.timings[phase] ?? 0))}
        <li>
          <strong>#{entry.sequence} · {entry.method} · {entry.origin ?? 'Origin unavailable'}</strong>
          <p><EvidenceTimestamp value={entry.startedAt} label="reported request time" /></p>
          <p>Status: {entry.status ?? 'unavailable'} · {entry.mimeCategory} · {entry.resourceType} · {entry.durationMs === null ? 'Duration unavailable' : `${entry.durationMs} ms`}{entry.reportedFailure ? ' · Failure reported' : ''}</p>
          <p>{row.offsetMs === null ? 'Start offset unavailable' : `Starts ${row.offsetMs} ms after the earliest reported request`}</p>
          {#if row.position}
            <div class="timing-track" aria-hidden="true">
              {#if row.position.durationPercent !== null}<span class="duration" style:left={`${row.position.startPercent}%`} style:width={`${row.position.durationPercent}%`}></span>{/if}
              <span class="start" style:left={`${row.position.startPercent}%`}></span>
            </div>
          {/if}
          <details><summary>Reported timings</summary><p>Bars compare the archive's phase durations within this request. TLS is included in connect; phase values are not added to replace the reported total duration.</p><dl>{#each HAR_TIMING_PHASES as phase}<div><dt>{phase === 'ssl' ? 'TLS (part of connect)' : phase === 'dns' ? 'DNS' : phase}</dt><dd>{entry.timings[phase] === null ? 'Unavailable' : `${entry.timings[phase]} ms`}{#if entry.timings[phase] !== null}<span class="phase-bar" aria-hidden="true" style:width={`${maximumPhase === 0 ? 0 : entry.timings[phase]! / maximumPhase * 100}%`}></span>{/if}</dd></div>{/each}</dl></details>
        </li>
      {/each}
    </ol>
    {#if waterfall.omittedEntries}<p>{waterfall.omittedEntries} additional records are outside the existing archive display bound.</p>{/if}
    {#if waterfall.rows.length > PAGE_SIZE}<Pagination currentPage={page} pageCount={Math.ceil(waterfall.rows.length / PAGE_SIZE)} setPage={next => page = next} ariaLabel="HTTP sequence pages" />{/if}
  </section>
{/if}

<style>
  .input-evidence{display:grid;gap:12px;min-width:0}.heading,p{margin:0}.heading{font-size:var(--text-sm)}p,li,dt,dd{font-size:var(--text-xs);line-height:1.6;overflow-wrap:anywhere}ol,ul{display:grid;gap:12px;margin:0;padding-left:24px}ol>li{border-top:1px solid var(--border);padding-top:10px}ol>li>*+*{margin-top:8px}code{font-size:inherit;overflow-wrap:anywhere}summary{cursor:pointer;min-height:32px;padding-block:6px}dl{display:grid;gap:4px;margin:8px 0}dl>div{display:grid;grid-template-columns:minmax(80px,1fr) minmax(0,3fr);gap:12px}dd{margin:0}details>p{margin-block:8px}
  .hosts{display:grid;gap:8px;min-width:0}.hosts>:first-child{margin:0;font-size:var(--text-xs)}
  .hosts table{width:100%;border-collapse:collapse;font-size:var(--text-xs)}.hosts th,.hosts td{padding:6px 8px;border-top:1px solid var(--border);text-align:left;vertical-align:top}
  .hosts thead th{color:var(--muted);font-weight:600}.hosts td{width:5.5rem;font-variant-numeric:tabular-nums}
  .hosts tbody th{min-width:0;font-weight:600;overflow-wrap:anywhere}.hosts tbody th span,.hosts tbody th small{display:block}.hosts tbody th small{color:var(--muted);font-weight:400}
  @media(max-width:520px){.hosts thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.hosts tr{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--border)}.hosts tbody th{grid-column:1/-1;border:0}.hosts td{width:auto;border:0}.hosts td::before{display:block;color:var(--muted)}.hosts td:nth-of-type(1)::before{content:'Requests'}.hosts td:nth-of-type(2)::before{content:'Writes'}.hosts td:nth-of-type(3)::before{content:'Failures'}}
  .request-order{display:grid;gap:4px;max-width:320px;min-width:0;font-size:var(--text-xs)}.request-order select{width:100%;min-width:0}
  .request-records{padding-left:0;list-style:none}.request-records>li{min-width:0}
  .timing-track{position:relative;height:14px;margin:8px 2px;background:var(--panel-raised);border-block:1px solid var(--border)}
  .timing-track .duration{position:absolute;top:3px;height:6px;background:var(--interface-accent);opacity:.65}
  .timing-track .start{position:absolute;top:0;width:2px;height:12px;transform:translateX(-1px);background:var(--text)}
  .phase-bar{display:block;height:4px;background:var(--interface-accent);opacity:.65}
</style>
