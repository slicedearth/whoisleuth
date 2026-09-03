<script lang="ts">
  import { parseBoundedJson } from '$lib/bounded-json';
  import {
    importExternalFindingsIntoCase,
    MAX_EXTERNAL_FINDINGS_IMPORT_BYTES,
    type CaseRecord,
    type ExternalFindingsDocument,
  } from '$lib/cases';
  import { externalFindingsCaseTargets } from '$lib/analysis/external-findings-import.ts';
  import { buildLocalRenderedCaptureHandoff } from '$lib/analysis/local-rendered-capture-handoff.ts';
  import {
    WEB_CAPTURE_MANIFEST_SCHEMA,
    parseWebCaptureManifest,
  } from '$lib/analysis/web-capture-import.ts';
  import CopyableCommand from '$lib/components/CopyableCommand.svelte';

  let {
    record,
    exactIncidentUrl,
    onsaved,
    oncommitted,
    onmessage,
  }: {
    record: CaseRecord;
    exactIncidentUrl: string | null;
    onsaved: () => void | Promise<void>;
    oncommitted: (cases: CaseRecord[]) => void;
    onmessage: (message: string) => void;
  } = $props();

  let preview = $state<ExternalFindingsDocument | null>(null);
  let previewTargets = $state<readonly string[]>([]);
  let parsing = $state(false);
  let importing = $state(false);
  let selectionGeneration = 0;
  const handoff = $derived.by(() => {
    if (!exactIncidentUrl) return null;
    try {
      return buildLocalRenderedCaptureHandoff(exactIncidentUrl);
    } catch {
      return null;
    }
  });

  function countLabel(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
  }

  async function selectManifest(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const generation = ++selectionGeneration;
    preview = null;
    previewTargets = [];
    parsing = Boolean(file);
    if (!file) return;
    try {
      if (file.size > MAX_EXTERNAL_FINDINGS_IMPORT_BYTES) {
        throw new Error('Rendered-capture manifests are limited to 384 KiB.');
      }
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (generation !== selectionGeneration) return;
      const value = parseBoundedJson(decoded, {
        label: 'Rendered-capture manifest',
        maximumBytes: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES,
      });
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || (value as Record<string, unknown>).schema !== WEB_CAPTURE_MANIFEST_SCHEMA) {
        throw new Error(`Select a ${WEB_CAPTURE_MANIFEST_SCHEMA} manifest produced by the local rendered-capture command.`);
      }
      const document = parseWebCaptureManifest(value);
      const targets = externalFindingsCaseTargets(document, record.domain);
      if (generation !== selectionGeneration) return;
      preview = document;
      previewTargets = targets;
      onmessage(`Validated ${countLabel(document.findings.length, 'capture finding')} for this Case. Review the manifest summary before importing.`);
    } catch (cause) {
      if (generation === selectionGeneration) {
        onmessage(cause instanceof Error ? cause.message : 'Could not validate the rendered-capture manifest.');
      }
    } finally {
      if (generation === selectionGeneration) parsing = false;
      input.value = '';
    }
  }

  async function importManifest() {
    if (!preview || importing) return;
    importing = true;
    try {
      const result = await importExternalFindingsIntoCase(record.id, preview);
      const success = `Imported ${countLabel(result.findingsAdded, 'rendered-capture finding')} into ${record.domain}${result.duplicatesSkipped ? `; skipped ${countLabel(result.duplicatesSkipped, 'duplicate')}` : ''}. Artifact bytes remained outside the app.`;
      try {
        await onsaved();
        onmessage(success);
      } catch {
        try {
          oncommitted(result.cases);
          onmessage(`${success} The change was saved, but Cases could not be reread; the committed Case snapshot is shown locally.`);
        } catch {
          onmessage(`${success} The change was saved, but Cases could not be reread or reconciled. Reload before importing another manifest.`);
        }
      }
      preview = null;
      previewTargets = [];
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Could not import the rendered-capture manifest.');
    } finally {
      importing = false;
    }
  }
</script>

