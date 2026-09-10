<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CaseRecord } from '$lib/analysis/case-model.ts';
  import type { LookupAssetGraph } from '$lib/analysis/lookup-asset-graph.ts';
  import type { LookupInvestigationBrief } from '$lib/analysis/lookup-investigation-brief.ts';
  import {
    buildInvestigationCapsule,
    investigationCapsuleFilename,
    serializeInvestigationCapsule,
  } from '$lib/analysis/investigation-capsule.ts';
  import { runInvestigationPackageWorker } from '$lib/investigation-package-worker.ts';
  import { downloadLocalFile } from '$lib/download-local-file.ts';

  let {
    applicationVersion,
    lookupEvidence,
    brief,
    graph,
    caseRecord = null,
  }: {
    applicationVersion: string;
    lookupEvidence: Readonly<Record<string, unknown> & { schema?: unknown; schemaVersion?: unknown }>;
    brief: LookupInvestigationBrief;
    graph: LookupAssetGraph;
    caseRecord?: CaseRecord | null;
  } = $props();

  let includeAnalystRecords = $state(false);
  let busy = $state(false);
  let message = $state('');
  let controller: AbortController | null = null;
  const analystRecordCount = $derived((caseRecord?.decisions.length ?? 0) + (caseRecord?.assertions.length ?? 0));

  async function download(asPackage = false): Promise<void> {
    if (busy) return;
    busy = true;
    message = '';
    const current = new AbortController();
    controller = current;
    try {
      const input = {
        applicationVersion,
        lookupEvidence,
        brief,
        graph,
        caseRecord: includeAnalystRecords ? caseRecord : null,
        includeAnalystRecords,
      };
      if (asPackage) {
        const generatedAt = new Date().toISOString();
        const output = await runInvestigationPackageWorker('capsule', { capsule: $state.snapshot(input), generatedAt }, { signal: current.signal });
        if (current.signal.aborted) return;
        downloadLocalFile(output.file, `whoisleuth-investigation-${generatedAt.slice(0, 10)}.zip`);
        message = 'Downloaded the capsule and its exact linked Lookup evidence together. No saved records were changed.';
      } else {
        const capsule = await buildInvestigationCapsule(input);
        if (current.signal.aborted) return;
        downloadLocalFile(new Blob([serializeInvestigationCapsule(capsule)], { type: 'application/json;charset=utf-8' }), investigationCapsuleFilename(capsule));
        message = 'Downloaded a checksummed local handoff manifest.';
      }
    } catch {
      if (!current.signal.aborted) message = 'The local handoff could not be prepared. No saved records were changed.';
    } finally {
      if (controller === current) { controller = null; busy = false; }
    }
  }
  function cancel() { controller?.abort(); controller = null; busy = false; message = 'Handoff preparation cancelled.'; }
  // A refreshed Lookup must not finish downloading the previous target's work.
  $effect(() => { void lookupEvidence; void brief; void graph; return () => { controller?.abort(); controller = null; busy = false; }; });
  onDestroy(() => controller?.abort());
</script>

<details class="card capsule">
  <summary>Portable investigation capsule</summary>
  <div class="capsule-body">
    <p>Keep the investigation brief, relationship graph and exact linked Lookup evidence together in a portable ZIP. The capsule-only JSON remains available.</p>
    <ul>
      <li>The ZIP contains both files. With capsule-only JSON, retain the exact linked Lookup evidence separately.</li>
      <li>Checksums detect changes but do not identify or authenticate the person who created the capsule.</li>
      <li>Case notes, contacts, response actions, and raw source payloads are excluded.</li>
    </ul>
    <label class:disabled={!analystRecordCount}>
      <input type="checkbox" bind:checked={includeAnalystRecords} disabled={!analystRecordCount || busy}>
      Include {analystRecordCount} analyst decision and assertion record{analystRecordCount === 1 ? '' : 's'} from the linked case
    </label>
    {#if analystRecordCount}<p class="caution">Review analyst-authored records for sensitive or personal information before sharing.</p>{/if}
    <div class="actions">
      <button class="primary" type="button" onclick={() => void download(true)} disabled={busy}>Download evidence package</button>
      <button class="btn" type="button" onclick={() => void download()} disabled={busy}>Download capsule</button>
      {#if busy}<button class="btn" type="button" onclick={cancel}>Cancel preparation</button>{/if}
    </div>
    {#if message}<p class="status" role="status">{message}</p>{/if}
  </div>
</details>

<style>
  .capsule{margin-top:12px}
  .capsule-body{padding-top:12px}
  .capsule p,.capsule li,.capsule label{line-height:1.5}
  .capsule ul{padding-left:20px;color:var(--muted)}
  .capsule label{display:flex;align-items:flex-start;gap:8px;margin-top:12px}
  .capsule label.disabled{color:var(--muted)}
  .caution{color:var(--amber);font-size:var(--text-xs)}
  .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .status{color:var(--success)}
  @media(max-width:650px){.actions button{width:100%}}
</style>
