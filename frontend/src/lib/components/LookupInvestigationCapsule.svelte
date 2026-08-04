<script lang="ts">
  import type { CaseRecord } from '$lib/analysis/case-model.ts';
  import type { LookupAssetGraph } from '$lib/analysis/lookup-asset-graph.ts';
  import type { LookupInvestigationBrief } from '$lib/analysis/lookup-investigation-brief.ts';
  import {
    buildInvestigationCapsule,
    investigationCapsuleFilename,
    serializeInvestigationCapsule,
  } from '$lib/analysis/investigation-capsule.ts';

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
  const analystRecordCount = $derived((caseRecord?.decisions.length ?? 0) + (caseRecord?.assertions.length ?? 0));

  async function download(): Promise<void> {
    if (busy) return;
    busy = true;
    message = '';
    try {
      const capsule = await buildInvestigationCapsule({
        applicationVersion,
        lookupEvidence,
        brief,
        graph,
        caseRecord,
        includeAnalystRecords,
      });
      const url = URL.createObjectURL(new Blob([serializeInvestigationCapsule(capsule)], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = investigationCapsuleFilename(capsule);
      anchor.click();
      URL.revokeObjectURL(url);
      message = 'Downloaded a checksummed local handoff manifest.';
    } catch {
      message = 'The local handoff manifest could not be prepared.';
    } finally {
      busy = false;
    }
  }
</script>

<details class="card capsule">
  <summary>Portable investigation capsule</summary>
  <div class="capsule-body">
    <p>Export one deterministic manifest that embeds the bounded investigation brief and relationship graph, and links the current Lookup evidence JSON by SHA-256 digest.</p>
    <ul>
      <li>The evidence file itself is not embedded. Download and retain that exact file separately.</li>
      <li>Checksums detect changes but do not identify or authenticate the person who created the capsule.</li>
      <li>Case notes, contacts, response actions, and raw source payloads are excluded.</li>
    </ul>
    <label class:disabled={!analystRecordCount}>
      <input type="checkbox" bind:checked={includeAnalystRecords} disabled={!analystRecordCount}>
      Include {analystRecordCount} analyst decision and assertion record{analystRecordCount === 1 ? '' : 's'} from the linked case
    </label>
    {#if analystRecordCount}<p class="caution">Review analyst-authored records for sensitive or personal information before sharing.</p>{/if}
    <div class="actions"><button class="btn" type="button" onclick={() => void download()} disabled={busy}>{busy ? 'Preparing…' : 'Download capsule'}</button></div>
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
  .actions{margin-top:12px}
  .status{color:var(--green)}
  @media(max-width:650px){.actions button{width:100%}}
</style>
