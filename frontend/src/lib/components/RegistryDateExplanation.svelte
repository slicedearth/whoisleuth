<script lang="ts">
  import { explainRegistryDate, REGISTRY_DATE_FIELDS, type RegistryDateField, type RegistryDateState } from '#lib/analysis/registry-date-explanation.ts';
  import CopyButton from './CopyButton.svelte';
  let { registry, whois, registrar }: {
    registry: { parsed: unknown; state: RegistryDateState };
    whois: { parsed: unknown; state: RegistryDateState };
    registrar: { parsed: unknown; state: RegistryDateState };
  } = $props();
  let selected = $state<RegistryDateField>('createdDate');
  const sources = $derived([
    { label: 'Registry RDAP', ...explainRegistryDate(registry.parsed, selected, 'rdap', registry.state) },
    { label: 'WHOIS', ...explainRegistryDate(whois.parsed, selected, 'whois', whois.state) },
    { label: 'Registrar RDAP', ...explainRegistryDate(registrar.parsed, selected, 'rdap', registrar.state) },
  ]);
  const unavailable = (state: string) => state === 'oversized' ? 'Value exceeds the supported display bound; it has not been shortened.'
    : state === 'invalid' ? 'The supplied value is not a supported text scalar.' : 'Not supplied in this record.';
</script>

<details class="date-explanation card">
  <summary>Explain a lifecycle date</summary>
  <div class="explanation-body">
    <label>Lifecycle date<select bind:value={selected}>{#each REGISTRY_DATE_FIELDS as field}<option value={field.key}>{field.label}</option>{/each}</select></label>
    <p>Compare the parser-selected text with the ISO value supplied by each publication. Copy preserves the exact retained value.</p>
    <div class="date-sources">{#each sources as source (source.label)}
      <section aria-label={`${source.label} date explanation`}>
        <h4>{source.label}</h4><p class="source-state">Publication: {source.state.replaceAll('_', ' ')}</p>
        {#if source.aliasesDiffer}<p class="callout warn">The lifecycle and compatibility fields differ. Both supplied pairs are shown.</p>{/if}
        {#each source.variants as variant (variant.path)}
          <dl>
            <dt>Parsed field</dt><dd><code>{variant.path}</code></dd>
            <dt>Parser-selected source text</dt><dd>{#if variant.source.value !== null}<code dir="ltr">{variant.source.value}</code><CopyButton value={variant.source.value} description={`Copy ${source.label} ${variant.path} source text`} />{:else}{unavailable(variant.source.state)}{/if}</dd>
            <dt>Supplied ISO companion</dt><dd>{#if variant.companion.value !== null}<code dir="ltr">{variant.companion.value}</code><CopyButton value={variant.companion.value} description={`Copy ${source.label} ${variant.path} ISO companion`} />{:else}{unavailable(variant.companion.state)}{/if}</dd>
            <dt>Current conversion check</dt><dd>{variant.check}{#if variant.calculated !== null}<code dir="ltr">{variant.calculated}</code>{/if}</dd>
          </dl>
        {/each}
        <details class="method"><summary>Selection and provenance</summary><p>{source.rule}</p><p>{source.provenance}</p>{#each source.limitations as limitation}<p>{limitation}</p>{/each}</details>
      </section>
    {/each}</div>
    <p class="method-note">The shared date parser converts explicit offsets to UTC and uses UTC for supported dates without a time zone. A date-only value becomes midnight for comparison; that does not establish an event time. A matching conversion does not authenticate the publication.</p>
  </div>
</details>

<style>
  .date-explanation{padding:0;min-width:0}summary{min-height:44px;padding:12px 16px;align-content:center;cursor:pointer}.explanation-body{padding:0 16px 16px;min-width:0}label{display:grid;gap:6px;max-width:20rem;font-size:var(--text-sm)}select{min-height:44px;max-width:100%}
  .date-sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:16px;align-items:start}section{min-width:0;border-top:1px solid var(--border);padding-top:12px}h4{font:700 var(--text-sm) var(--font-sans);margin:0}p,dl{font-size:var(--text-xs);line-height:1.6}p,.source-state{color:var(--muted)}dl{display:grid;gap:6px;margin:12px 0}dt{font-weight:650}dd{margin:0 0 8px;min-width:0;display:grid;gap:6px;justify-items:start}code{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:isolate;font-size:var(--text-xs)}.method summary{padding:8px 0}.method-note{margin-top:16px}.callout{overflow-wrap:anywhere}
</style>
