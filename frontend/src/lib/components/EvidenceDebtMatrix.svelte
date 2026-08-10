<script lang="ts">
  import Pagination from './Pagination.svelte';
  import {
    EVIDENCE_DEBT_STATES,
    type EvidenceDebtOwner,
    type EvidenceDebtItem,
    type EvidenceDebtReview,
    type EvidenceDebtState,
  } from '../analysis/evidence-debt-review.ts';

  const PAGE_SIZE = 25;
  const stateLabels: Readonly<Record<EvidenceDebtState, string>> = {
    conflicting: 'Conflicting',
    rate_limited: 'Rate limited',
    unavailable: 'Unavailable',
    partial: 'Partial',
    stale: 'Stale',
    unsupported: 'Unsupported',
  };
  const actionLabels = {
    retry: 'Review retry',
    deep_lookup: 'Open Deep Lookup',
    case_review: 'Review case',
  } as const;

  let { review, now = new Date().toISOString(), oncase }: {
    review: EvidenceDebtReview;
    now?: string;
    oncase?: (caseId: string) => void;
  } = $props();
  let ownerFilter = $state<EvidenceDebtOwner | ''>('');
  let stateFilter = $state<EvidenceDebtState | ''>('');
  let sourceFilter = $state('');
  let page = $state(1);
  let previousScope = $state('');
  const sourceOptions = $derived([...new Map(review.items.map((item) => [item.sourceId, item.sourceLabel])).entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const filtered = $derived(review.items.filter((item) => (
    (!ownerFilter || item.owner === ownerFilter)
    && (!stateFilter || item.states.includes(stateFilter))
    && (!sourceFilter || item.sourceId === sourceFilter)
  )));
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(page, pageCount));
  const visible = $derived(filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));
  const scopeKey = $derived(`${review.sourceStates.bulk}:${review.sourceStates.cases}:${review.items.length}:${review.items[0]?.id ?? ''}`);
  const unavailableSources = $derived([
    review.sourceStates.bulk === 'unavailable' ? 'saved Bulk sessions' : '',
    review.sourceStates.cases === 'unavailable' ? 'Cases' : '',
  ].filter(Boolean));
  const loadingSources = $derived([
    review.sourceStates.bulk === 'loading' ? 'saved Bulk sessions' : '',
    review.sourceStates.cases === 'loading' ? 'Cases' : '',
  ].filter(Boolean));
  const metricText = $derived(review.countsComplete
    ? String(review.counts.all)
    : review.counts.all
      ? `${review.counts.all} visible · incomplete`
      : '—');

  $effect(() => {
    if (scopeKey === previousScope) return;
    previousScope = scopeKey;
    page = 1;
  });

  function resetFilters() {
    ownerFilter = '';
    stateFilter = '';
    sourceFilter = '';
    page = 1;
  }

  function setPage(value: number) {
    page = Math.max(1, Math.min(pageCount, Math.trunc(value)));
  }

  function formatDate(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-AU');
  }

  function openCase(event: MouseEvent, item: EvidenceDebtItem) {
    if (!oncase || item.owner !== 'case') return;
    event.preventDefault();
    oncase(item.ownerId);
  }
</script>

