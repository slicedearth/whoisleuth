<script lang="ts">
  import { tick } from 'svelte';
  import { formatEvidenceDate } from '$lib/analysis/evidence-time.ts';
  import type { InvestigationInfrastructureRelationships, InvestigationInfrastructureRelationship } from '$lib/analysis/investigation-infrastructure.ts';
  import type { InvestigationSearchSession } from '$lib/investigation-search-session';
  import Pagination from './Pagination.svelte';
  let { session, entityId, onopen, onselect }: {
    session: InvestigationSearchSession;
    entityId: string;
    onopen: (event: MouseEvent, href: string) => void;
    onselect: (id: string, label: string) => void;
  } = $props();
  let page = $state(1), pending = $state(false), error = $state('');
  let response = $state.raw<InvestigationInfrastructureRelationships | null>(null);
  let heading = $state<HTMLHeadingElement>();
  let focusPage = false;
  const labels: Record<InvestigationInfrastructureRelationship['type'], string> = {
    domain_uses_nameserver_set: 'Nameserver relationship', domain_reached_http_origin: 'Observed HTTP origin',
    case_documents_domain: 'Case documents domain', brand_declares_official_domain: 'Declared official domain',
    brand_declares_official_favicon: 'Declared official favicon', domain_observed_favicon: 'Observed favicon',
    campaign_contains_domain: 'Campaign includes domain', campaign_contains_case: 'Campaign includes Case',
    domain_presented_certificate: 'Certificate relationship', domain_resolved_to_ip: 'Retained DNS address',
    domain_aliases_to_domain: 'Retained DNS alias', domain_uses_mail_server: 'Mail-server relationship',
    domain_exposed_tracking_identifier: 'Tracking identifier', domain_related_by_favicon: 'Derived favicon relationship',
    domain_loaded_official_asset: 'Official-asset observation',
  };
  $effect(() => {
    const current = session, selected = entityId, requestedPage = page;
    let active = true;
    pending = true; response = null; error = '';
    void current.infrastructureRelationships(selected, requestedPage).then(async value => {
      if (!active) return;
      response = value; pending = false;
      if (focusPage) { focusPage = false; await tick(); if (active) heading?.focus({ preventScroll: true }); }
    }).catch(cause => {
      if (!active) return;
      pending = false;
      error = cause instanceof DOMException && cause.name === 'AbortError'
        ? 'This relationship request was replaced by another saved-work operation. Close and reopen this detail to retry.'
        : 'Retained relationships could not be read. Close and reopen this detail to retry.';
    });
    return () => { active = false; };
  });
</script>

<section class="relationships" aria-label="Directly supported retained relationships" aria-busy={pending}>
  {#if error}<p role="alert">{error}</p>
  {:else if pending || !response}<p role="status">Reading retained relationships…</p>
  {:else if response.state !== 'ready'}<p role="status">This retained identity is unavailable or ambiguous.</p>
  {:else}
    <h4 bind:this={heading} tabindex="-1">{response.relationshipCount} one-hop relationship{response.relationshipCount === 1 ? '' : 's'}</h4>
    <p>{response.total} retained relationship/source row{response.total === 1 ? '' : 's'}. Independent sources have separate rows.</p>
    {#if response.partial}<p>Relationship or source coverage is incomplete.</p>{/if}
    {#if !response.total}<p>No supported one-hop relationship is admitted here. This does not establish absence elsewhere.</p>{/if}
    <ol aria-label="Retained relationship sources">
      {#each response.rows as row (row.id)}
        {@const related = row.from.id === entityId ? row.to : row.from}
        <li>
          <h5>{labels[row.type]}</h5>
          <dl>
            <div><dt>From</dt><dd>{row.from.canonical} <small>({row.from.type.replaceAll('_', ' ')})</small></dd></div>
            <div><dt>To</dt><dd>{row.to.canonical} <small>({row.to.type.replaceAll('_', ' ')})</small></dd></div>
            <div><dt>Classification</dt><dd>{row.classification} · {row.partial ? 'Partial or unknown completeness' : 'Complete retained evidence'}</dd></div>
            <div><dt>Method</dt><dd>{row.method}</dd></div>
            {#if row.source}
              <div><dt>Supporting source</dt><dd>{row.source.source} · {row.source.recordId}</dd></div>
              <div><dt>Observed</dt><dd>{formatEvidenceDate(row.source.observedAt, 'Unknown time')}</dd></div>
            {:else}<div><dt>Supporting source</dt><dd>Unavailable; the retained link is not independently attributable from this source row.</dd></div>{/if}
          </dl>
          <div class="actions">
            {#if row.source?.href}<a href={row.source.href} onclick={event => onopen(event, row.source!.href)}>{row.source.action}</a>{/if}
            {#if related.id !== entityId}<button class="btn small" type="button" onclick={() => onselect(related.id, related.label)}>Inspect retained evidence for {related.label}</button>{/if}
          </div>
          {#if row.limitations.length || row.source?.limitations.length}
            <details><summary>Relationship and source limitations</summary><ul>
              {#each row.limitations as limitation}<li>{limitation}</li>{/each}
              {#each row.source?.limitations ?? [] as limitation}<li>{limitation}</li>{/each}
            </ul></details>
          {/if}
        </li>
      {/each}
    </ol>
    <Pagination currentPage={response.page} pageCount={response.pageCount} setPage={value => { if (!pending) { focusPage = true; page = value; } }} ariaLabel="Retained relationship pages" />
  {/if}
</section>

<style>
  .relationships{min-width:0;margin-top:20px;font-size:var(--text-xs);line-height:1.55}
  h4{margin:0;font:700 var(--text-sm) var(--mono)}h5{margin:0;font:650 var(--text-sm) var(--sans)}
  p{margin:8px 0;overflow-wrap:anywhere}ol{list-style:none;margin:12px 0;padding:0;display:grid;gap:14px}
  li{min-width:0;border-top:1px solid var(--border);padding-top:12px}dl{display:grid;gap:5px;margin:10px 0}
  dl>div{display:grid;grid-template-columns:8rem minmax(0,1fr);gap:8px}dt,small{color:var(--muted)}dd{margin:0;min-width:0;overflow-wrap:anywhere}
  .actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.actions>*{max-width:100%;white-space:normal;overflow-wrap:anywhere}
  a{color:var(--accent);padding-block:6px}details{margin-top:8px}summary{cursor:pointer}ul{padding-left:20px;overflow-wrap:anywhere}
  @media(max-width:640px){dl>div{grid-template-columns:minmax(0,1fr);gap:0}.actions>*{min-height:44px}}
</style>
