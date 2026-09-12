<script lang="ts">
  import { tick } from 'svelte';
  import ExternalImportReview, { type ExternalImportPreview } from './ExternalImportReview.svelte';
  import { parseBoundedJson } from '$lib/bounded-json';
  import {
    EXTERNAL_FINDINGS_SCHEMA,
    importExternalFindings,
    importExternalFindingsIntoCase,
    importExternalIntelligence,
    MAX_EXTERNAL_FINDINGS_IMPORT_BYTES,
    MAX_EXTERNAL_INTELLIGENCE_IMPORT_BYTES,
    parseExternalFindingsDocument,
    parseExternalIntelligenceDocument,
    type CaseRecord,
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
    oncommitted,
    onmessage,
  }: {
    cases: readonly CaseRecord[];
    oncomplete: () => void | Promise<void>;
    oncommitted: (cases: CaseRecord[]) => void;
    onmessage: (message: string) => void;
  } = $props();

  let preview = $state<ExternalImportPreview | null>(null);
  let conversionReport = $state<ExternalFindingConversionReport | null>(null);
  let applying = $state(false);
  let parsing = $state(false);
  let selectionGeneration = 0;
  let fileInput: HTMLInputElement;

  async function reconcileCommitted(cases: CaseRecord[], success: string): Promise<void> {
    try {
      await oncomplete();
      onmessage(success);
    } catch {
      try {
        oncommitted(cases);
        onmessage(`${success} The import was saved, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the browser-local read.`);
      } catch {
        onmessage(`${success} The import was saved, but Cases could not be reread or reconciled in the current view. Reload before importing another document.`);
      }
    }
  }


  async function sourceDigest(bytes: ArrayBuffer): Promise<string> {
    if (!globalThis.crypto?.subtle) throw new Error('Browser cryptography is unavailable for the required source-file digest.');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function selectFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const generation = ++selectionGeneration;
    preview = null;
    conversionReport = null;
    parsing = Boolean(file);
    if (!file) return;
    try {
      const wacz = file.name.toLowerCase().endsWith('.wacz') || file.type === 'application/wacz';
      if (wacz) {
        if (file.size > MAX_WACZ_IMPORT_BYTES) {
          throw new Error('Portable WACZ imports are limited to 8 MiB.');
        }
        const report = await parseWaczEvidenceArchive(await file.arrayBuffer(), file.name);
        if (generation !== selectionGeneration) return;
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
        if (generation !== selectionGeneration) return;
        preview = { kind: 'findings', document: report.document };
        onmessage(`Validated ${report.accepted} portable WARC finding${report.accepted === 1 ? '' : 's'} from ${report.records} bounded record${report.records === 1 ? '' : 's'}; ${report.excluded} excluded. The archive stayed local and only normalized page evidence is available for deliberate import.`);
        return;
      }
      if (file.size > MAX_EXTERNAL_INTELLIGENCE_IMPORT_BYTES) {
        throw new Error('External intelligence imports are limited to 512 KiB.');
      }
      const bytes = await file.arrayBuffer();
      if (generation !== selectionGeneration) return;
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const csv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
      let value: unknown = null;
      if (!csv) {
        try {
          value = parseBoundedJson(decoded, {
            label: 'External intelligence import',
            maximumBytes: MAX_EXTERNAL_INTELLIGENCE_IMPORT_BYTES,
          });
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
        if (generation !== selectionGeneration) return;
        preview = { kind: 'intelligence', document };
        onmessage(`Validated ${document.items.length} ${document.format.toUpperCase()} claim${document.items.length === 1 ? '' : 's'} with ${document.duplicatesSkipped} duplicate${document.duplicatesSkipped === 1 ? '' : 's'}, ${document.conflicts.length} conflict${document.conflicts.length === 1 ? '' : 's'}, and ${document.exclusions.length} exclusion${document.exclusions.length === 1 ? '' : 's'}. Select an existing case before merging.`);
      }
    } catch (cause) {
      if (generation !== selectionGeneration) return;
      onmessage(cause instanceof Error ? cause.message : 'External findings import could not be validated.');
    } finally {
      if (generation === selectionGeneration) {
        parsing = false;
        input.value = '';
      }
    }
  }

  async function applyImport(selected: ExternalImportPreview, targetCaseId: string) {
    if (!preview || selected.kind !== preview.kind || parsing || applying) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    applying = true;
    try {
      if (selected.kind === 'findings' && targetCaseId) {
        const result = await importExternalFindingsIntoCase(targetCaseId, selected.document);
        await reconcileCommitted(result.cases, `Imported ${result.findingsAdded} findings into the selected incident Case; ${result.duplicatesSkipped} duplicates skipped.`);
      } else if (selected.kind === 'findings') {
        const result = await importExternalFindings(selected.document);
        await reconcileCommitted(result.cases, `Imported ${result.findingsAdded} finding${result.findingsAdded === 1 ? '' : 's'} into ${result.casesCreated} new and ${result.casesUpdated} existing case${result.casesCreated + result.casesUpdated === 1 ? '' : 's'}${result.duplicatesSkipped ? `; skipped ${result.duplicatesSkipped} duplicate${result.duplicatesSkipped === 1 ? '' : 's'}` : ''}${result.pruned ? `; pruned ${result.pruned} old evidence snapshot${result.pruned === 1 ? '' : 's'} to stay within storage` : ''}.`);
      } else {
        if (!targetCaseId) throw new Error('Select an existing case before merging external intelligence.');
        const result = await importExternalIntelligence(targetCaseId, selected.document);
        await reconcileCommitted(result.cases, `Merged ${result.assertionsAdded} external assertion${result.assertionsAdded === 1 ? '' : 's'} into ${result.record.domain}${result.duplicatesSkipped ? `; skipped ${result.duplicatesSkipped} existing assertion${result.duplicatesSkipped === 1 ? '' : 's'}` : ''}${result.capacitySkipped ? `; skipped ${result.capacitySkipped} at the case assertion limit` : ''}. No collection, scoring, or case creation was started.`);
      }
      preview = null;
      conversionReport = null;
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'External findings could not be imported.');
    } finally {
      applying = false;
      await tick();
      const active = document.activeElement;
      if (active === origin || active === null || active === document.body || active === document.documentElement) {
        const target = origin?.isConnected ? origin : fileInput;
        target?.focus({ preventScroll: true });
      }
    }
  }

  async function cancelReview() {
    if (applying) return;
    const origin = document.activeElement;
    preview = null;
    conversionReport = null;
    await tick();
    if (origin && !origin.isConnected && document.activeElement === document.body) fileInput?.focus();
  }
