<script lang="ts">
  import {
    EXTERNAL_FINDINGS_SCHEMA,
    importExternalFindings,
    importExternalIntelligence,
    MAX_EXTERNAL_FINDINGS_IMPORT_BYTES,
    MAX_EXTERNAL_INTELLIGENCE_IMPORT_BYTES,
    parseExternalFindingsDocument,
    parseExternalIntelligenceDocument,
    type CaseRecord,
    type ExternalFindingsDocument,
    type ExternalIntelligencePreview,
  } from '$lib/cases';
  import {
    EXTERNAL_FINDING_ROWS_SCHEMA,
    CERTIFICATE_OBSERVATION_ROWS_SCHEMA,
    DNS_OBSERVATION_ROWS_SCHEMA,
    DOMAIN_OBSERVATION_ROWS_SCHEMA,
    convertExternalFindingRows,
    convertExternalFindingsCsv,
    convertSupportedExternalFindings,
    type ExternalFindingConversionReport,
  } from '$lib/analysis/external-findings-converters.ts';
  import {
    WEB_CAPTURE_SUMMARY_SCHEMA,
    WEB_CAPTURE_MANIFEST_SCHEMA,
    parseWebCaptureManifest,
    parseWebCaptureSummary,
  } from '$lib/analysis/web-capture-import.ts';
  import {
    MAX_WARC_IMPORT_BYTES,
    parseWarcEvidenceArchive,
  } from '$lib/analysis/warc-evidence-import.ts';
  import {
    MAX_WACZ_IMPORT_BYTES,
    parseWaczEvidenceArchive,
  } from '$lib/analysis/wacz-evidence-import.ts';

  let {
    cases,
    oncomplete,
    onmessage,
  }: {
    cases: readonly CaseRecord[];
    oncomplete: () => void | Promise<void>;
    onmessage: (message: string) => void;
  } = $props();

  type Preview =
    | Readonly<{ kind: 'findings'; document: ExternalFindingsDocument }>
    | Readonly<{ kind: 'intelligence'; document: ExternalIntelligencePreview }>;

  let preview = $state<Preview | null>(null);
  let conversionReport = $state<ExternalFindingConversionReport | null>(null);
  let applying = $state(false);
  let targetCaseId = $state('');
  const findingsPreview = $derived(preview?.kind === 'findings' ? preview.document : null);
  const intelligencePreview = $derived(preview?.kind === 'intelligence' ? preview.document : null);
  const domains = $derived(findingsPreview ? [...new Set(findingsPreview.findings.map((finding) => finding.domain))] : []);

  function countLabel(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
  }

  async function sourceDigest(bytes: ArrayBuffer): Promise<string> {
    if (!globalThis.crypto?.subtle) throw new Error('Browser cryptography is unavailable for the required source-file digest.');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function selectFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    preview = null;
    conversionReport = null;
    targetCaseId = '';
    if (!file) return;
    try {
      const wacz = file.name.toLowerCase().endsWith('.wacz') || file.type === 'application/wacz';
      if (wacz) {
        if (file.size > MAX_WACZ_IMPORT_BYTES) {
          throw new Error('Portable WACZ imports are limited to 8 MiB.');
        }
        const report = await parseWaczEvidenceArchive(await file.arrayBuffer(), file.name);
        preview = { kind: 'findings', document: report.document };
        onmessage(`Validated ${report.accepted} portable WACZ finding${report.accepted === 1 ? '' : 's'} from ${report.warcResources} verified WARC resource${report.warcResources === 1 ? '' : 's'} and ${report.records} bounded record${report.records === 1 ? '' : 's'}; ${report.excluded} excluded. The package stayed local and only normalized page evidence is available for deliberate import.`);
        return;
      }
      const warc = file.name.toLowerCase().endsWith('.warc') || file.type === 'application/warc';
      if (warc) {
        if (file.size > MAX_WARC_IMPORT_BYTES) {
          throw new Error('Portable WARC imports are limited to 8 MiB.');
        }
        const report = await parseWarcEvidenceArchive(await file.arrayBuffer(), file.name);
        preview = { kind: 'findings', document: report.document };
        onmessage(`Validated ${report.accepted} portable WARC finding${report.accepted === 1 ? '' : 's'} from ${report.records} bounded record${report.records === 1 ? '' : 's'}; ${report.excluded} excluded. The archive stayed local and only normalized page evidence is available for deliberate import.`);
        return;
      }
      if (file.size > MAX_EXTERNAL_INTELLIGENCE_IMPORT_BYTES) {
        throw new Error('External intelligence imports are limited to 512 KiB.');
      }
      const bytes = await file.arrayBuffer();
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const csv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
      let value: unknown = null;
      if (!csv) {
        try {
          value = JSON.parse(decoded);
        } catch {
          throw new Error('The selected file is not valid UTF-8 JSON.');
        }
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).schema === EXTERNAL_FINDINGS_SCHEMA) {
        if (file.size > MAX_EXTERNAL_FINDINGS_IMPORT_BYTES) {
          throw new Error('External finding imports are limited to 384 KiB.');
        }
        const document = parseExternalFindingsDocument(value);
        preview = { kind: 'findings', document };
        const domainCount = new Set(document.findings.map((finding) => finding.domain)).size;
        onmessage(`Validated ${document.findings.length} local finding${document.findings.length === 1 ? '' : 's'} for ${domainCount} domain${domainCount === 1 ? '' : 's'}. Review the preview before importing.`);
      } else if (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && [
          DOMAIN_OBSERVATION_ROWS_SCHEMA,
          DNS_OBSERVATION_ROWS_SCHEMA,
          CERTIFICATE_OBSERVATION_ROWS_SCHEMA,
        ].includes(String((value as Record<string, unknown>).schema))
      ) {
        if (file.size > MAX_EXTERNAL_FINDINGS_IMPORT_BYTES) {
          throw new Error('Converted observation imports are limited to 384 KiB.');
        }
        const schema = (value as Record<string, unknown>).schema;
        const format = schema === DOMAIN_OBSERVATION_ROWS_SCHEMA
          ? 'domain-observations-v1'
          : schema === DNS_OBSERVATION_ROWS_SCHEMA
            ? 'dns-observations-v1'
            : 'certificate-observations-v1';
        conversionReport = convertSupportedExternalFindings(value, format);
        preview = { kind: 'findings', document: conversionReport.document };
        onmessage(`Converted ${conversionReport.accepted} accepted ${format.replaceAll('-', ' ')} row${conversionReport.accepted === 1 ? '' : 's'}; ${conversionReport.rejected} rejected, ${conversionReport.duplicates} duplicate, truncation ${conversionReport.truncated ? 'reached' : 'not reached'}. Review before importing.`);
      } else if (
        csv
        || Array.isArray(value)
        || (
          value
          && typeof value === 'object'
          && !Array.isArray(value)
          && (value as Record<string, unknown>).schema === EXTERNAL_FINDING_ROWS_SCHEMA
        )
      ) {
        if (file.size > MAX_EXTERNAL_FINDINGS_IMPORT_BYTES) {
          throw new Error('Converted finding imports are limited to 384 KiB.');
        }
        const document = csv
          ? convertExternalFindingsCsv(decoded)
          : convertExternalFindingRows(value);
        preview = { kind: 'findings', document };
        const domainCount = new Set(document.findings.map((finding) => finding.domain)).size;
        onmessage(`Converted and validated ${document.findings.length} finding${document.findings.length === 1 ? '' : 's'} for ${domainCount} domain${domainCount === 1 ? '' : 's'}. Review the normalized preview before importing.`);
      } else if (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && (value as Record<string, unknown>).schema === WEB_CAPTURE_MANIFEST_SCHEMA
      ) {
        if (file.size > MAX_EXTERNAL_FINDINGS_IMPORT_BYTES) {
          throw new Error('Sanitised web-capture manifests are limited to 384 KiB.');
        }
        const document = parseWebCaptureManifest(value);
        preview = { kind: 'findings', document };
        const domainCount = new Set(document.findings.map((finding) => finding.domain)).size;
        onmessage(`Validated ${document.findings.length} sanitised web-capture manifest finding${document.findings.length === 1 ? '' : 's'} for ${domainCount} domain${domainCount === 1 ? '' : 's'}. Artifact bytes were not imported. Review before importing.`);
      } else if (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && (value as Record<string, unknown>).schema === WEB_CAPTURE_SUMMARY_SCHEMA
      ) {
        if (file.size > MAX_EXTERNAL_FINDINGS_IMPORT_BYTES) {
          throw new Error('Sanitised web-capture imports are limited to 384 KiB.');
        }
        const document = parseWebCaptureSummary(value);
        preview = { kind: 'findings', document };
        const domainCount = new Set(document.findings.map((finding) => finding.domain)).size;
        onmessage(`Validated ${document.findings.length} sanitised web-capture finding${document.findings.length === 1 ? '' : 's'} for ${domainCount} domain${domainCount === 1 ? '' : 's'}. Review the normalized preview before importing.`);
      } else {
        const document = parseExternalIntelligenceDocument(value, await sourceDigest(bytes));
        preview = { kind: 'intelligence', document };
        onmessage(`Validated ${document.items.length} ${document.format.toUpperCase()} claim${document.items.length === 1 ? '' : 's'} with ${document.duplicatesSkipped} duplicate${document.duplicatesSkipped === 1 ? '' : 's'}, ${document.conflicts.length} conflict${document.conflicts.length === 1 ? '' : 's'}, and ${document.exclusions.length} exclusion${document.exclusions.length === 1 ? '' : 's'}. Select an existing case before merging.`);
      }
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'External findings import could not be validated.');
    } finally {
      input.value = '';
    }
  }

  async function applyImport() {
    if (!preview || applying) return;
    applying = true;
    try {
      if (preview.kind === 'findings') {
        const result = await importExternalFindings(preview.document);
        onmessage(`Imported ${result.findingsAdded} finding${result.findingsAdded === 1 ? '' : 's'} into ${result.casesCreated} new and ${result.casesUpdated} existing case${result.casesCreated + result.casesUpdated === 1 ? '' : 's'}${result.duplicatesSkipped ? `; skipped ${result.duplicatesSkipped} duplicate${result.duplicatesSkipped === 1 ? '' : 's'}` : ''}${result.pruned ? `; pruned ${result.pruned} old evidence snapshot${result.pruned === 1 ? '' : 's'} to stay within storage` : ''}.`);
      } else {
        if (!targetCaseId) throw new Error('Select an existing case before merging external intelligence.');
        const result = await importExternalIntelligence(targetCaseId, preview.document);
        onmessage(`Merged ${result.assertionsAdded} external assertion${result.assertionsAdded === 1 ? '' : 's'} into ${result.record.domain}${result.duplicatesSkipped ? `; skipped ${result.duplicatesSkipped} existing assertion${result.duplicatesSkipped === 1 ? '' : 's'}` : ''}${result.capacitySkipped ? `; skipped ${result.capacitySkipped} at the case assertion limit` : ''}. No collection, scoring, or case creation was started.`);
      }
      await oncomplete();
      preview = null;
      conversionReport = null;
      targetCaseId = '';
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'External findings could not be imported.');
    } finally {
      applying = false;
    }
  }
