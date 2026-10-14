<script lang="ts">
  import { explainImportedFindingFields, type ImportedFieldExplanation } from '#lib/analysis/import-field-explanation.ts';
  import type { ExternalFinding, ExternalFindingsDocument, externalFindingCaseProjection } from '#lib/analysis/external-findings-import.ts';
  import type { SelectedFindingOriginal } from '#lib/analysis/selected-finding-original.ts';
  import CopyButton from './CopyButton.svelte';

  let { finding, document, selectedOriginal = null, source, projection, number }: {
    finding: ExternalFinding;
    document: ExternalFindingsDocument;
    selectedOriginal?: SelectedFindingOriginal | null;
    source: ExternalFindingsDocument['source'];
    projection: ReturnType<typeof externalFindingCaseProjection>;
    number: number;
  } = $props();
  let open = $state(false);
  let selected = $state<ImportedFieldExplanation['id']>('hostname');
  let originalPath = $state('');
  $effect(() => { selected; finding; selectedOriginal; open; originalPath = ''; });
  const fields = $derived(open ? explainImportedFindingFields(finding, source, projection) : []);
  const field = $derived(fields.find(item => item.id === selected));
</script>

<details bind:open>
  <summary>Explain a field for finding {number}</summary>
  {#if open}
    <div class="explanation">
      <label>Field for finding {number}<select bind:value={selected}>{#each fields as item}<option value={item.id}>{item.label}</option>{/each}</select></label>
      <p>Accepted values and the proposed Case fields are separate from the selected file. Original locations are available for supported fields in a directly selected findings JSON document; converted fields without a location stay unavailable.</p>
      {#if field}
        <dl>
          {#each field.accepted as accepted (accepted.path)}
            <dt>Accepted <code>{accepted.path}</code></dt>
            <dd>{#if accepted.value !== null}<code dir="ltr">{accepted.value}</code><CopyButton value={accepted.value} description={`Copy finding ${number} accepted ${accepted.path}`} />{:else}Not supplied in the accepted record.{/if}
              {#key accepted.path}
                <details class="selected-original" open={originalPath === accepted.path} ontoggle={(event) => {
                  if (event.currentTarget.open) originalPath = accepted.path;
                  else if (originalPath === accepted.path) originalPath = '';
                }}><summary>Show in selected original: {accepted.path}</summary>
                  {#if originalPath === accepted.path}
                  {@const location = selectedOriginal?.locate(document, finding, accepted.path)}
                  {#if location?.state === 'available'}
                    <p>Original JSON string at <code>{location.path}</code> · line {location.line}, column {location.column}.</p>
                    <pre dir="ltr">{location.lexical}</pre><CopyButton value={location.lexical} description={`Copy finding ${number} original JSON token ${accepted.path}`} />
                    <p>Decoded source value</p><code dir="ltr">{location.value}</code><CopyButton value={location.value} description={`Copy finding ${number} original value ${accepted.path}`} />
                    <p>UTF-16 range [{location.offset}, {location.end}) in the decoded selected file; offsets are not byte positions. {location.byteOrderMark ? 'A leading UTF-8 byte-order mark is included in these positions.' : 'No leading byte-order mark.'}</p>
                    <p>Selected file · {location.byteLength} bytes · SHA-256 <code>{location.digestSha256}</code></p>
                    <p>This hash identifies the selected bytes, not their author or accuracy. The original view and hash are temporary and are not added to the Case, reports or exports. Copied values remain on the device clipboard until replaced.</p>
                  {:else}<p>{location?.reason ?? 'Original location unavailable for this conversion. Consult the selected file; no source text is reconstructed from accepted values.'}</p>{/if}
                  {/if}
                </details>
              {/key}
            </dd>
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
  details,.explanation{min-width:0}summary{min-height:44px;padding:6px 0;align-content:center;cursor:pointer;font-size:var(--text-xs)}.explanation{display:grid;gap:10px;padding-bottom:10px}label{display:grid;gap:6px;max-width:24rem;font-size:var(--text-xs)}select{min-height:44px;min-width:0;max-width:100%}p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.6;overflow-wrap:anywhere}dl{display:grid;gap:6px;margin:0;font-size:var(--text-xs)}dt{font-weight:650;overflow-wrap:anywhere}dd{display:grid;gap:4px;justify-items:start;min-width:0;margin:0 0 6px}code,pre{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:isolate;font-size:inherit}.selected-original{width:100%}.selected-original[open]{display:grid;gap:8px}.selected-original pre{margin:0;padding:10px;background:var(--surface)}
  @media print{.selected-original,.selected-original[open]{display:none}}
</style>
