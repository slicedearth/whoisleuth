<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import type {
    BrandAssetClassification,
    BrandAssetRegisterProjection,
    BrandAssetRegisterRow,
    BrandAssetSourceSummary,
  } from '$lib/analysis/brand-asset-register.ts';
  import Pagination from './Pagination.svelte';

  type AssetClassFilter = 'all' | BrandAssetClassification;
  type AssetSourceFilter = 'all' | 'profile' | 'case' | 'relationship';
  type AssetEvidenceFilter = 'all' | 'complete' | 'partial' | 'unavailable' | 'not_applicable';

  const PAGE_SIZE = 50;
  const CLASS_OPTIONS: readonly { value: AssetClassFilter; label: string }[] = [
    { value: 'all', label: 'All classifications' },
    { value: 'authored_official', label: 'Official' },
    { value: 'authored_partner', label: 'Partner' },
    { value: 'authored_allowlisted', label: 'Allowlisted' },
    { value: 'retained_case_scope', label: 'Case scope' },
    { value: 'observed_relationship_lead', label: 'Observed lead' },
  ];
  const SOURCE_OPTIONS: readonly { value: AssetSourceFilter; label: string }[] = [
    { value: 'all', label: 'All sources' },
    { value: 'profile', label: 'Brand Profile' },
    { value: 'case', label: 'Cases' },
    { value: 'relationship', label: 'Relationships' },
  ];
  const EVIDENCE_OPTIONS: readonly { value: AssetEvidenceFilter; label: string }[] = [
    { value: 'all', label: 'All evidence states' },
    { value: 'complete', label: 'Complete' },
    { value: 'partial', label: 'Partial' },
    { value: 'unavailable', label: 'Unavailable' },
    { value: 'not_applicable', label: 'Not applicable' },
  ];
  const CLASS_LABELS: Readonly<Record<BrandAssetClassification, string>> = {
    authored_official: 'Official',
    authored_partner: 'Partner',
    authored_allowlisted: 'Allowlisted',
    retained_case_scope: 'Case scope',
    observed_relationship_lead: 'Observed lead',
  };

  let { projection }: { projection: BrandAssetRegisterProjection } = $props();
  let domainFilter = $state('');

  const rawClass = $derived(page.url.searchParams.get('assetClass') ?? 'all');
  const assetClass = $derived(
    CLASS_OPTIONS.some((option) => option.value === rawClass) ? rawClass as AssetClassFilter : 'all',
  );
  const rawSource = $derived(page.url.searchParams.get('assetSource') ?? 'all');
  const assetSource = $derived(
    SOURCE_OPTIONS.some((option) => option.value === rawSource) ? rawSource as AssetSourceFilter : 'all',
  );
  const rawEvidence = $derived(page.url.searchParams.get('assetEvidence') ?? 'all');
  const assetEvidence = $derived(
    EVIDENCE_OPTIONS.some((option) => option.value === rawEvidence) ? rawEvidence as AssetEvidenceFilter : 'all',
  );
  const requestedPage = $derived.by(() => {
    const raw = page.url.searchParams.get('assetPage');
    return raw && /^\d{1,6}$/u.test(raw) && Number(raw) > 0 ? Number(raw) : 1;
  });
  const filteredRows = $derived(projection.rows.filter((row) => {
    if (assetClass !== 'all' && !row.classifications.includes(assetClass)) return false;
    if (assetSource !== 'all' && !matchesSource(row, assetSource)) return false;
    if (assetEvidence !== 'all' && row.observationalCompleteness !== assetEvidence) return false;
    const query = domainFilter.trim().toLowerCase();
    return !query || row.domain.includes(query);
  }));
  const pageCount = $derived(Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(requestedPage, pageCount));
  const visibleRows = $derived(filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));
  const firstVisible = $derived(filteredRows.length ? ((currentPage - 1) * PAGE_SIZE) + 1 : 0);
  const lastVisible = $derived(Math.min(currentPage * PAGE_SIZE, filteredRows.length));

  function matchesSource(row: BrandAssetRegisterRow, source: Exclude<AssetSourceFilter, 'all'>): boolean {
    if (source === 'profile') return row.classifications.some((classification) => classification.startsWith('authored_'));
    if (source === 'case') return row.classifications.includes('retained_case_scope');
    return row.classifications.includes('observed_relationship_lead');
  }

  function classLabel(classification: BrandAssetClassification): string {
    return CLASS_LABELS[classification];
  }

  function evidenceLabel(value: string): string {
    return value === 'not_applicable' ? 'Not applicable' : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
  }

  function sourceMetric(source: BrandAssetSourceSummary, kind: 'records' | 'matched'): string {
    if (source.state === 'loading') return 'Loading';
    if (source.state === 'unavailable') return 'Unavailable';
    return String(kind === 'records' ? source.recordCount ?? 0 : source.matchedCount ?? 0);
  }

  function formatDate(value: string | null): string {
    if (!value) return 'Unavailable';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unavailable' : parsed.toLocaleString('en-AU');
  }

  async function updateCategoricalFilter(parameter: 'assetClass' | 'assetSource' | 'assetEvidence', value: string) {
    const url = new URL(page.url);
    url.searchParams.set('view', 'assets');
    if (value === 'all') url.searchParams.delete(parameter);
    else url.searchParams.set(parameter, value);
    url.searchParams.delete('assetPage');
    url.hash = '';
    await goto(`${url.pathname}${url.search}`, { noScroll: true, keepFocus: true });
    await tick();
    const controlId = parameter === 'assetClass'
      ? 'brand-asset-class-filter'
      : parameter === 'assetSource'
        ? 'brand-asset-source-filter'
        : 'brand-asset-evidence-filter';
    document.getElementById(controlId)?.focus({ preventScroll: true });
  }

  async function setAssetPage(nextPage: number) {
    const url = new URL(page.url);
    url.searchParams.set('view', 'assets');
    if (nextPage <= 1) url.searchParams.delete('assetPage');
    else url.searchParams.set('assetPage', String(nextPage));
    url.hash = '';
    await goto(`${url.pathname}${url.search}`, { noScroll: true, keepFocus: true });
    await tick();
    document.getElementById('brand-asset-register-title')?.focus({ preventScroll: true });
  }