<details class="capture-workspace">
  <summary>Capture the retained Incident URL locally</summary>
  <div class="capture-body">
    {#if handoff}
      <p>The browser app will not render an Incident URL or run this command. From this source checkout, the command opens the exact retained URL in a disposable local browser, executes page scripts within bounded controls, and writes a new private output directory.</p>
      <CopyableCommand command={handoff.command} label="Rendered-capture command" />
      <p class="manifest-path">Then select <code>{handoff.manifestPath}</code>. Review the URL first: its path and query are sent to the target and may contain sensitive values.</p>
      <label class="file-btn btn" aria-disabled={parsing || importing}>
        {parsing ? 'Checking manifest…' : 'Select capture manifest'}
        <input type="file" accept="application/json,.json" onchange={selectManifest} disabled={parsing || importing}>
      </label>
      {#if preview}
        <section class="capture-preview" aria-labelledby={`capture-preview-${record.id}`}>
          <header><div><p class="eyebrow">Local preview</p><h4 id={`capture-preview-${record.id}`}>Manifest evidence</h4></div><span>{countLabel(preview.findings.length, 'finding')}</span></header>
          <dl>
            <div><dt>Case</dt><dd>{record.domain}</dd></div>
            <div><dt>Captured hostname{previewTargets.length === 1 ? '' : 's'}</dt><dd>{previewTargets.join(', ')}</dd></div>
            <div><dt>Source</dt><dd>{preview.source.name}</dd></div>
            <div><dt>Collected</dt><dd>{preview.source.collectedAt ?? 'Not declared'}</dd></div>
          </dl>
          <ol>
            {#each preview.findings as finding}
              <li><strong>{finding.category} · {finding.completeness}</strong><p>{finding.summary}</p><small>{finding.observedAt}{finding.limitations.length ? ` · ${finding.limitations.join('; ')}` : ''}</small></li>
            {/each}
          </ol>
          <p>Only sanitised manifest metadata and declared digests enter this Case. Screenshot and DOM-digest files stay in the local capture directory and their bytes are not verified by this import.</p>
          <div class="actions"><button class="primary" type="button" onclick={() => void importManifest()} disabled={importing}>{importing ? 'Importing…' : 'Import into this Case'}</button><button class="btn" type="button" onclick={() => { preview = null; previewTargets = []; }} disabled={importing}>Cancel</button></div>
        </section>
      {/if}
    {:else if exactIncidentUrl}
      <p class="notice">The retained Incident URL uses a target form that the bounded local capture tool does not support. Use an HTTP(S) URL without credentials or a non-default port.</p>
    {:else}
      <p>Save an Incident objective and deliberately retain the exact URL from Lookup before preparing a rendered capture. An origin-only Case does not preserve the path needed for this handoff.</p>
    {/if}
  </div>
</details>

<style>
  .capture-workspace{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  summary{padding:11px 12px;cursor:pointer;font:700 var(--text-xs) var(--mono)}details[open]>summary{border-bottom:1px solid var(--border)}
  .capture-body{display:grid;gap:10px;padding:12px}.capture-body>p{max-width:880px;margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.manifest-path code{overflow-wrap:anywhere;color:var(--accent)}
  .file-btn{justify-self:start}.file-btn input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.file-btn:focus-within{outline:2px solid var(--focus);outline-offset:3px}
  .capture-preview{display:grid;gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.capture-preview header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px}.capture-preview h4{margin:0}.capture-preview header>span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--border)}dl>div{min-width:0;padding:8px;background:var(--panel)}dt{color:var(--muted);font:650 var(--text-2xs) var(--mono)}dd{margin:3px 0 0;overflow-wrap:anywhere;font-size:var(--text-xs)}
  ol{display:grid;gap:7px;margin:0;padding:0;list-style:none}li{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}li strong,li small{display:block}li p{margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--text-xs)}li small{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}.capture-preview>p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .actions{display:flex;flex-wrap:wrap;gap:8px}.notice{padding:9px 10px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06)}
  @media(max-width:620px){dl{grid-template-columns:1fr}.file-btn,.actions button{width:100%}}
</style>
