<script lang="ts">
  import type { ContextReview } from '../../../../packages/contracts/context-review.mts';
  import type { ContextReviewPresentation } from '$lib/analysis/context-review-presentation.ts';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  import Pagination from './Pagination.svelte';
  let { presentation, report }: { presentation: ContextReviewPresentation; report: ContextReview } = $props();
  let page = $state(1);
  const pageSize = 12;
  $effect(() => { presentation; page = 1; });
  const readable = (value: string | null) => value?.replaceAll('_', ' ') ?? 'Not supplied';
  const pageCount = $derived(Math.ceil((presentation.kind === 'platform' ? presentation.groups.length : presentation.kind === 'incident' ? presentation.stages.length : presentation.kind === 'connector' ? report.observations.length : 0) / pageSize));
</script>

{#if presentation.kind === 'storefront'}
  <div class="comparison-sources">
    {#each [{ label: 'Official reference', value: presentation.official }, { label: 'Candidate', value: presentation.candidate }] as item}
      <section><h5>{item.label}</h5><strong>{item.value.hostname}</strong><p>{item.value.source}</p><EvidenceTimestamp value={item.value.observedAt} label={`${item.label} observation time`} /></section>
    {/each}
  </div>
  <div class="comparison" role="table" aria-label="Official and candidate storefront evidence">
    <div class="comparison-row comparison-header" role="row"><span role="columnheader">Evidence</span><span role="columnheader">Official reference</span><span role="columnheader">Candidate</span></div>
    {#each presentation.fields as field}
      {@const left = presentation.official[field.id]}
      {@const right = presentation.candidate[field.id]}
      <div class="comparison-row" role="row">
        <div role="rowheader"><strong>{field.label}</strong><p>{left !== null && right !== null ? `Exact shared values: ${right.filter(value => left.includes(value)).length}` : 'Comparison unavailable'}</p></div>
        {#each [{ label: 'Official reference', values: left }, { label: 'Candidate', values: right }] as side}
          <div role="cell"><span class="mobile-label">{side.label}</span>{#if side.values === null}<strong>Not reviewed</strong>{:else if !side.values.length}<span>No values recorded</span>{:else}<ul>{#each side.values as value}<li>{value}</li>{/each}</ul>{/if}</div>
        {/each}
      </div>
    {/each}
  </div>
  {@const authority = report.observations.at(-1)}
  {#if authority}<section><h5>{authority.label}</h5><p>{authority.detail}</p><p class="meta">{authority.source}</p></section>{/if}
{:else if presentation.kind === 'platform'}
  {#each presentation.groups.slice((page - 1) * pageSize, page * pageSize) as group}
    {@const first = group[0]!}
    <section class="object-history"><h5>{first.objectType} · {first.objectId}</h5><p class="meta">{first.platformOrigin} · {group.length} recorded observation{group.length === 1 ? '' : 's'}</p>
      <ol class="record-sequence">{#each group as row, index}<li>
        <div class="record-heading"><strong>{row.version ? `Version ${row.version}` : 'Version not supplied'}</strong><span>{index === group.length - 1 ? 'Latest recorded observation' : 'Earlier observation'}</span></div>
        <EvidenceTimestamp value={row.observedAt} label="platform observation time" />
        <dl class="review-facts"><div><dt>Report status</dt><dd>{readable(row.report)}</dd></div><div><dt>Provider response</dt><dd>{readable(row.providerOutcome)}</dd></div><div><dt>Independent recheck</dt><dd>{readable(row.recheck)}{#if row.recheckedAt}<br><EvidenceTimestamp value={row.recheckedAt} label="independent recheck time" />{/if}</dd></div></dl>
        <p class="meta">Source: {row.source}</p>
      </li>{/each}</ol>
    </section>
  {/each}
{:else if presentation.kind === 'incident'}
  <p class="meta">Analyst-selected sequence. Times are shown where supplied; the selected order is unchanged.</p>
  <ol class="record-sequence" start={(page - 1) * pageSize + 1}>{#each presentation.stages.slice((page - 1) * pageSize, page * pageSize) as stage}<li>
    <div class="record-heading"><strong>{readable(stage.kind)}</strong><span>{readable(stage.basis)}</span></div>
    <EvidenceTimestamp value={stage.occurredAt} label="event time" unavailable="Time not supplied" /><p>{stage.description}</p>
    <dl class="review-facts"><div><dt>Source completeness</dt><dd>{stage.completeness}</dd></div><div><dt>Source</dt><dd>{stage.source}</dd></div><div><dt>Reference</dt><dd>{stage.reference}</dd></div></dl>
    {#if stage.referenceSha256}<details><summary>Reference digest</summary><code>{stage.referenceSha256}</code></details>{/if}
    {#if stage.limitations.length}<ul>{#each stage.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
  </li>{/each}</ol>
{:else if presentation.kind === 'connector'}
  {#each report.observations.slice((page - 1) * pageSize, page * pageSize) as observation, index}
    {@const connector = presentation.connectors[(page - 1) * pageSize + index]}
    <section class="connector-record"><div class="record-heading"><h5>{observation.label}</h5><span>{observation.state}</span></div>
      {#if connector}<dl class="review-facts">
        <div><dt>Package identity</dt><dd>{connector.package ?? 'Not established'}</dd></div><div><dt>Endpoint origin</dt><dd>{connector.origin ?? 'Not supplied'}</dd></div><div><dt>Local executable</dt><dd>{connector.executable ?? 'Not retained or unknown'}</dd></div>
        <div><dt>Declared state</dt><dd>{connector.enabled}</dd></div><div><dt>Declared capabilities</dt><dd>{connector.declaredCapabilities.join(', ') || 'Not declared'}</dd></div><div><dt>Authentication declaration</dt><dd>{connector.authenticationDeclared ? 'Present' : 'Not supplied'}</dd></div>
        <div><dt>Private values omitted</dt><dd>{connector.argumentCount} arguments · {connector.environmentCount} environment entries · {connector.headerCount} headers</dd></div>
      </dl><details><summary>Comparison and interpretation</summary><p>{observation.detail}</p></details>{:else}<p>{observation.detail}</p>{/if}
    </section>
  {/each}
{/if}
<Pagination currentPage={page} {pageCount} setPage={value => page = value} ariaLabel={`${report.title} results`} />

<style>
  h5{margin:0;font-size:var(--text-sm);overflow-wrap:anywhere}p{margin:0;overflow-wrap:anywhere}.meta{color:var(--muted)}
  .comparison-sources{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.comparison-sources section{display:grid;gap:5px;min-width:0}
  .comparison{min-width:0}.comparison-row{display:grid;grid-template-columns:minmax(130px,.7fr) repeat(2,minmax(0,1fr));border-top:1px solid var(--border)}
  .comparison-row>div,.comparison-row>span{min-width:0;padding:14px 10px;overflow-wrap:anywhere}.comparison-row ul{margin:0;padding-left:18px}.comparison-row p{font-size:var(--text-xs);color:var(--muted)}.comparison-header{font-weight:650;background:var(--panel)}.mobile-label{display:none}
  .object-history,.connector-record{min-width:0;padding-block:14px;border-top:1px solid var(--border)}
  .record-sequence{padding-left:22px;display:grid;gap:18px}.record-sequence>li{min-width:0;padding:12px 0 12px 12px;border-left:2px solid var(--border)}
  .record-heading{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px;margin-bottom:8px}.record-heading>span{color:var(--muted);font-size:var(--text-xs)}
  .review-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:14px;margin:12px 0}.review-facts>div{min-width:0}dt{font-weight:650;font-size:var(--text-xs)}dd{margin:4px 0 0;overflow-wrap:anywhere;font-size:var(--text-xs)}code{overflow-wrap:anywhere}
  @media(max-width:700px){.comparison-sources{grid-template-columns:1fr}.comparison-header{display:none}.comparison-row{grid-template-columns:minmax(0,1fr)}.comparison-row>div{padding:8px 0}.comparison-row{padding-block:12px}.mobile-label{display:block;font-weight:600;color:var(--muted);margin-bottom:4px}}
  @media print{.comparison-row{break-inside:avoid}.record-sequence>li,.connector-record{break-inside:avoid}}
</style>
