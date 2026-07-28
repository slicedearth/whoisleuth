<script lang="ts">
  import {
    compareCheckpointPins,
    MAX_CHECKPOINT_FACTS,
    type CheckpointFact,
  } from '$lib/analysis/case-evidence-checkpoint.ts';
  import type { CaseEvidencePin } from '$lib/cases';

  let {
    facts,
    pins,
    onsave,
  }: {
    facts: readonly CheckpointFact[];
    pins: readonly CaseEvidencePin[];
    onsave: (selectedFields: string[]) => void | Promise<void>;
  } = $props();

  let selectedFields = $state<string[]>([]);
  const selectable = $derived(facts.filter((fact) => fact.value !== null));
  const checkpointPins = $derived.by(() => {
    const retained = pins.filter((pin) => pin.checkpointId && pin.field);
    const latest = [...retained].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
    return latest?.checkpointId
      ? retained.filter((pin) => pin.checkpointId === latest.checkpointId)
      : [];
  });
  const comparison = $derived(compareCheckpointPins(checkpointPins, facts));

  function toggle(field: string, checked: boolean) {
    selectedFields = checked
      ? [...new Set([...selectedFields, field])].slice(0, MAX_CHECKPOINT_FACTS)
      : selectedFields.filter((item) => item !== field);
  }

  async function save() {
    await onsave(selectedFields);
    selectedFields = [];
  }
</script>

<section class="checkpoint card" aria-labelledby="lookup-checkpoint-title">
  <header>
    <div>
      <p class="eyebrow">Field checkpoint</p>
      <h4 id="lookup-checkpoint-title">Retain selected normalized facts</h4>
      <p>Choose only the facts needed for later review. Raw registry payloads, contacts, scripts, and unselected fields are not stored by this action.</p>
    </div>
    <button class="btn" type="button" disabled={!selectedFields.length} onclick={() => void save()}>Save {selectedFields.length || ''} checkpoint fact{selectedFields.length === 1 ? '' : 's'}</button>
  </header>

  {#if selectable.length}
    <div class="fact-grid">
      {#each selectable as fact (fact.field)}
        <label>
          <input type="checkbox" checked={selectedFields.includes(fact.field)} onchange={(event) => toggle(fact.field, event.currentTarget.checked)}>
          <span>
            <strong>{fact.label}</strong>
            <small>{fact.value}</small>
            <small>{fact.source} · {fact.sourceState} · {fact.completeness}{fact.truncated ? ' · truncated' : ''}</small>
          </span>
        </label>
      {/each}
    </div>
  {:else}
    <p class="empty">No normalized fact is currently available to checkpoint. This does not mean the evidence is absent elsewhere.</p>
  {/if}

  {#if comparison.length}
    <details>
      <summary>Compare with latest saved checkpoint <span>{comparison.length} facts</span></summary>
      <div class="comparison">
        {#each comparison as item (item.field)}
          <article data-state={item.state}>
            <div><strong>{item.label}</strong><span>{item.state.replaceAll('_', ' ')}</span></div>
            <dl>
              <div><dt>Checkpoint</dt><dd>{item.before}</dd></div>
              <div><dt>Current</dt><dd>{item.after ?? 'Not recorded in this observation'}</dd></div>
            </dl>
            <small>{item.source} · {item.observedAt}</small>
          </article>
        {/each}
      </div>
      <p class="limit">A failed or incomplete later lookup never replaces the saved checkpoint. Missing, unavailable, conflicting, and not-recorded states remain distinct from a material change.</p>
    </details>
  {/if}
</section>

<style>
  .checkpoint{display:grid;gap:12px;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
  h4,header p{margin:0}h4{margin-top:3px;font:700 var(--text-base) var(--mono)}
  header p:not(.eyebrow){max-width:760px;margin-top:6px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .fact-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
  .fact-grid label{display:flex;gap:9px;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);cursor:pointer}
  .fact-grid input{flex:0 0 auto;margin-top:2px}
  .fact-grid span,.fact-grid strong,.fact-grid small{display:block;min-width:0}
  .fact-grid strong{font-size:var(--text-xs)}.fact-grid small{margin-top:3px;color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  details{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  summary{display:flex;justify-content:space-between;gap:8px;padding:10px;cursor:pointer;font:700 var(--text-xs) var(--mono)}
  summary span{color:var(--muted)}
  .comparison{display:grid;gap:7px;padding:0 10px 10px}
  .comparison article{padding:9px;border-left:3px solid var(--border);background:var(--panel-raised)}
  .comparison article[data-state="equal"]{border-color:var(--accent)}
  .comparison article[data-state="changed"],.comparison article[data-state="conflicting"]{border-color:var(--amber)}
  .comparison article[data-state="unavailable"],.comparison article[data-state="missing"]{border-color:var(--danger)}
  .comparison article>div{display:flex;justify-content:space-between;gap:8px}.comparison article>div span{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:7px 0}
  dl div{min-width:0}dt{color:var(--muted);font-size:var(--text-2xs)}dd{margin:2px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  article>small,.limit,.empty{color:var(--muted);font-size:var(--text-2xs)}
  .limit{margin:0;padding:0 10px 10px;line-height:1.45}.empty{margin:0}
  @media(max-width:760px){header{align-items:stretch;flex-direction:column}.fact-grid,dl{grid-template-columns:1fr}header .btn{width:100%}}
</style>