</script>

<details class="external-import card" aria-busy={parsing}>
  <summary>Import bounded external findings</summary>
  <div class="import-body">
    <p>Review local evidence before adding it to Cases. Imports do not collect data, change analyst dispositions or submit reports.</p>
    <details class="formats"><summary>Supported files and limits</summary>
      <p>Findings, sanitised capture manifests, observation rows and fixed-column CSV/JSON: 384 KiB. STIX 2.1 bundles and MISP events: 512 KiB. WARC/WACZ archives: 8 MiB.</p>
      <p>Archive import retains sanitised response evidence, not raw requests, sensitive headers or unsupported content. WACZ resources must pass their declared integrity checks. References are never fetched. See the <a href="/cli">CLI reference</a> for the supported interchange formats.</p>
    </details>
    <label class="btn file-btn">{parsing ? 'Reading selected file…' : 'Choose JSON, CSV, WARC, or WACZ'}<input bind:this={fileInput} type="file" accept="application/json,text/csv,application/warc,application/wacz,.json,.csv,.warc,.wacz" onchange={selectFile} disabled={parsing || applying}></label>
    {#if preview && !parsing}
      {#key preview}
        <ExternalImportReview {preview} {conversionReport} {cases} {applying} onimport={applyImport} oncancel={() => { void cancelReview(); }} />
      {/key}
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
  .formats summary{padding:4px 0;min-height:30px}
  .formats p{max-width:75ch;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .file-btn{justify-self:start}
</style>