</script>

<details class="external-import card">
  <summary>Import bounded external findings</summary>
  <div class="import-body">
    <p>Preview the strict <code>whoisleuth.external-findings</code>, sanitised capture summary or artifact-metadata manifest, documented domain, DNS, or certificate observation rows, fixed-column CSV/JSON rows, a bounded STIX 2.1 bundle, a bounded MISP event, or a strict WARC/WACZ response archive locally before changing a case. WARC processing rejects or discards request records, sensitive headers, downloads, unsupported response types, excessive records, and mismatched supported record digests. WACZ processing additionally bounds ZIP expansion and verifies its declared WARC resources before applying the same WARC privacy filter. Imports never fetch references, run code, alter dispositions, start collection, score claims, publish events, or submit data elsewhere.</p>
    <label class="btn file-btn">Choose JSON, CSV, WARC, or WACZ<input type="file" accept="application/json,text/csv,application/warc,application/wacz,.json,.csv,.warc,.wacz" onchange={selectFile}></label>
    {#if findingsPreview}
      <section class="preview" aria-labelledby="external-findings-preview-title">
        <header>
          <div><p class="eyebrow">Validated findings preview</p><h3 id="external-findings-preview-title">{findingsPreview.source.name}</h3></div>
          <span>{countLabel(findingsPreview.findings.length, 'finding')} · {countLabel(domains.length, 'domain')}</span>
        </header>
        {#if conversionReport}
          <div class="preview-metrics" role="group" aria-label="Observation conversion summary">
            <span><strong>{conversionReport.accepted}</strong> accepted</span>
            <span><strong>{conversionReport.rejected}</strong> rejected</span>
            <span><strong>{conversionReport.duplicates}</strong> duplicate</span>
            <span><strong>{conversionReport.truncated ? 'yes' : 'no'}</strong> truncated</span>
          </div>
          {#if conversionReport.exclusions.length}
            <details class="excluded"><summary>Review conversion exclusions</summary>
              <ul>{#each conversionReport.exclusions as exclusion}<li><strong>Row {exclusion.row}</strong><p>{exclusion.reason}</p></li>{/each}</ul>
            </details>
          {/if}
        {/if}
        <ul>
          {#each findingsPreview.findings.slice(0, 8) as finding}
            <li><strong>{finding.domain}</strong><span>{finding.category} · {finding.evidenceClass.replaceAll('_', ' ')} · {finding.completeness}</span><p>{finding.summary}</p></li>
          {/each}
        </ul>
        {#if findingsPreview.findings.length > 8}<p class="preview-note">Showing 8 of {findingsPreview.findings.length} validated findings.</p>{/if}
        <div class="actions"><button class="primary" type="button" onclick={() => void applyImport()} disabled={applying}>{applying ? 'Importing…' : 'Import into cases'}</button><button class="btn" type="button" onclick={() => { preview = null; conversionReport = null; }} disabled={applying}>Cancel</button></div>
      </section>
    {:else if intelligencePreview}
      <section class="preview" aria-labelledby="external-intelligence-preview-title">
        <header>
          <div><p class="eyebrow">Validated {intelligencePreview.format.toUpperCase()} preview</p><h3 id="external-intelligence-preview-title">{intelligencePreview.sourceName}</h3></div>
          <span>{countLabel(intelligencePreview.items.length, 'claim')} · {countLabel(intelligencePreview.exclusions.length, 'exclusion')}</span>
        </header>
        <div class="preview-metrics" role="group" aria-label="External intelligence normalization summary">
          <span><strong>{intelligencePreview.items.length}</strong> accepted</span>
          <span><strong>{intelligencePreview.duplicatesSkipped}</strong> duplicate</span>
          <span><strong>{intelligencePreview.conflicts.length}</strong> conflict</span>
          <span><strong>{intelligencePreview.exclusions.length}</strong> excluded</span>
        </div>
        {#if intelligencePreview.truncated}<p class="preview-warning">Partial preview. An object, exclusion, or retained-claim bound was reached.</p>{/if}
        <ul>
          {#each intelligencePreview.items.slice(0, 8) as item}
            <li><strong>{item.entityValue}</strong><span>{item.entityType} · {item.claimType}{item.confidence === null ? '' : ` · confidence ${item.confidence}`}</span><p>{item.publisher ?? intelligencePreview.publisher ?? 'Publisher not declared'}{item.markings.length ? ` · ${item.markings.join(', ')}` : ''}</p></li>
          {/each}
        </ul>
        {#if intelligencePreview.items.length > 8}<p class="preview-note">Showing 8 of {intelligencePreview.items.length} accepted claims.</p>{/if}
        {#if intelligencePreview.conflicts.length || intelligencePreview.exclusions.length}
          <details class="excluded"><summary>Review conflicts and exclusions</summary>
            <ul>
              {#each [...intelligencePreview.conflicts, ...intelligencePreview.exclusions].slice(0, 20) as item}
                <li><strong>{item.type}</strong><span>{item.externalId ?? 'No external identifier'}</span><p>{item.reason}</p></li>
              {/each}
            </ul>
          </details>
        {/if}
        <label class="case-target">Merge into existing case<select bind:value={targetCaseId} disabled={applying || !intelligencePreview.items.length}><option value="">Select a case</option>{#each cases as record}<option value={record.id}>{record.domain}</option>{/each}</select></label>
        {#if !cases.length}<p class="preview-warning">Open a case before importing external intelligence. This importer never creates one automatically.</p>{/if}
        <p class="preview-note">The source file SHA-256 digest, external identifier, publisher, timestamps, labels, markings, confidence, and normalized entity are retained on each imported assertion. Claims remain separate from collected evidence.</p>
        <div class="actions"><button class="primary" type="button" onclick={() => void applyImport()} disabled={applying || !targetCaseId || !intelligencePreview.items.length}>{applying ? 'Merging…' : 'Merge assertions into case'}</button><button class="btn" type="button" onclick={() => { preview = null; targetCaseId = ''; }} disabled={applying}>Cancel</button></div>
      </section>
    {/if}
  </div>
</details>

<style>
  .external-import{margin-top:10px;padding:0}
  summary{padding:12px 14px;cursor:pointer;font:700 var(--text-xs) var(--mono)}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  details[open]>summary{border-bottom:1px solid var(--border)}
  .import-body{display:grid;gap:10px;padding:13px}
  .import-body>p{max-width:880px;margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  code{color:var(--accent);font-size:var(--text-2xs)}
  .file-btn{justify-self:start}
  .preview{display:grid;gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .preview header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px}
  .preview h3{margin:0;font-size:var(--text-base)}
  .preview header>span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .preview ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}
  .preview li{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .preview li strong,.preview li span{display:block;overflow-wrap:anywhere}
  .preview li span{margin-top:2px;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .preview li p{margin:5px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .preview-note{margin:0;color:var(--muted);font-size:var(--text-2xs)}
  .preview-metrics{display:flex;flex-wrap:wrap;gap:7px}.preview-metrics span{padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:650 var(--text-2xs) var(--mono)}.preview-metrics strong{color:var(--accent)}
  .preview-warning{margin:0;color:var(--amber);font:650 var(--text-xs) var(--mono)}
  .case-target{display:grid;gap:5px;max-width:480px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .excluded{padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}.excluded>summary{padding:0;border:0}.excluded ul{margin-top:8px}
  .actions{display:flex;flex-wrap:wrap;gap:8px}
  @media(max-width:680px){.preview ul{grid-template-columns:minmax(0,1fr)}.actions button{flex:1}}
</style>