</script>

<section class="asset-register card" aria-labelledby="brand-asset-register-title" aria-busy={projection.state === 'loading'}>
  <header class="register-heading">
    <div>
      <p class="eyebrow">Active profile scope</p>
      <h2 id="brand-asset-register-title" tabindex="-1">Brand asset register</h2>
      <p>Canonical domains from authored roles, exact profile-associated Cases, and non-transitive one-hop retained observations.</p>
    </div>
    <strong class:numeric={projection.state === 'ready' || projection.state === 'partial'}>{projection.state === 'unavailable' ? 'Unavailable' : projection.state === 'loading' && !projection.rows.length ? 'Loading' : projection.rows.length}</strong>
  </header>

  {#if projection.state === 'unavailable'}
    <p class="source-alert" role="alert">The register is unavailable because Brand Profiles or the active-profile preference could not be read. Rows are suppressed and no empty-state conclusion has been drawn.</p>
  {:else if projection.state === 'no_active_profile'}
    <div class="empty-state"><h3>No active Brand Profile</h3><p>Set a profile active above to build a transient asset register.</p></div>
  {:else if projection.state === 'unresolved_active_profile'}
    <div class="empty-state"><h3>Active profile unresolved</h3><p>The saved active-profile reference does not match a readable local Brand Profile. It has not been cleared or reassigned.</p></div>
  {:else}
    {#if projection.state === 'loading'}
      <p class="loading-state" role="status" aria-live="polite">Loading browser-local Cases and retained relationship observations. Readable direct rows may update as each source settles.</p>
    {/if}
    {#if projection.sources.cases.state === 'unavailable'}
      <p class="source-alert" role="alert">Cases could not be read. Direct profile rows remain visible with partial coverage; the associated-Case count is Unavailable, not zero.</p>
    {/if}
    {#if projection.sources.relationships.state === 'unavailable'}
      <p class="source-alert" role="alert">Retained relationship observations could not be read. Direct rows remain visible with partial coverage; the qualifying-relationship count is Unavailable, not zero.</p>
    {/if}

    <div class="source-summary" role="group" aria-label="Brand asset source states">
      <article><span>Profile rows</span><strong>{projection.counts.authored_official + projection.counts.authored_partner + projection.counts.authored_allowlisted}</strong></article>
      <article><span>Cases · matched / retained</span><strong>{sourceMetric(projection.sources.cases, 'matched')} / {sourceMetric(projection.sources.cases, 'records')}</strong></article>
      <article><span>Relationships · matched / retained</span><strong>{sourceMetric(projection.sources.relationships, 'matched')} / {sourceMetric(projection.sources.relationships, 'records')}</strong></article>
      <article><span>Coverage</span><strong>{projection.state === 'ready' ? 'Complete' : projection.state === 'loading' ? 'Loading' : 'Partial'}</strong></article>
    </div>

    <form class="filters" aria-label="Brand asset filters" onsubmit={(event) => event.preventDefault()}>
      <label>Classification<select id="brand-asset-class-filter" value={assetClass} onchange={(event) => void updateCategoricalFilter('assetClass', event.currentTarget.value)}>{#each CLASS_OPTIONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
      <label>Source<select id="brand-asset-source-filter" value={assetSource} onchange={(event) => void updateCategoricalFilter('assetSource', event.currentTarget.value)}>{#each SOURCE_OPTIONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
      <label>Observation evidence<select id="brand-asset-evidence-filter" value={assetEvidence} onchange={(event) => void updateCategoricalFilter('assetEvidence', event.currentTarget.value)}>{#each EVIDENCE_OPTIONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
      <label>Domain contains<input type="search" value={domainFilter} oninput={(event) => { domainFilter = event.currentTarget.value; }} autocomplete="off" placeholder="Filter this page locally"></label>
    </form>

    <p class="count-status" role="status" aria-live="polite" aria-atomic="true">{filteredRows.length} matching asset row{filteredRows.length === 1 ? '' : 's'}. {filteredRows.length ? `Showing ${firstVisible}–${lastVisible}.` : 'No rows match the current filters.'}</p>

    {#if projection.omissions.rows || projection.omissions.caseReferences || projection.omissions.relationshipReferences}
      <p class="omissions" role="status">Coverage bounds omitted {projection.omissions.rows} row{projection.omissions.rows === 1 ? '' : 's'}, {projection.omissions.caseReferences} Case reference{projection.omissions.caseReferences === 1 ? '' : 's'}, and {projection.omissions.relationshipReferences} relationship reference{projection.omissions.relationshipReferences === 1 ? '' : 's'}.</p>
    {/if}

    {#if visibleRows.length}
      <div class="table-wrap">
        <table>
          <caption class="visually-hidden">Filtered Brand Asset Register rows</caption>
          <thead><tr><th scope="col">Domain</th><th scope="col">Classification</th><th scope="col">Reason</th><th scope="col">Source and state</th><th scope="col">Timestamps</th><th scope="col">Local links</th></tr></thead>
          <tbody>
            {#each visibleRows as row (row.key)}
              <tr>
                <th scope="row"><code>{row.domain}</code><small>{row.key}</small></th>
                <td><strong>{classLabel(row.primaryClassification)}</strong><div class="chips">{#each row.classifications as classification}<span>{classLabel(classification)}</span>{/each}</div></td>
                <td><ul>{#each row.explanations as explanation}<li>{explanation}</li>{/each}</ul></td>
                <td><ul>{#each row.provenanceLabels as label}<li>{label}</li>{/each}</ul><small>Row coverage: {row.coverage}<br>Observation evidence: {evidenceLabel(row.observationalCompleteness)}</small></td>
                <td><dl class="timestamps"><div><dt>Authored</dt><dd>Unavailable</dd></div><div><dt>Profile revision</dt><dd>{formatDate(row.timestamps.profileRevisionAt)}</dd></div><div><dt>Case retained</dt><dd>{formatDate(row.timestamps.caseRetainedAt)}</dd></div><div><dt>Observed</dt><dd>{formatDate(row.timestamps.latestObservedAt)}</dd></div><div><dt>Relationship retained</dt><dd>{formatDate(row.timestamps.latestRelationshipRetainedAt)}</dd></div></dl></td>
                <td><div class="local-links">{#each row.caseReferences as reference}<a href={`/monitor?view=cases&case=${encodeURIComponent(reference.id)}`} aria-label={`Open Case ${reference.id} for ${row.domain}`}>Case · {reference.sourceLabel}</a>{/each}{#each row.relationshipReferences as reference}<a href={`/monitor?view=relationships&observation=${encodeURIComponent(reference.id)}`} aria-label={`Open retained relationship ${reference.id} for ${row.domain}`}>{reference.label}</a>{/each}{#if !row.caseReferences.length && !row.relationshipReferences.length}<span>None</span>{/if}</div></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="asset-cards">
        {#each visibleRows as row (row.key)}
          <article>
            <header><div><h3>{row.domain}</h3><small>{row.key}</small></div><strong>{classLabel(row.primaryClassification)}</strong></header>
            <div class="chips">{#each row.classifications as classification}<span>{classLabel(classification)}</span>{/each}</div>
            <dl>
              <div><dt>Why present</dt><dd><ul>{#each row.explanations as explanation}<li>{explanation}</li>{/each}</ul></dd></div>
              <div><dt>Source and state</dt><dd>{row.provenanceLabels.join(' · ')}<small>Row coverage: {row.coverage} · observation evidence: {evidenceLabel(row.observationalCompleteness)}</small></dd></div>
              <div><dt>Timestamps</dt><dd><span>Authored: Unavailable</span><span>Profile revision: {formatDate(row.timestamps.profileRevisionAt)}</span><span>Case retained: {formatDate(row.timestamps.caseRetainedAt)}</span><span>Observed: {formatDate(row.timestamps.latestObservedAt)}</span><span>Relationship retained: {formatDate(row.timestamps.latestRelationshipRetainedAt)}</span></dd></div>
              <div><dt>Local links</dt><dd class="local-links">{#each row.caseReferences as reference}<a href={`/monitor?view=cases&case=${encodeURIComponent(reference.id)}`} aria-label={`Open Case ${reference.id} for ${row.domain}`}>Case · {reference.sourceLabel}</a>{/each}{#each row.relationshipReferences as reference}<a href={`/monitor?view=relationships&observation=${encodeURIComponent(reference.id)}`} aria-label={`Open retained relationship ${reference.id} for ${row.domain}`}>{reference.label}</a>{/each}{#if !row.caseReferences.length && !row.relationshipReferences.length}<span>None</span>{/if}</dd></div>
            </dl>
          </article>
        {/each}
      </div>
      <Pagination {currentPage} {pageCount} setPage={(value) => void setAssetPage(value)} ariaLabel="Brand asset register pages" />
    {:else if projection.state !== 'loading'}
      <p class="empty-state">No retained local domain matches the current register filters.</p>
    {/if}

    <details class="limitations"><summary>Interpretation limits</summary><ul>{#each projection.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
  {/if}
</section>

<style>
  .asset-register{display:grid;gap:14px;min-width:0;padding:var(--card-pad)}
  .register-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  .register-heading>div{min-width:0}
  .register-heading h2,.register-heading p{margin:0;overflow-wrap:anywhere}
  .register-heading h2{margin-top:3px;font:700 var(--text-lg) var(--mono);scroll-margin-top:18px}
  .register-heading h2:focus{outline:2px solid var(--accent);outline-offset:4px;border-radius:2px}
  .register-heading p:last-child{max-width:78ch;margin-top:7px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .register-heading>strong{max-width:40%;color:var(--muted);font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere;text-align:right}
  .register-heading>strong.numeric{color:var(--accent2);font-size:2rem}
  .source-alert,.loading-state,.omissions,.empty-state{margin:0;padding:10px 12px;border:1px dotted var(--muted);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font-size:var(--text-sm);line-height:1.5;overflow-wrap:anywhere}
  .omissions{border-color:var(--amber);color:var(--amber)}
  .empty-state h3,.empty-state p{margin:0}.empty-state p{margin-top:5px}
  .source-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .source-summary article{display:grid;min-width:0;gap:4px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .source-summary span{color:var(--muted);font-size:var(--text-2xs);text-transform:uppercase;letter-spacing:.04em;overflow-wrap:anywhere}
  .source-summary strong{font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  .filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .filters label{display:grid;min-width:0;gap:5px;color:var(--muted);font-size:var(--text-xs)}
  .filters select,.filters input{min-width:0;width:100%}
  .count-status{margin:0;color:var(--muted);font-size:var(--text-sm)}
  .table-wrap{max-width:100%;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md)}
  table{width:100%;min-width:1220px;border-collapse:collapse;background:var(--panel)}
  th,td{min-width:0;padding:10px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);text-align:left;vertical-align:top;font-size:var(--text-2xs)}
  th:last-child,td:last-child{border-right:0}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
  thead th{color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  tbody th{width:190px}tbody th code,tbody th small{display:block;max-width:190px;overflow-wrap:anywhere;white-space:normal}tbody th small{margin-top:5px;color:var(--muted);font-weight:400}
  td>strong{font-family:var(--mono)}td ul{margin:0;padding-left:16px}td li{margin-bottom:4px;line-height:1.4;overflow-wrap:anywhere}
  td>small{display:block;margin-top:7px;color:var(--muted);line-height:1.5;text-transform:capitalize}
  .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.chips span{padding:2px 6px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font-size:var(--text-2xs)}
  .timestamps{display:grid;gap:4px;margin:0}.timestamps div{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:6px}.timestamps dt{color:var(--muted)}.timestamps dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .local-links{display:grid;gap:5px;min-width:0}.local-links a,.local-links span{overflow-wrap:anywhere}
  .asset-cards{display:none}.limitations{color:var(--muted);font-size:var(--text-sm)}.limitations summary{cursor:pointer;color:var(--text);font-weight:650}.limitations ul{padding-left:20px}.limitations li{margin-top:6px;overflow-wrap:anywhere}
  .visually-hidden{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:900px){.source-summary,.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:760px){.register-heading{display:grid}.register-heading>strong.numeric{font-size:1.6rem}.table-wrap{display:none}.asset-cards{display:grid;gap:10px}.asset-cards article{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}.asset-cards article>header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.asset-cards h3,.asset-cards header small{margin:0;overflow-wrap:anywhere}.asset-cards h3{font:700 var(--text-sm) var(--mono)}.asset-cards header small{display:block;margin-top:4px;color:var(--muted);font-size:var(--text-2xs)}.asset-cards header>strong{max-width:42%;color:var(--accent2);font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere;text-align:right}.asset-cards dl{display:grid;gap:8px;margin:12px 0 0}.asset-cards dl>div{display:grid;grid-template-columns:minmax(0,.7fr) minmax(0,1.3fr);gap:9px;padding-top:8px;border-top:1px solid var(--border)}.asset-cards dt,.asset-cards dd{min-width:0;margin:0;font-size:var(--text-xs);overflow-wrap:anywhere}.asset-cards dt{color:var(--muted)}.asset-cards dd ul{margin:0;padding-left:17px}.asset-cards dd small,.asset-cards dd>span{display:block;margin-top:4px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}}
  @media(max-width:520px){.source-summary,.filters{grid-template-columns:1fr}.asset-cards article>header{display:grid}.asset-cards header>strong{max-width:100%;text-align:left}.asset-cards dl>div{grid-template-columns:1fr}}
</style>
