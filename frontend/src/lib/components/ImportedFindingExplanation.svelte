<script lang="ts">
  import { explainImportedFindingFields, type ImportedFieldExplanation } from '#lib/analysis/import-field-explanation.ts';
  import type { ExternalFinding, ExternalFindingsDocument, externalFindingCaseProjection } from '#lib/analysis/external-findings-import.ts';
  import CopyButton from './CopyButton.svelte';

  let { finding, source, projection, number }: {
    finding: ExternalFinding;
    source: ExternalFindingsDocument['source'];
    projection: ReturnType<typeof externalFindingCaseProjection>;
    number: number;
  } = $props();
  let open = $state(false);
  let selected = $state<ImportedFieldExplanation['id']>('hostname');
  const fields = $derived(open ? explainImportedFindingFields(finding, source, projection) : []);
  const field = $derived(fields.find(item => item.id === selected));
</script>

<details bind:open>
  <summary>Explain a field for finding {number}</summary>
  {#if open}
    <div class="explanation">
      <label>Field for finding {number}<select bind:value={selected}>{#each fields as item}<option value={item.id}>{item.label}</option>{/each}</select></label>
      <p>These values are the accepted parser output. Original spelling, time-zone notation and input locations are not retained in this preview; consult the selected file for them.</p>
      {#if field}
        <dl>
          {#each field.accepted as accepted (accepted.path)}
            <dt>Accepted <code>{accepted.path}</code></dt>
            <dd>{#if accepted.value !== null}<code dir="ltr">{accepted.value}</code><CopyButton value={accepted.value} description={`Copy finding ${number} accepted ${accepted.path}`} />{:else}Not supplied in the accepted record.{/if}</dd>
          {/each}
          <dt>Proposed <code>{field.retained.path}</code></dt>
          <dd>{#if field.retained.value !== null}<code dir="ltr">{field.retained.value}</code><CopyButton value={field.retained.value} description={`Copy finding ${number} proposed ${field.retained.path}`} />{:else}Not present in the retained projection.{/if}</dd>
        </dl>
        <p>{field.transformation}</p>
        {#if projection.shortenedFields.length || projection.omittedLimitations}<p>Some Case fields or limitations are shortened or omitted. The retained-field and caveat disclosures show the exact proposed content.</p>{/if}
        <p>The import content digest covers the complete accepted finding, source name and source reference before the Case projection. It is not a hash of the original file and does not verify the source's claims.</p>
      {/if}
    </div>
  {/if}
</details>

<style>
  details,.explanation{min-width:0}summary{min-height:44px;padding:6px 0;align-content:center;cursor:pointer;font-size:var(--text-xs)}.explanation{display:grid;gap:10px;padding-bottom:10px}label{display:grid;gap:6px;max-width:24rem;font-size:var(--text-xs)}select{min-height:44px;min-width:0;max-width:100%}p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.6;overflow-wrap:anywhere}dl{display:grid;gap:6px;margin:0;font-size:var(--text-xs)}dt{font-weight:650;overflow-wrap:anywhere}dd{display:grid;gap:4px;justify-items:start;min-width:0;margin:0 0 6px}code{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:isolate;font-size:inherit}
</style>
