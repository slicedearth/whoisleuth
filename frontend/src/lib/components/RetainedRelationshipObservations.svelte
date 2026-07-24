<script lang="ts">
  import Pagination from '$lib/components/Pagination.svelte';
  import type { RelationshipObservation } from '$lib/relationship-observations';

  const PAGE_SIZE = 10;

  let {
    records,
    focusId = '',
    ondelete,
  }: {
    records: RelationshipObservation[];
    focusId?: string;
    ondelete: (record: RelationshipObservation) => void | Promise<void>;
  } = $props();

  let page = $state(1);
  let focusedId = $state('');
  const pageCount = $derived(Math.max(1, Math.ceil(records.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(page, pageCount));
  const visibleRecords = $derived(records.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));

  function setPage(value: number) {
    page = Math.min(pageCount, Math.max(1, Math.trunc(value)));
  }

  function date(value: string) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unknown time' : parsed.toLocaleString();
  }

  function typeLabel(value: string) {
    return value.replaceAll('_', ' ');
  }

  $effect(() => {
    if (!focusId || focusedId === focusId) return;
    const index = records.findIndex((record) => record.id === focusId);
    if (index < 0) return;
    page = Math.floor(index / PAGE_SIZE) + 1;
    focusedId = focusId;
    requestAnimationFrame(() => {
      const target = document.getElementById(`retained-${focusId}`);
      target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
    });
  });
</script>

<section class="retained-observations card" aria-labelledby="retained-observation-title">
  <header class="section-head">
    <div>
      <p class="eyebrow">Analyst-selected pivots</p>
      <h2 id="retained-observation-title">Retained relationship observations</h2>
      <p>Only relationships deliberately retained from Bulk appear here. The complete scan and raw lookup responses remain transient.</p>
    </div>
    <span>{records.length} retained</span>
  </header>

  {#if records.length}
    <ol>
      {#each visibleRecords as record (record.id)}
        <li id={`retained-${record.id}`} tabindex="-1" class:focused={record.id === focusId}>
          <div class="record-heading">
            <div>
              <span class="type">{typeLabel(record.type)}</span>
              <h3>{record.label}</h3>
            </div>
            <span class:partial={!record.complete || record.truncated}>{record.complete && !record.truncated ? 'Complete input' : 'Partial input'}</span>
          </div>
          <dl>
            <div><dt>Method</dt><dd>{record.method || 'Unavailable'}</dd></div>
            <div><dt>Value</dt><dd><code>{record.displayValue || record.normalizedValue}</code></dd></div>
            <div><dt>Observed</dt><dd>{date(record.observedAt)}</dd></div>
            <div><dt>Classification</dt><dd>Derived observation</dd></div>
          </dl>
          <div class="domains" aria-label={`${record.domains.length} member domains`}>
            {#each record.domains as domain}<a class="btn small" href={`/lookup?q=${encodeURIComponent(domain)}`}>{domain}</a>{/each}
          </div>
          <p>{record.description}</p>
          {#if record.limitations.length}
            <details><summary>Provenance and limitations</summary><ul>{#each record.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
          {/if}
          <button class="btn small danger" type="button" onclick={() => ondelete(record)}>Delete retained observation</button>
        </li>
      {/each}
    </ol>
    <Pagination {currentPage} {pageCount} {setPage} ariaLabel="Retained relationship observation pages" />
    <p class="projection-note">When at least two member domains also have local cases, this observation contributes a separately attributed pivot to the relationship graph and table below.</p>
  {:else}
    <div class="empty">
      <h3>No retained relationship observations</h3>
      <p>Run a Bulk comparison, review an observed relationship, then choose <strong>Retain observation</strong>. Nothing is saved automatically.</p>
      <a class="btn" href="/bulk">Open Bulk</a>
    </div>
  {/if}
</section>

<style>
  .retained-observations{margin-bottom:18px;padding:18px;min-width:0}
  .retained-observations h2,.retained-observations h3{margin:0}
  .section-head>div>p:not(.eyebrow),.projection-note,.empty p,li>p{color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .section-head>div>p:not(.eyebrow){margin:6px 0 0}
  .section-head>span{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  ol{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:15px 0 0;padding:0;list-style:none}
  li{min-width:0;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  li.focused{border-color:var(--accent);box-shadow:0 0 0 2px rgb(var(--accent-rgb) / .12)}
  .record-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  .record-heading .type{color:var(--accent2);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .record-heading h3{margin-top:4px;font-size:var(--text-md)}
  .record-heading>span{flex:none;color:var(--success);font:700 var(--text-2xs) var(--mono)}
  .record-heading>span.partial{color:var(--amber)}
  dl{display:grid;gap:5px;margin:12px 0 0}
  dl>div{display:grid;grid-template-columns:88px minmax(0,1fr);gap:7px}
  dt{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  dd{min-width:0;margin:0;overflow-wrap:anywhere;font-size:var(--text-xs)}
  code{font:var(--text-xs) var(--mono);color:var(--accent)}
  .domains{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px}
  li>p{margin:10px 0}
  details{margin-top:10px;color:var(--muted);font-size:var(--text-xs)}
  details summary{cursor:pointer;font-weight:700}
  details ul{padding-left:20px;line-height:1.5}
  .danger{margin-top:10px}
  .projection-note{margin:12px 0 0}
  .empty{display:grid;min-height:180px;place-content:center;justify-items:center;text-align:center}
  .empty h3{font-size:var(--text-md)}
  .empty p{max-width:56ch}
  @media(max-width:760px){ol{grid-template-columns:1fr}}
  @media(max-width:480px){.record-heading{display:block}.record-heading>span{display:inline-block;margin-top:7px}dl>div{grid-template-columns:1fr;gap:2px}}
</style>
