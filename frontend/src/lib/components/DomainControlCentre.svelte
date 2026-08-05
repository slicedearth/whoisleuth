<script lang="ts">
  import type { BrandProfile } from '$lib/brand-profiles';
  import { buildDomainControlCentre } from '$lib/analysis/domain-control-centre.ts';

  let { active }: { active: BrandProfile } = $props();
  const centre = $derived(buildDomainControlCentre(active));

  function date(value: string | null): string {
    if (!value) return 'Not retained';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Invalid date' : parsed.toLocaleString();
  }
</script>

<section class="control-centre card" aria-labelledby="domain-control-centre-title">
  <header class="section-head">
    <div>
      <p class="eyebrow">Domain control</p>
      <h2 id="domain-control-centre-title">Portfolio control centre</h2>
      <p>Review intent, baseline coverage, planned changes and shared dependencies across official domains. All records remain browser-local and analyst-authored.</p>
    </div>
  </header>

  <div class="metrics" aria-label="Portfolio control summary">
    <article><strong>{centre.counts.baselines}/{centre.counts.domains}</strong><span>baselines configured</span></article>
    <article><strong>{centre.counts.retainedObservations}</strong><span>domains observed</span></article>
    <article><strong>{centre.counts.plannedOrActiveChanges}</strong><span>planned changes</span></article>
    <article><strong>{centre.counts.retiringOrRetired}</strong><span>retiring or retired</span></article>
  </div>

  <div class="domain-grid">
    {#each centre.rows as row}
      <article class="domain-card">
        <header><strong>{row.domain}</strong><span>{row.baseline?.lifecycle.replaceAll('_', ' ') || 'no baseline'}</span></header>
        <dl>
          <div><dt>Zone intent</dt><dd>{row.baseline?.zoneIntent.replaceAll('_', ' ') || 'Not configured'}</dd></div>
          <div><dt>Nameserver preflight</dt><dd class={`state-${row.nameserverPreflight}`}>{row.nameserverPreflight.replaceAll('_', ' ')}</dd></div>
          <div><dt>Baseline depth</dt><dd>{row.baselineFields}/11 fields</dd></div>
          <div><dt>Latest observation</dt><dd>{date(row.latestObservationAt)}</dd></div>
          <div><dt>Recovery dependency</dt><dd>{row.baseline?.recoveryDependency || 'Not recorded'}</dd></div>
        </dl>
        {#if row.activeWindow}
          <p class="change active-change"><strong>Change window active</strong><span>{row.activeWindow.summary}</span><small>Until {date(row.activeWindow.endsAt)}</small></p>
        {:else if row.nextWindow}
          <p class="change"><strong>Next approved change</strong><span>{row.nextWindow.summary}</span><small>{date(row.nextWindow.startsAt)}</small></p>
        {/if}
      </article>
    {/each}
  </div>

  <details class="concentration">
    <summary>Shared dependency concentration <strong>{centre.concentrations.length}</strong></summary>
    {#if centre.concentrations.length}
      <div class="concentration-list">
        {#each centre.concentrations as item}
          <article><span>{item.kind === 'nameserver_set' ? 'Nameserver set' : 'Recovery dependency'}</span><strong>{item.label}</strong><small>{item.domains.join(' · ')}</small></article>
        {/each}
      </div>
      <p class="limitation">Shared dependencies are concentration leads, not evidence that a provider or account is unsafe.</p>
    {:else}
      <p>No repeated configured nameserver sets or recovery dependencies were found.</p>
    {/if}
  </details>
</section>

<style>
  .control-centre{margin-top:16px;padding:var(--card-pad)}
  .control-centre h2{margin:0}
  .section-head p:not(.eyebrow),.limitation,.concentration>p{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0}
  .metrics article{display:grid;gap:3px;padding:12px;border:1px solid var(--border);background:var(--panel-raised)}
  .metrics strong{font-size:var(--text-lg)}
  .metrics span,dt{color:var(--muted);font-size:var(--text-2xs);letter-spacing:.04em;text-transform:uppercase}
  .domain-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .domain-card{min-width:0;padding:14px;border:1px solid var(--border);background:var(--panel-raised)}
  .domain-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .domain-card>header strong,.domain-card dd,.concentration-list strong,.concentration-list small{overflow-wrap:anywhere}
  .domain-card>header span{color:var(--muted);font-size:var(--text-2xs);text-transform:uppercase}
  dl{display:grid;gap:8px;margin:14px 0 0}
  dl>div{display:grid;grid-template-columns:minmax(110px,.8fr) minmax(0,1.2fr);gap:10px}
  dd{margin:0;font-size:var(--text-sm);text-align:right}
  .state-aligned{color:var(--success)}.state-drift{color:var(--danger)}.state-incomplete{color:var(--amber)}
  .change{display:grid;gap:4px;margin:12px 0 0;padding:10px;border-left:2px solid var(--accent);background:rgb(var(--accent-rgb) / .08)}
  .change span,.change small{font-size:var(--text-xs)}.change small{color:var(--muted)}
  .active-change{border-left-color:var(--amber)}
  .concentration{margin-top:14px}
  .concentration summary{cursor:pointer}
  .concentration summary strong{margin-left:6px}
  .concentration-list{display:grid;gap:8px;margin-top:12px}
  .concentration-list article{display:grid;grid-template-columns:minmax(120px,.5fr) minmax(0,1fr);gap:4px 12px;padding:10px;border:1px solid var(--border)}
  .concentration-list span{grid-row:1 / span 2;color:var(--muted);font-size:var(--text-2xs);text-transform:uppercase}
  .concentration-list small{color:var(--muted)}
  @media(max-width:900px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:750px){.domain-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.concentration-list article{grid-template-columns:1fr}.concentration-list span{grid-row:auto}}
</style>
