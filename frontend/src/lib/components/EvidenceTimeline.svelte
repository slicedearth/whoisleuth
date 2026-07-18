<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import {
    currentEvidenceSummary,
    deriveTimeline,
    evidenceSourceLabel,
    filterChangedOnly,
    formatChangeEntry,
    formatSnapshotValue,
    scanDepthLabel,
    snapshotFieldGroups
  } from '$lib/analysis/evidence-display.js';

  let { record }: { record: CaseRecord } = $props();
  let timelineExpanded = $state(true);
  let changedOnly = $state(false);
  let expandedSnapshots = $state(new Set<string>());

  const summary = $derived(currentEvidenceSummary(record.evidenceHistory));
  const timeline = $derived(deriveTimeline(record.evidenceHistory));
  const visibleTimeline = $derived(changedOnly ? filterChangedOnly(timeline) : timeline);
  const filteredIncomparable = $derived(changedOnly && timeline.some(entry => entry.hasIncomparableChange && !visibleTimeline.includes(entry)));

  function incomparableLabel(reasons: string[]) {
    if (reasons.includes('risk-model') && reasons.includes('scan-depth')) return 'Model and depth limit comparison';
    if (reasons.includes('risk-model')) return 'Risk models differ';
    if (reasons.includes('scan-depth')) return 'Depth prevents comparison';
    return 'Comparison unavailable';
  }

  function incomparableNote(reasons: string[]) {
    const notes = [];
    if (reasons.includes('risk-model')) notes.push('Risk scores and factors use different or unversioned models, so their numeric difference is not treated as a domain change.');
    if (reasons.includes('scan-depth')) notes.push('The capture depths differ, so unevaluated deep signals are not treated as additions or removals.');
    if (notes.length === 0) notes.push('The observations differ materially, but no reliable field-level comparison is available.');
    return notes.join(' ');
  }

  function date(value: string | null) {
    if (!value) return 'Not observed';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

  function toggleSnapshot(id: string) {
    const next = new Set(expandedSnapshots);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedSnapshots = next;
  }
</script>

{#if summary}
  <dl class="evidence">
    <dt>Availability</dt><dd>{summary.availability ?? '—'}</dd>
    <dt>Risk</dt><dd>{summary.riskScore ?? '—'}{#if summary.riskModelVersion !== null} · model v{summary.riskModelVersion}{/if}</dd>
    <dt>Registrar</dt><dd>{summary.registrar ?? '—'}</dd>
    <dt>Website</dt><dd>{summary.activityStatus ?? '—'}</dd>
    <dt>Captured</dt><dd>{date(summary.capturedAt)}</dd>
  </dl>
{/if}

<section class="timeline" aria-labelledby={`timeline-heading-${record.id}`}>
  <div class="timeline-header">
    <h3 id={`timeline-heading-${record.id}`}>Evidence timeline <small>{timeline.length} snapshot{timeline.length===1?'':'s'}</small></h3>
    {#if timeline.length}
      <div class="timeline-controls">
        <button aria-expanded={timelineExpanded} aria-controls={`timeline-list-${record.id}`} onclick={()=>timelineExpanded=!timelineExpanded}>{timelineExpanded?'Collapse all':'Expand all'}</button>
        <button aria-pressed={changedOnly} onclick={()=>changedOnly=!changedOnly}>Material changes only</button>
      </div>
    {/if}
  </div>

  {#if !timeline.length}
    <p class="timeline-empty">No evidence captured yet. Open this case from a Lookup or Bulk result to record the first observation.</p>
  {:else if timelineExpanded}
    <ol id={`timeline-list-${record.id}`} class="timeline-list" aria-labelledby={`timeline-heading-${record.id}`}>
      {#each visibleTimeline as entry (entry.snapshot.id)}
        {@const snapId=`snap-${record.id}-${entry.snapshot.id}`}
        {@const bodyId=`snap-body-${record.id}-${entry.snapshot.id}`}
        {@const isExpanded=expandedSnapshots.has(entry.snapshot.id)}
        <li class="timeline-entry">
          <div class="timeline-entry-head">
            <button id={snapId} class="timeline-toggle" aria-expanded={isExpanded} aria-controls={bodyId} onclick={()=>toggleSnapshot(entry.snapshot.id)}>
              <span class="timeline-index">#{entry.displayIndex}</span>
              <time datetime={entry.snapshot.capturedAt}>{entry.hasRepeatedObservation?'Last observed ':'Captured '}{date(entry.snapshot.capturedAt)}</time>
            </button>
            <span class="timeline-badges">
              {#if entry.hasRepeatedObservation}<span class="timeline-badge timeline-repeat">First observed {date(entry.snapshot.firstCapturedAt)}</span>{/if}
              <span class="timeline-badge">{evidenceSourceLabel(entry.snapshot.source)}</span>
              <span class="timeline-badge">{scanDepthLabel(entry.snapshot.scanDepth)}</span>
              {#if entry.isBaseline}
                <span class="timeline-badge timeline-baseline">Baseline</span>
              {:else if entry.changes?.length}
                <span class="timeline-badge timeline-changed">{entry.changes.length} change{entry.changes.length===1?'':'s'}</span>
              {/if}
              {#if !entry.isBaseline && entry.hasIncomparableChange}<span class="timeline-badge timeline-incomparable">{incomparableLabel(entry.incomparableReasons)}</span>{/if}
            </span>
          </div>

          {#if entry.changes?.length}
            <ul class="timeline-changes" aria-label="Material changes from previous snapshot">
              {#each entry.changes as change}
                {@const formatted=formatChangeEntry(change)}
                <li class="timeline-change" class:tone-danger={formatted.tone==='danger'} class:tone-warn={formatted.tone==='warn'} class:tone-good={formatted.tone==='good'}>
                  <strong>{formatted.label}</strong><span class="change-kind">{formatted.kind}</span>
                  <span class="change-values"><span>{formatted.beforeText}</span><span class="change-arrow" aria-hidden="true">→</span><span>{formatted.afterText}</span></span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if entry.hasIncomparableChange}<p class="timeline-incomparable-note">{incomparableNote(entry.incomparableReasons)}</p>{/if}

          {#if isExpanded}
            <div class="timeline-detail" id={bodyId} role="region" aria-labelledby={snapId}>
              {#each snapshotFieldGroups(entry.snapshot) as group}
                <section class="timeline-group">
                  <h4>{group.name}</h4>
                  <dl>{#each group.rows as row}<dt>{row.label}</dt><dd>{formatSnapshotValue(row.field,row.value)}</dd>{/each}</dl>
                </section>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ol>
    {#if changedOnly && visibleTimeline.length===1 && timeline.length>1}
      <p class="timeline-filter-note">{filteredIncomparable?'No reliable comparable changes matched. Some observations differ materially, but their scan depth or risk model prevents field-level comparison.':'No reliable comparable changes matched.'}</p>
    {/if}
  {/if}
</section>

<style>
  .evidence{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;margin:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:var(--text-xs)}.evidence dt{color:var(--muted)}.evidence dd{margin:0;overflow-wrap:anywhere}
  .timeline{margin-top:4px}.timeline-header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px}.timeline-header h3{margin:0;font:700 var(--text-sm) var(--mono)}.timeline-header small{margin-left:8px;color:var(--muted);font-size:var(--text-2xs);font-weight:400}.timeline-controls{display:flex;flex-wrap:wrap;gap:7px}.timeline-controls button,.timeline-toggle{min-height:32px;padding:0 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font:600 var(--text-2xs) var(--mono)}.timeline-controls button[aria-pressed="true"]{color:var(--accent2);border-color:rgb(var(--accent2-rgb) / .55);background:rgb(var(--accent2-rgb) / .07)}.timeline-empty,.timeline-filter-note,.timeline-incomparable-note{color:var(--muted);font-size:var(--text-xs)}.timeline-empty{padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .timeline-list,.timeline-changes{display:grid;gap:10px;margin:0;padding:0;list-style:none}.timeline-entry{padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}.timeline-entry-head,.timeline-badges{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.timeline-toggle{display:flex;gap:6px;align-items:center;background:var(--panel);cursor:pointer}.timeline-toggle:focus-visible{outline:2px solid var(--accent);outline-offset:1px}.timeline-toggle time{font-size:var(--text-xs)}.timeline-index{color:var(--muted);font-size:var(--text-2xs);font-weight:700}.timeline-badge{padding:3px 8px;border:1px solid var(--border);border-radius:99px;font:600 var(--text-2xs) var(--mono)}.timeline-baseline{color:var(--accent2)}.timeline-changed{color:var(--danger)}.timeline-incomparable{color:var(--amber)}.timeline-repeat{color:var(--muted)}
  .timeline-changes{gap:5px;margin-top:10px}.timeline-change{display:grid;grid-template-columns:minmax(100px,1fr) 80px minmax(0,1fr);gap:8px;padding:7px 9px;border-left:3px solid var(--border);font-size:var(--text-xs)}.timeline-change.tone-danger{border-color:var(--danger)}.timeline-change.tone-warn{border-color:var(--amber)}.timeline-change.tone-good{border-color:var(--accent2)}.change-kind{color:var(--muted);font-size:var(--text-2xs);text-transform:capitalize}.change-values{display:flex;flex-wrap:wrap;gap:4px;min-width:0}.change-values span{overflow-wrap:anywhere;word-break:break-word}.change-arrow{color:var(--muted)}
  .timeline-detail{margin-top:10px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.timeline-group:not(:last-child){margin-bottom:10px}.timeline-group h4{margin:0 0 6px;color:var(--muted);font:600 var(--text-2xs) var(--mono);letter-spacing:.05em;text-transform:uppercase}.timeline-group dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:0;font-size:var(--text-xs)}.timeline-group dt{color:var(--muted)}.timeline-group dd{margin:0;overflow-wrap:anywhere;word-break:break-word}.timeline-filter-note{margin-top:10px}
  @media(max-width:800px){.timeline-change,.timeline-group dl{grid-template-columns:1fr}.timeline-entry-head{align-items:flex-start;flex-direction:column}.timeline-toggle{width:100%;justify-content:flex-start}.change-values{display:grid;grid-template-columns:1fr}}
</style>
