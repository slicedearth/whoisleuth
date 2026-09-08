<script module lang="ts">
  import type { ExternalFindingsDocument } from '$lib/analysis/external-findings-import.ts';
  import type { ExternalIntelligencePreview } from '$lib/analysis/external-intelligence-import.ts';

  export type ExternalImportPreview =
    | Readonly<{ kind: 'findings'; document: ExternalFindingsDocument }>
    | Readonly<{ kind: 'intelligence'; document: ExternalIntelligencePreview }>;
</script>

<script lang="ts">
  import Pagination from './Pagination.svelte';
  import { externalFindingCaseProjection } from '$lib/analysis/external-findings-import.ts';
  import { externalIntelligenceAssertionContent } from '$lib/analysis/external-intelligence-import.ts';
  import type { ExternalFindingConversionReport } from '$lib/analysis/external-findings-converters.ts';
  import type { CaseRecord } from '$lib/analysis/case-model.ts';

  let { preview, conversionReport, cases, applying, onimport, oncancel }: {
    preview: ExternalImportPreview;
    conversionReport: ExternalFindingConversionReport | null;
    cases: readonly CaseRecord[];
    applying: boolean;
    onimport: (selected: ExternalImportPreview, targetCaseId: string) => void | Promise<void>;
    oncancel: () => void;
  } = $props();

  const PAGE_SIZE = 10;
  let page = $state(1);
  let diagnosticPage = $state(1);
  let excluded = $state<number[]>([]);
  let targetCaseId = $state('');
  const findings = $derived(preview.kind === 'findings' ? preview.document : null);
  const intelligence = $derived(preview.kind === 'intelligence' ? preview.document : null);
  const total = $derived(findings?.findings.length ?? intelligence?.items.length ?? 0);
  const selectedCount = $derived(total - excluded.length);
  const pageCount = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const offset = $derived((page - 1) * PAGE_SIZE);
  const noun = $derived(findings ? 'finding' : 'claim');
  const domains = $derived(new Set(findings?.findings.map((finding) => finding.domain)).size);
  const diagnostics = $derived(intelligence
    ? [...intelligence.conflicts, ...intelligence.exclusions].map((item) => ({ label: item.type, reference: item.externalId, reason: item.reason }))
    : (conversionReport?.exclusions ?? []).map((item) => ({ label: `Row ${item.row}`, reference: null, reason: item.reason })));
  const diagnosticPageCount = $derived(Math.max(1, Math.ceil(diagnostics.length / PAGE_SIZE)));

  function select(index: number, included: boolean) {
    if (applying) return;
    excluded = included ? excluded.filter((value) => value !== index) : [...new Set([...excluded, index])];
  }

  function importSelection() {
    if (applying || !selectedCount) return;
    const selected: ExternalImportPreview = preview.kind === 'findings'
      ? { kind: 'findings', document: { ...preview.document, findings: preview.document.findings.filter((_, index) => !excluded.includes(index)) } }
      : { kind: 'intelligence', document: { ...preview.document, items: preview.document.items.filter((_, index) => !excluded.includes(index)) } };
    void onimport(selected, targetCaseId);
  }

  function countLabel(count: number, singular: string) { return `${count} ${singular}${count === 1 ? '' : 's'}`; }
</script>

