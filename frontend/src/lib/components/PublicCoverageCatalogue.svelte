<script lang="ts">
  import { PUBLIC_COVERAGE } from '$lib/generated/public-coverage';

  const scopes = Object.freeze([
    Object.freeze({ value: 'investigate', label: 'Investigate' }),
    Object.freeze({ value: 'respond', label: 'Respond' }),
    Object.freeze({ value: 'assure', label: 'Assure' }),
    Object.freeze({ value: 'platform', label: 'Platform support' }),
  ]);
  let scope = $state('all');
  let optionalOnly = $state(false);
  const filtered = $derived(PUBLIC_COVERAGE.capabilities.filter((capability) => (
    (scope === 'all' || capability.job === scope)
    && (!optionalOnly || capability.optionalOrConfigurationDependent)
  )));
  const labelToken = (value: string) => value.replaceAll('_', ' ');
  const scopeLabel = (value: string) => scopes.find((item) => item.value === value)?.label ?? labelToken(value);
</script>

<section class="coverage-catalogue" aria-labelledby="coverage-catalogue-title" data-testid="public-coverage-catalogue">
  <div class="heading"><div><p class="eyebrow">Capability details</p><h2 id="coverage-catalogue-title">Implemented capabilities</h2><p>Filter the current catalogue by scope and availability.</p></div><span>{filtered.length} shown</span></div>
  <form class="filters" onsubmit={(event) => event.preventDefault()} aria-label="Filter capability coverage"><label><span>Capability scope</span><select bind:value={scope}><option value="all">All capabilities</option>{#each scopes as item}<option value={item.value}>{item.label}</option>{/each}</select></label><label class="check"><input type="checkbox" bind:checked={optionalOnly}><span>Optional or configuration-dependent only</span></label></form>
  <p class="status" role="status" aria-live="polite">Showing {filtered.length} of {PUBLIC_COVERAGE.capabilities.length} implemented capability families.</p>
  {#if filtered.length}
    <div class="capability-grid">{#each filtered as capability}<article><header><code>{capability.id}</code><span>{scopeLabel(capability.job)}</span></header><h3>{capability.title}</h3><dl><div><dt>Review basis</dt><dd>{capability.reviewBasis}</dd></div><div><dt>Execution</dt><dd>{capability.executionPlanes.map(labelToken).join(', ')}</dd></div><div><dt>Modes</dt><dd>{capability.scanModes.map(labelToken).join(', ') || 'No scan mode'}</dd></div><div><dt>Network</dt><dd>{labelToken(capability.networkMode)}</dd></div><div><dt>Runtime</dt><dd>{labelToken(capability.runtimeAvailability)}</dd></div><div><dt>Partial results</dt><dd>{labelToken(capability.partialResultContract)} · {capability.outcomes.map(labelToken).join(', ')}</dd></div></dl><p>{capability.limitations.join(' ')}</p></article>{/each}</div>
  {:else}
    <p class="empty" role="status">No capabilities match the selected filters.</p>
  {/if}
</section>

<style>
  .heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.heading>div{max-width:760px}.heading h2{margin:.3rem 0 .55rem;font:700 clamp(1.4rem,3vw,2rem) var(--mono);letter-spacing:-.04em}.heading p:not(.eyebrow){margin:0;color:var(--muted);line-height:1.6}.heading>span{color:var(--interface-accent);font:700 var(--text-xs) var(--mono)}
  .filters{display:flex;flex-wrap:wrap;gap:18px;margin:20px 0 8px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.filters label{display:flex;align-items:center;gap:8px}.filters label>span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.filters select{padding:8px}.filters input{width:18px;height:18px}.status{color:var(--muted);font-size:var(--text-2xs)}
  .capability-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.capability-grid article{min-width:0;padding:17px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.capability-grid header{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}.capability-grid header code{color:var(--accent)}.capability-grid h3{margin:10px 0 12px;font:700 var(--text-sm) var(--mono)}.capability-grid dl{display:grid;gap:6px;margin:0}.capability-grid dl div{display:grid;grid-template-columns:105px minmax(0,1fr);gap:9px}.capability-grid dt{color:var(--interface-accent);font:650 var(--text-2xs) var(--mono)}.capability-grid dd{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}.capability-grid article>p{margin:13px 0 0;padding-top:11px;border-top:1px solid var(--border);color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .empty{margin:18px 0 0;padding:18px;border:1px dashed var(--border);border-radius:var(--radius-sm);color:var(--muted)}
  @media(max-width:760px){.heading{align-items:flex-start;flex-direction:column}.capability-grid{grid-template-columns:1fr}.filters{align-items:stretch;flex-direction:column}.filters label{justify-content:space-between}.filters select{min-width:0}.capability-grid dl div{grid-template-columns:90px minmax(0,1fr)}}
</style>
