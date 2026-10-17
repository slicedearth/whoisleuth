<script lang="ts">
  import CopyButton from './CopyButton.svelte';
  import { GENERATED_CONFUSABLE_SOURCE as CONFUSABLE_MAPPING_SOURCE } from '../../../../lib/generated/unicode-confusables.mts';
  import type { analyzeDomainIdn } from '#lib/analysis/idn-confusables.ts';

  let { analysis }: { analysis: NonNullable<ReturnType<typeof analyzeDomainIdn>> } = $props();
  const id = $props.id();
</script>

<section class="idn-card card" aria-labelledby={`${id}-title`}>
  <header>
    <div><p class="eyebrow">Domain identity</p><h4 id={`${id}-title`}>IDN and confusable review</h4></div>
    <code class="mapping-version">{analysis.mappingVersion}</code>
  </header>
  <p class="scope">Normalised representations of the registration domain. Copying a value does not change the lookup target.</p>
  <dl class="representations">
    <div>
      <dt>Unicode display</dt>
      <dd><code dir="ltr">{analysis.unicodeDomain}</code><CopyButton value={analysis.unicodeDomain} label="Copy Unicode" description="Copy exact Unicode display" /></dd>
    </div>
    <div>
      <dt>DNS-safe ASCII</dt>
      <dd><code dir="ltr">{analysis.asciiDomain}</code><CopyButton value={analysis.asciiDomain} label="Copy ASCII" description="Copy exact DNS-safe ASCII" /></dd>
    </div>
    <div>
      <dt>Visual skeleton</dt>
      <dd>{#if analysis.skeleton}<code dir="ltr">{analysis.skeleton}</code><CopyButton value={analysis.skeleton} label="Copy skeleton" description="Copy exact visual skeleton" />{:else}<span>Unavailable</span>{/if}</dd>
    </div>
    <div><dt>Writing scripts</dt><dd>{analysis.scripts.join(', ') || 'None detected'}</dd></div>
  </dl>
  <p class="card-note">A visual skeleton is a similarity key, not a DNS name or canonical domain identity.</p>
  {#if analysis.findings.length}
    <ul class="finding-list">
      {#each analysis.findings as finding}
        <li class="callout {finding.tone === 'warning' ? 'warn' : 'info'}"><strong>{finding.label}</strong><span>{finding.detail}</span></li>
      {/each}
    </ul>
  {/if}
  <p class="card-note">Review Unicode and ASCII forms together. These are bounded similarity indicators and do not establish maliciousness.</p>
  <details>
    <summary>Mapping source and interpretation</summary>
    <p>Computed locally using the retained {CONFUSABLE_MAPPING_SOURCE.standard} projection, Unicode {CONFUSABLE_MAPPING_SOURCE.unicodeVersion}. The full upstream mapping is not included.</p>
    <p><a href={CONFUSABLE_MAPPING_SOURCE.url} target="_blank" rel="noreferrer">Published mapping source (opens a new tab)</a> · {CONFUSABLE_MAPPING_SOURCE.license}</p>
    <p class="source-digest">Source-file SHA-256 <code>{CONFUSABLE_MAPPING_SOURCE.sha256}</code></p>
    <ul>{#each analysis.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    {#if analysis.truncated}<p>Only the bounded reference-domain selection was compared; additional references were not checked.</p>{/if}
  </details>
</section>

<style>
  .idn-card{min-width:0;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px 20px}
  h4{margin:4px 0 0}
  .mapping-version{color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .scope,.card-note,details{font-size:var(--text-sm);line-height:1.55;color:var(--muted)}
  .scope{margin:12px 0 0}
  .representations{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 24px;margin:18px 0 12px}
  .representations>div{min-width:0}
  dt{font-size:var(--text-xs);color:var(--muted);font-weight:600}
  dd{display:flex;align-items:flex-start;flex-direction:column;gap:8px;margin:5px 0 0;line-height:1.5;min-width:0}
  dd>code{max-width:100%;overflow-wrap:anywhere;unicode-bidi:isolate;font-size:var(--text-sm);user-select:all}
  .card-note{margin:12px 0}
  .finding-list{display:grid;gap:7px;margin:12px 0;padding:0;list-style:none}
  .finding-list .callout{margin:0}
  .finding-list strong{display:block;color:var(--text);font-size:var(--text-xs)}
  .finding-list span{display:block;margin-top:3px;overflow-wrap:anywhere}
  details{border-top:1px solid var(--border);padding-top:10px}
  summary{min-height:44px;align-content:center;color:var(--text);cursor:pointer}
  details p{margin:10px 0;overflow-wrap:anywhere}
  details a{display:inline-block;padding:8px 0}
  .source-digest code{display:block;overflow-wrap:anywhere;user-select:all}
  details li+li{margin-top:6px}
  @media(max-width:620px){.representations{grid-template-columns:1fr}}
</style>
