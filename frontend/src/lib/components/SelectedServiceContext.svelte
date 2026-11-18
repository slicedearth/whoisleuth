<script lang="ts">
  import { onDestroy } from 'svelte';
  import { MAX_SELECTED_SERVICE_LIST_BYTES, MAX_SELECTED_SERVICE_TARGETS, SELECTED_SERVICE_CONTEXT_INPUT_SCHEMA,
    SELECTED_SERVICE_CONTEXT_VERSION, SERVICE_CONTEXT_ROLES, selectedServiceContextTarget } from '../../../../packages/contracts/selected-service-context.mts';
  import type { reviewSelectedServiceContext } from '../../../../packages/relationships/selected-service-context.mts';
  let { targets }: { targets: readonly string[] } = $props();
  let file = $state<File | null>(null), role = $state('shared_service');
  let sourceUrl = $state(''), revision = $state(''), licence = $state('');
  let busy = $state(false), error = $state('');
  let report = $state.raw<ReturnType<typeof reviewSelectedServiceContext> | null>(null);
  let generation = 0;
  const admittedTargets = $derived([...new Set(targets.map(selectedServiceContextTarget).filter((target): target is string => target !== null))]);
  const ineligibleTargets = $derived(targets.filter(target => selectedServiceContextTarget(target) === null).length);
  const scope = $derived(admittedTargets.join('\n'));
  $effect(() => { scope; generation++; report = null; error = ''; });
  onDestroy(() => { generation++; });

  async function review(event: SubmitEvent) {
    event.preventDefault();
    if (!file || busy) return;
    const selected = file, current = ++generation, selectedTargets = [...admittedTargets];
    if (selected.size < 1 || selected.size > MAX_SELECTED_SERVICE_LIST_BYTES || selectedTargets.length > MAX_SELECTED_SERVICE_TARGETS) {
      error = 'Choose warning data up to 6 MiB and at most 2,000 selected identifiers.'; return;
    }
    busy = true; error = ''; report = null;
    const provenance = { ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}), ...(revision.trim() ? { revision: revision.trim() } : {}), ...(licence.trim() ? { licence: licence.trim() } : {}) };
    const selectedRole = role;
    try {
      const { reviewSelectedServiceContext } = await import('../../../../packages/relationships/selected-service-context.mts');
      const warningListJson = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer());
      const result = reviewSelectedServiceContext({ schema: SELECTED_SERVICE_CONTEXT_INPUT_SCHEMA, version: SELECTED_SERVICE_CONTEXT_VERSION,
        targets: selectedTargets, role: selectedRole, warningListJson, provenance });
      if (current === generation) report = result;
    } catch { if (current === generation) error = 'The selected file, provenance or review size is unsupported. Use a bounded hostname/CIDR warning list with valid entries.'; }
    finally { busy = false; }
  }
</script>

{#if admittedTargets.length}
<details class="service-context">
  <summary>Review selected shared-service or scanner context</summary>
  <p>Compare identifiers already in this view with a local hostname or CIDR warning list. Nothing is uploaded, saved, suppressed or rescored.</p>
  <p>{admittedTargets.length} concrete hostname/IP identifiers selected.{#if ineligibleTargets} {ineligibleTargets} other labels or hostname patterns are not eligible.{/if}</p>
  <form onsubmit={review} oninput={() => { report = null; error = ''; }}>
    <label>Warning-list JSON<input type="file" accept=".json,application/json" disabled={busy} onchange={event => { file = event.currentTarget.files?.[0] ?? null; report = null; error = ''; }} /></label>
    <label>Selected context<select bind:value={role} disabled={busy}>{#each SERVICE_CONTEXT_ROLES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
    <details class="provenance"><summary>Add source provenance</summary>
      <label>Source URL<input type="url" bind:value={sourceUrl} maxlength="2048" disabled={busy} placeholder="https://example.org/list.json" /></label>
      <label>Source revision<input bind:value={revision} maxlength="128" disabled={busy} /></label>
      <label>Source licence<input bind:value={licence} maxlength="200" disabled={busy} /></label>
    </details>
    <button class="btn small" type="submit" disabled={!file || busy}>{busy ? 'Reviewing…' : 'Review selected list'}</button>
  </form>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if report}
    <section aria-label="Selected service context results">
      <p role="status"><strong>{report.source.name}</strong> · {report.source.sourceHealth} · {report.source.entryCount.toLocaleString('en-AU')} {report.source.entryCount === 1 ? 'entry' : 'entries'} · {report.counts.matchedTargets} of {report.counts.targets} identifiers matched</p>
      <p>{report.source.publishedAt ? `Publisher date: ${report.source.publishedAt}.` : 'Publisher date is unknown.'} Reviewed {report.reviewedAt.slice(0, 10)}. {report.source.sourceHealth !== 'current' ? 'Matches are historical context, not current qualification.' : ''}</p>
      <code>SHA-256 {report.source.digestSha256}</code>
      <ul>{#each report.results.filter(row => row.matches.length).slice(0, 50) as row}
        <li><strong>{row.target}</strong><span>{row.matches.map(match => `${match.entry} (${match.basis.replaceAll('_', ' ')})`).join(' · ')}{row.truncated ? ' · additional matches omitted' : ''}</span></li>
      {/each}</ul>
      {#if report.counts.matchedTargets > 50}<p>Showing the first 50 matched identifiers. Use the CLI for the complete bounded report.</p>{/if}
      <details><summary>Source and interpretation</summary>
        <p>Revision: {report.source.revision ?? 'Not supplied'} · Licence: {report.source.licence ?? 'Not supplied'}</p>
        {#if report.source.sourceUrl}<code>{report.source.sourceUrl}</code>{/if}
        {#each report.limitations as limitation}<p>{limitation}</p>{/each}
      </details>
    </section>
  {/if}
</details>
{/if}

<style>
  .service-context{min-width:0;margin-block:14px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:var(--text-xs);line-height:1.55}
  summary{cursor:pointer}p{margin-block:10px;color:var(--muted);overflow-wrap:anywhere}form,label,.provenance[open]{display:grid;gap:6px}form{max-width:42rem;gap:12px;margin-block:12px}input,select{width:100%;max-width:100%;min-width:0;min-height:44px}form>button{justify-self:start;white-space:normal}code,li{overflow-wrap:anywhere}code{display:block;white-space:normal}ul{padding-left:20px}li{margin-block:10px}li span{display:block;color:var(--muted)}.provenance label{margin-block:10px}
</style>