<section class="import-review" aria-label="Validated import review" aria-busy={applying}>
  <header>
    <div><p class="eyebrow">Validated {findings ? 'findings' : intelligence?.format.toUpperCase()} preview</p><h3>{findings?.source.name ?? intelligence?.sourceName}</h3></div>
    <span>{countLabel(total, noun)}{findings ? ` · ${countLabel(domains, 'domain')}` : ` · ${countLabel(intelligence?.exclusions.length ?? 0, 'exclusion')}`}</span>
  </header>
  {#if conversionReport}
    <p class="metrics" role="group" aria-label="Observation conversion summary">{conversionReport.accepted} accepted · {conversionReport.rejected} rejected · {conversionReport.duplicates} duplicate · truncation {conversionReport.truncated ? 'reached' : 'not reached'}</p>
  {:else if intelligence}
    <p class="metrics" role="group" aria-label="External intelligence normalisation summary">{total} accepted · {intelligence.duplicatesSkipped} duplicate · {intelligence.conflicts.length} conflict · {intelligence.exclusions.length} excluded</p>
    {#if intelligence.truncated}<p class="warning">Partial source preview: an object, exclusion or claim bound was reached.</p>{/if}
    {#if intelligence.limitations.length}<ul class="limitations">{#each intelligence.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
  {/if}
  <div class="selection">
    <p role="status" aria-live="polite">{selectedCount} of {total} {noun}{total === 1 ? '' : 's'} selected</p>
    <button type="button" class="btn small" disabled={applying || selectedCount === total} onclick={() => { excluded = []; }}>Select all {noun}s</button>
    <button type="button" class="btn small" disabled={applying || !selectedCount} onclick={() => { excluded = Array.from({ length: total }, (_, index) => index); }}>Clear selection</button>
  </div>
  <p class="note">Retained fields show the Case content after normalisation. Record IDs, import timestamps and evidence links are assigned when saved. Duplicate and capacity checks run against the latest stored Cases.</p>
  <ul class="records">
    {#if findings}
      {#each findings.findings.slice(offset, offset + PAGE_SIZE) as finding, localIndex (offset + localIndex)}
        {@const index = offset + localIndex}
        {@const projection = externalFindingCaseProjection(finding, findings.source)}
        <li>
          <label class="record-selection"><input type="checkbox" checked={!excluded.includes(index)} disabled={applying} onchange={(event) => select(index, event.currentTarget.checked)} aria-label={`Include finding ${index + 1}: ${finding.domain}`}><strong>{finding.domain}</strong></label>
          <p class="metadata">{finding.category} · {finding.evidenceClass.replaceAll('_', ' ')} · {finding.completeness}</p>
          <p>{finding.summary}</p>
          <p class="metadata">Observed <time datetime={finding.observedAt}>{finding.observedAt}</time></p>
          {#if projection.shortenedFields.length || projection.omittedLimitations}<p class="warning">{projection.shortenedFields.length ? `Shortened Case fields: ${projection.shortenedFields.join(', ')}. ` : ''}{projection.omittedLimitations ? `${projection.omittedLimitations} supplied limitations are omitted with a retained notice. ` : ''}Review the retained fields.</p>{/if}
          <details>
            <summary>Retained fields for finding {index + 1}</summary>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the named scroll region provides keyboard access to every retained field -->
            <div class="retained-fields" role="region" tabindex="0" aria-label={`Retained Case fields for finding ${index + 1}`}><pre>{JSON.stringify({ evidencePin: projection.evidencePin, sighting: projection.sighting }, null, 2)}</pre></div>
          </details>
          <details>
            <summary>Accepted source fields for finding {index + 1}</summary>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the named scroll region provides keyboard access to every accepted field -->
            <div class="retained-fields" role="region" tabindex="0" aria-label={`Accepted source fields for finding ${index + 1}`}><pre>{JSON.stringify({ source: findings.source, finding }, null, 2)}</pre></div>
          </details>
        </li>
      {/each}
    {:else if intelligence}
      {#each intelligence.items.slice(offset, offset + PAGE_SIZE) as item, localIndex (item.key)}
        {@const index = offset + localIndex}
        <li>
          <label class="record-selection"><input type="checkbox" checked={!excluded.includes(index)} disabled={applying} onchange={(event) => select(index, event.currentTarget.checked)} aria-label={`Include claim ${index + 1}: ${item.entityValue}`}><strong>{item.entityValue}</strong></label>
          <p class="metadata">{item.entityType} · {item.claimType}{item.confidence === null ? '' : ` · confidence ${item.confidence}`}</p>
          <p>{item.publisher ?? intelligence.publisher ?? 'Publisher not declared'}{item.markings.length ? ` · ${item.markings.join(', ')}` : ''}</p>
          <p class="metadata">{item.observedAt ? `Observed ${item.observedAt}` : 'Observation time not declared'}{item.createdAt ? ` · created ${item.createdAt}` : ''}{item.modifiedAt ? ` · modified ${item.modifiedAt}` : ''}</p>
          <details>
            <summary>Retained fields for claim {index + 1}</summary>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the named scroll region provides keyboard access to every retained field -->
            <div class="retained-fields" role="region" tabindex="0" aria-label={`Retained Case fields for claim ${index + 1}`}><pre>{JSON.stringify(externalIntelligenceAssertionContent(item, intelligence), null, 2)}</pre></div>
          </details>
        </li>
      {/each}
    {/if}
  </ul>
  <p class="note">Showing {total ? offset + 1 : 0}–{Math.min(offset + PAGE_SIZE, total)} of {total} accepted {noun}s. Selection applies across pages.</p>
  <Pagination currentPage={page} {pageCount} setPage={(next) => { page = next; }} ariaLabel="Import preview pages" />
  {#if diagnostics.length}
    <details class="diagnostics"><summary>{findings ? 'Review conversion exclusions' : 'Review conflicts and exclusions'} ({diagnostics.length})</summary>
      <ul class="diagnostic-list">{#each diagnostics.slice((diagnosticPage - 1) * PAGE_SIZE, diagnosticPage * PAGE_SIZE) as item}<li><strong>{item.label}</strong>{#if item.reference}<span>{item.reference}</span>{/if}<p>{item.reason}</p></li>{/each}</ul>
      <Pagination currentPage={diagnosticPage} pageCount={diagnosticPageCount} setPage={(next) => { diagnosticPage = next; }} ariaLabel="Import diagnostic pages" />
    </details>
  {/if}
  {#if intelligence}
    <label class="case-target">Merge into existing case<select bind:value={targetCaseId} disabled={applying || !total}><option value="">Select a case</option>{#each cases as record}<option value={record.id}>{record.domain}</option>{/each}</select></label>
    {#if !cases.length}<p class="warning">Open a Case before importing intelligence. Claims never create one automatically.</p>{/if}
  {/if}
  <div class="actions">
    <button class="primary" type="button" onclick={importSelection} disabled={applying || !selectedCount || (preview.kind === 'intelligence' && !targetCaseId)}>{applying ? (findings ? 'Importing…' : 'Merging…') : findings ? 'Import into cases' : 'Merge assertions into case'}</button>
    <button class="btn" type="button" onclick={oncancel} disabled={applying}>Cancel</button>
  </div>
</section>

<style>
  .import-review{display:grid;gap:12px;min-width:0}
  header{display:flex;flex-wrap:wrap;align-items:start;justify-content:space-between;gap:8px}
  h3{margin:0;font-size:var(--text-md);overflow-wrap:anywhere}
  header>span,.metadata,.metrics,.note{color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  p{margin:0;overflow-wrap:anywhere;line-height:1.55}
  .selection,.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
  .selection p{flex:1 1 180px;font-size:var(--text-xs)}
  .records,.diagnostic-list,.limitations{margin:0;padding:0;list-style:none}
  .records{display:grid;gap:16px}
  .records>li{display:grid;gap:7px;min-width:0;padding-top:14px;border-top:1px solid var(--border)}
  .record-selection{display:flex;align-items:start;gap:9px;min-width:0;cursor:pointer}
  .record-selection input{flex:0 0 auto;width:18px;height:18px;margin:2px 0}
  .record-selection strong{overflow-wrap:anywhere}
  summary{cursor:pointer;min-height:30px;padding:4px 0;font-size:var(--text-xs)}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .retained-fields{max-width:100%;max-height:28rem;margin:8px 0;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--code-bg,var(--panel));color:var(--text)}
  .retained-fields:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  pre{margin:0;padding:10px;white-space:pre-wrap;overflow-wrap:anywhere;font:var(--text-xs)/1.5 var(--mono)}
  .warning{color:var(--amber);font-size:var(--text-xs)}
  .limitations,.diagnostic-list{display:grid;gap:7px;color:var(--muted);font-size:var(--text-xs)}
  .diagnostic-list li{padding:8px 0;border-bottom:1px solid var(--border);overflow-wrap:anywhere}
  .diagnostic-list span{display:block}
  .case-target{display:grid;gap:5px;max-width:480px;min-width:0;font-size:var(--text-xs)}
  .case-target select{min-width:0;max-width:100%}
  @media(max-width:680px){.actions button{flex:1 1 140px}}
</style>
