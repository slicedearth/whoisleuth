<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { compareCaseAssertions, type ComparedEvidenceRelationship } from '../../../../packages/cases/case-assessment-comparison.mts';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';

  let { record }: { record: CaseRecord } = $props();
  let selection = $state<{ caseId: string; left: string; right: string } | null>(null);
  const chosen = $derived(selection?.caseId === record.id ? selection : null);
  const left = $derived(record.assertions.find(assertion => assertion.id === chosen?.left) ?? record.assertions[0]);
  const right = $derived(record.assertions.find(assertion => assertion.id === chosen?.right && assertion.id !== left?.id) ?? record.assertions.find(assertion => assertion.id !== left?.id));
  const comparison = $derived(left && right ? compareCaseAssertions(record.evidencePins, left, right) : null);
  const labels: Record<ComparedEvidenceRelationship, string> = {
    supports: 'Supports', contradicts: 'Contradicts', unresolved: 'Unresolved',
    not_linked: 'Not linked', unspecified: 'Linked; relationship not recorded',
  };
  function select(side: 'left' | 'right', id: string) {
    selection = { caseId: record.id, left: left?.id ?? '', right: right?.id ?? '', [side]: id };
  }
</script>

{#if record.assertions.length > 1}
  <details class="assessment-comparison">
    <summary>Compare explanations</summary>
    <div class="explanations">
      {#each [{ side: 'left' as const, name: 'First explanation', assertion: left }, { side: 'right' as const, name: 'Second explanation', assertion: right }] as column}
        <section aria-label={column.name}>
          <label class="field">{column.name}
            <select value={column.assertion?.id} onchange={(event) => select(column.side, event.currentTarget.value)}>
              {#each record.assertions as assertion, index}
                <option value={assertion.id} disabled={assertion.id === (column.side === 'left' ? right?.id : left?.id)}>{index + 1}. {assertion.statement}</option>
              {/each}
            </select>
          </label>
          {#if column.assertion}
            <h3>{column.assertion.statement}</h3>
            <small>{column.assertion.kind.replaceAll('_', ' ')} · {column.assertion.state}{column.assertion.provenance ? ' · external import' : ''}</small>
            {#if column.assertion.rationale}<p>{column.assertion.rationale}</p>{/if}
          {/if}
        </section>
      {/each}
    </div>
    {#if comparison}
      {#if comparison.rows.length}
        <p class="notice">Relationships are recorded by the analyst. Unlinked evidence is not a contradiction, and multiple pins do not establish independent sources.</p>
        <ol class="compared-evidence" aria-label="Evidence across explanations">
          {#each comparison.rows as row, index (row.id)}
            <li>
              <div><h4>Observation {index + 1}</h4>{#if row.pin}<CaseEvidenceFact pin={row.pin} />{:else}<p>Linked evidence is not retained in this Case.</p>{/if}</div>
              <dl class="stances">
                <div><dt>First explanation</dt><dd>{labels[row.left]}</dd></div>
                <div><dt>Second explanation</dt><dd>{labels[row.right]}</dd></div>
              </dl>
            </li>
          {/each}
        </ol>
      {:else}<p>No evidence is linked to either explanation.</p>{/if}
      {#if comparison.sharedContext.length}
        <details class="source-context"><summary>Shared source context</summary>
          <ul>{#each comparison.sharedContext as group}<li>{group.label} — observations {group.pinIds.map(id => comparison!.rows.findIndex(row => row.id === id) + 1).join(', ')}</li>{/each}</ul>
          <p class="notice">Matching labels or import content do not authenticate the source. Check the original provenance before treating observations as independent corroboration.</p>
        </details>
      {/if}
    {/if}
  </details>
{/if}

<style>
  .assessment-comparison { min-width: 0; }
  .explanations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; padding-block: 16px; align-items: start; }
  section, .field, select { min-width: 0; max-width: 100%; }
  h3 { font-family: var(--font-sans); font-size: var(--text-md); text-transform: none; letter-spacing: normal; overflow-wrap: anywhere; margin: 12px 0 6px; }
  h4 { margin: 0 0 8px; }
  p, li { overflow-wrap: anywhere; }
  .compared-evidence { list-style: none; padding: 0; margin: 12px 0; }
  .compared-evidence > li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; border-top: 1px solid var(--border); padding-block: 16px; }
  .stances { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 0; }
  dt { color: var(--muted); font-size: var(--text-xs); }
  dd { margin: 4px 0 0; font-size: var(--text-sm); }
  .source-context { margin-block: 16px; }
  @media(max-width: 700px) { .explanations, .compared-evidence > li { grid-template-columns: minmax(0, 1fr); gap: 16px; } }
</style>