<section class="evidence-debt card" aria-labelledby="evidence-debt-title" aria-busy={loadingSources.length > 0}>
  <div class="review-heading">
    <div>
      <p class="eyebrow">Retained source review</p>
      <h2 id="evidence-debt-title">Evidence-debt matrix</h2>
      <p>Exact saved Bulk source states and separately pinned case gaps, ranked as a manual next-evidence queue.</p>
    </div>
    <strong>{metricText}{#if review.countsComplete}{' '}<span class="sr-only">actionable evidence-debt items</span>{/if}</strong>
  </div>

  {#if unavailableSources.length}
    <p class="source-warning" role="alert">Evidence-debt counts are incomplete because {unavailableSources.join(' and ')} could not be read. Readable sources remain visible.</p>
  {/if}
  {#if loadingSources.length}
    <p class="source-loading" role="status" aria-live="polite">Loading {loadingSources.join(' and ')} before reporting a complete evidence-debt count.</p>
  {/if}

  {#if review.matrix.length}
    <details class="matrix" open>
      <summary>Source-by-state matrix</summary>
      <div class="table-wrap desktop-matrix">
        <table>
          <thead>
            <tr><th>Owner</th><th>Source</th>{#each EVIDENCE_DEBT_STATES as state}<th>{stateLabels[state]}</th>{/each}<th>State total</th></tr>
          </thead>
          <tbody>
            {#each review.matrix as row (row.id)}
              <tr>
                <td>{row.owner === 'bulk' ? 'Bulk' : 'Case pin'}</td>
                <th scope="row">{row.sourceLabel}</th>
                {#each EVIDENCE_DEBT_STATES as state}<td>{row.counts[state]}</td>{/each}
                <td><strong>{row.total}</strong></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <ul class="mobile-matrix">
        {#each review.matrix as row (row.id)}
          <li>
            <strong>{row.sourceLabel}</strong><span>{row.owner === 'bulk' ? 'Bulk' : 'Case pin'} · {row.total} state{row.total === 1 ? '' : 's'}</span>
            <dl>{#each EVIDENCE_DEBT_STATES as state}{#if row.counts[state]}<div><dt>{stateLabels[state]}</dt><dd>{row.counts[state]}</dd></div>{/if}{/each}</dl>
          </li>
        {/each}
      </ul>
    </details>
  {/if}

  <div class="queue-heading">
    <div>
      <h3>Next-evidence queue</h3>
      <p>High-impact source failures and conflicts lead; medium-impact partial, stale, or unsupported evidence follows.</p>
    </div>
    <span>{filtered.length} visible</span>
  </div>
  <div class="filters" role="group" aria-label="Evidence-debt queue filters">
    <label>Owner
      <select bind:value={ownerFilter} onchange={() => { page = 1; }}>
        <option value="">All owners</option>
        <option value="bulk">Bulk</option>
        <option value="case">Case pins</option>
      </select>
    </label>
    <label>State
      <select bind:value={stateFilter} onchange={() => { page = 1; }}>
        <option value="">All actionable states</option>
        {#each EVIDENCE_DEBT_STATES as state}<option value={state}>{stateLabels[state]}</option>{/each}
      </select>
    </label>
    <label>Source
      <select bind:value={sourceFilter} onchange={() => { page = 1; }}>
        <option value="">All retained sources</option>
        {#each sourceOptions as [id, label]}<option value={id}>{label}</option>{/each}
      </select>
    </label>
    <button type="button" class="secondary" onclick={resetFilters}>Reset filters</button>
  </div>

  {#if visible.length}
    <ol class="queue">
      {#each visible as item (item.id)}
        <li class:high={item.priority === 'high'}>
          <div class="queue-main">
            <div class="badges">
              <span>{item.owner === 'bulk' ? 'Bulk' : 'Case pin'}</span>
              <span>{item.priority} impact</span>
              {#each item.states as state}<span>{stateLabels[state]}</span>{/each}
            </div>
            <h4>{item.domain} · {item.sourceLabel}</h4>
            <p>{item.detail}</p>
            <small>{item.ownerLabel} · observed {formatDate(item.observedAt)}</small>
            <p class="effect">{item.expectedEffect}</p>
            <p class="disclosure">{item.disclosure}</p>
            {#if item.limitations.length}<ul class="item-limitations">{#each item.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
          </div>
          <div class="actions">
            <a class="btn" href={item.nextHref} onclick={(event) => { if (item.nextAction === 'case_review') openCase(event, item); }}>{actionLabels[item.nextAction]}</a>
            {#if item.reviewHref !== item.nextHref}<a class="btn secondary" href={item.reviewHref} onclick={(event) => openCase(event, item)}>Open retained owner</a>{/if}
          </div>
        </li>
      {/each}
    </ol>
    <Pagination {currentPage} {pageCount} {setPage} ariaLabel="Evidence-debt queue pages" />
  {:else if review.truncated}
    <p class="empty incomplete">No matching item is visible within the bounded queue. Omitted items may remain.</p>
  {:else if review.countsComplete}
    <p class="empty">No actionable partial, stale, conflicting, rate-limited, unsupported, or unavailable state matches this view.</p>
  {:else}
    <p class="empty incomplete">No actionable debt is visible in the currently readable evidence. The total remains incomplete.</p>
  {/if}

  {#if review.retention.bulkRowsWithoutCoverage || review.retention.casesWithoutPins || review.retention.explicitlySkipped || review.retention.explicitlyNotFound || review.retention.resolvedCasesExcluded || review.retention.reviewedCasePinsExcluded}
    <div class="retention-note">
      <h3>Retention boundary</h3>
      <ul>
        {#if review.retention.bulkRowsWithoutCoverage}<li>{review.retention.bulkRowsWithoutCoverage} scanned Bulk row{review.retention.bulkRowsWithoutCoverage === 1 ? ' has' : 's have'} no retained per-source coverage.</li>{/if}
        {#if review.retention.casesWithoutPins}<li>{review.retention.casesWithoutPins} active case{review.retention.casesWithoutPins === 1 ? ' has' : 's have'} no separately pinned evidence source.</li>{/if}
        {#if review.retention.explicitlySkipped}<li>{review.retention.explicitlySkipped} retained source state{review.retention.explicitlySkipped === 1 ? '' : 's'} explicitly {review.retention.explicitlySkipped === 1 ? 'records' : 'record'} skipped collection.</li>{/if}
        {#if review.retention.explicitlyNotFound}<li>{review.retention.explicitlyNotFound} retained source observation{review.retention.explicitlyNotFound === 1 ? '' : 's'} explicitly {review.retention.explicitlyNotFound === 1 ? 'reports' : 'report'} not found within that source's scope.</li>{/if}
        {#if review.retention.resolvedCasesExcluded}<li>{review.retention.resolvedCasesExcluded} resolved case{review.retention.resolvedCasesExcluded === 1 ? ' is' : 's are'} outside the active debt queue.</li>{/if}
        {#if review.retention.reviewedCasePinsExcluded}<li>{review.retention.reviewedCasePinsExcluded} case pin{review.retention.reviewedCasePinsExcluded === 1 ? ' is' : 's are'} covered by an exact current reviewed gap dismissal and excluded from this actionable queue.</li>{/if}
      </ul>
      <p>No retained record is not the same as an explicit skip, and neither means a source reported absence.</p>
    </div>
  {/if}

  {#if review.truncated}
    <p class="bound-warning">Bounded projection: {review.omissions.items} queue item{review.omissions.items === 1 ? '' : 's'}, {review.omissions.matrixRows} matrix source row{review.omissions.matrixRows === 1 ? '' : 's'}, {review.omissions.bulkRows} Bulk row{review.omissions.bulkRows === 1 ? '' : 's'}, and {review.omissions.casePins} case pin{review.omissions.casePins === 1 ? '' : 's'} were outside display or scan bounds.</p>
  {/if}
  {#if review.omissions.olderBulkObservations}
    <p class="superseded-note">{review.omissions.olderBulkObservations} older duplicate Bulk source observation{review.omissions.olderBulkObservations === 1 ? ' was' : 's were'} superseded by a newer exact saved observation.</p>
  {/if}
  <ul class="limitations">{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul>
</section>

<style>
  .evidence-debt{margin-top:16px;padding:var(--card-pad)}
  .review-heading,.queue-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  .review-heading>div,.queue-heading>div,.queue-main{min-width:0}
  .review-heading h2,.review-heading p,.queue-heading h3,.queue-heading p{margin:0}
  .review-heading h2{margin-top:3px;font:700 var(--text-lg) var(--mono)}
  .review-heading>div>p:last-child,.queue-heading p{margin-top:6px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .review-heading>strong{max-width:220px;color:var(--accent2);font:750 var(--text-xl) var(--mono);text-align:right;overflow-wrap:anywhere}
  .eyebrow{color:var(--accent);font:650 var(--text-2xs) var(--mono);letter-spacing:.1em;text-transform:uppercase}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0}
  .source-warning,.source-loading,.bound-warning{margin:14px 0 0;padding:10px 12px;border-left:3px solid var(--amber);border-radius:var(--radius-sm);background:rgb(var(--amber-rgb) / .08);color:var(--text);font-size:var(--text-sm);line-height:1.5;overflow-wrap:anywhere}
  .superseded-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .matrix{margin-top:18px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .matrix summary{padding:12px 14px;cursor:pointer;font-weight:700}
  .table-wrap{overflow:auto;border-top:1px solid var(--border)}
  table{width:100%;border-collapse:collapse;font-size:var(--text-xs)}
  th,td{padding:9px 11px;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap}
  thead th{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
  .mobile-matrix{display:none}
  .queue-heading{margin-top:22px}
  .queue-heading h3{font:700 var(--text-md) var(--mono)}
  .queue-heading>span{flex:0 0 auto;color:var(--muted);font:650 var(--text-xs) var(--mono)}
  .filters{display:grid;grid-template-columns:repeat(3,minmax(130px,1fr)) auto;align-items:end;gap:8px;margin:14px 0}
  .filters label{display:grid;gap:5px;min-width:0;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .filters select{width:100%;min-width:0;min-height:36px}
  .filters button{min-height:36px}
  .queue{display:grid;gap:9px;margin:0;padding:0;list-style:none}
  .queue>li{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:14px;border-left:3px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .queue>li.high{border-left-color:var(--amber)}
  .badges{display:flex;flex-wrap:wrap;gap:6px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .badges span{padding:2px 6px;border-radius:99px;background:var(--border)}
  .queue h4,.queue p{margin:0;overflow-wrap:anywhere}
  .queue h4{margin-top:7px;font-size:var(--text-sm)}
  .queue-main>p{margin-top:5px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .queue small{display:block;margin-top:7px;color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .queue .effect{color:var(--text)}
  .queue .disclosure{font-size:var(--text-xs)}
  .item-limitations{margin:7px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-xs)}
  .item-limitations li{overflow-wrap:anywhere}
  .actions{display:flex;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end;gap:7px;max-width:250px}
  .actions a{text-decoration:none;text-align:center}
  .empty{margin:12px 0 0;padding:14px;border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted)}
  .empty.incomplete{border-left:3px solid var(--amber)}
  .retention-note{margin-top:16px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .retention-note h3,.retention-note p{margin:0}
  .retention-note h3{font:700 var(--text-sm) var(--mono)}
  .retention-note ul{margin:8px 0;padding-left:19px;color:var(--muted);font-size:var(--text-sm)}
  .retention-note p{color:var(--muted);font-size:var(--text-xs)}
  .limitations{margin:14px 0 0;padding-left:19px;color:var(--muted);font-size:var(--text-xs)}
  .limitations li{margin-top:4px;overflow-wrap:anywhere}
  @media(max-width:800px){
    .filters{grid-template-columns:repeat(2,minmax(0,1fr))}
    .queue>li{display:grid}
    .actions{max-width:none;justify-content:flex-start}
  }
  @media(max-width:560px){
    .review-heading,.queue-heading{display:grid}
    .review-heading>strong{text-align:left}
    .desktop-matrix{display:none}
    .mobile-matrix{display:grid;gap:8px;margin:0;padding:0 10px 10px;list-style:none}
    .mobile-matrix li{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
    .mobile-matrix strong,.mobile-matrix>li>span{display:block;overflow-wrap:anywhere}
    .mobile-matrix>li>span{margin-top:3px;color:var(--muted);font-size:var(--text-xs)}
    .mobile-matrix dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:9px 0 0}
    .mobile-matrix dl div{display:flex;justify-content:space-between;gap:7px;min-width:0;padding:5px 7px;border-radius:var(--radius-sm);background:var(--panel-raised)}
    .mobile-matrix dt{min-width:0;color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
    .mobile-matrix dd{margin:0;font-weight:700}
    .filters{grid-template-columns:minmax(0,1fr)}
    .actions{display:grid;width:100%}
    .actions a{width:100%}
  }
</style>
