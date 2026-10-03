<script lang="ts">
  import {
    buildLookupReplayCaseEvidence,
    LOOKUP_EVIDENCE_REPLAY_MAX_BYTES,
    parseLookupEvidenceReplay,
    type LookupEvidenceReplay,
  } from '$lib/analysis/lookup-evidence-replay.ts';
  import { buildLookupReplayCheckpointFacts } from '$lib/analysis/case-evidence-checkpoint.ts';
  import { LookupCaseController } from '$lib/controllers/lookup-case-controller.ts';
  import type { CaseRecord, CaseTransitionExpectation } from '$lib/cases';
  import LookupEvidenceReading from './LookupEvidenceReading.svelte';
  import LookupEvidenceCheckpoint from '$lib/components/LookupEvidenceCheckpoint.svelte';
  import CasePicker from './CasePicker.svelte';
  import { buildLookupEvidenceReplayDiff } from '$lib/analysis/lookup-evidence-replay-diff.ts';

  let replay = $state<LookupEvidenceReplay | null>(null);
  let status = $state('');
  let loading = $state(false);
  let statusState = $state<'idle' | 'success' | 'error'>('idle');
  let expectedSha256 = $state('');
  let comparison = $state<ReturnType<typeof buildLookupEvidenceReplayDiff> | null>(null);
  let comparisonStatus = $state('');
  let comparisonLoading = $state(false);
  let comparisonState = $state<'idle' | 'success' | 'error'>('idle');
  let caseRecord = $state<CaseRecord | null>(null);
  let caseCandidates = $state.raw<CaseRecord[]>([]);
  let caseStatus = $state('');
  let caseBusy = $state(false);
  const replayCheckpointFacts = $derived(replay ? buildLookupReplayCheckpointFacts(replay) : []);
  const caseController = new LookupCaseController();
  let replayGeneration = 0;
  let comparisonGeneration = 0;

  async function load(event: Event) {
    const control = event.currentTarget as HTMLInputElement;
    const file = control.files?.[0];
    if (!file) return;
    const generation = ++replayGeneration;
    comparisonGeneration += 1;
    comparisonLoading = false;
    loading = true;
    status = '';
    statusState = 'idle';
    replay = null;
    comparison = null;
    caseRecord = null;
    caseCandidates = [];
    caseStatus = '';
    caseBusy = false;
    try {
      if (file.size > LOOKUP_EVIDENCE_REPLAY_MAX_BYTES) {
        throw new Error('Lookup evidence replay files are limited to 5 MB.');
      }
      const checksum = expectedSha256.trim();
      const next = await parseLookupEvidenceReplay(
        await file.text(),
        checksum ? { expectedSha256: checksum } : {},
      );
      if (generation !== replayGeneration) return;
      replay = next;
      statusState = 'success';
      status = `Loaded ${file.name} locally${next.digestVerified ? ' and verified its checksum' : ''}. No source was contacted.`;
      const existing = next.caseDomain
        ? await caseController.refresh(next.caseDomain)
        : { record: null, records: [], status: '' };
      if (generation !== replayGeneration) return;
      caseRecord = existing.record;
      caseCandidates = existing.records;
      caseStatus = existing.status;
    } catch (cause) {
      if (generation !== replayGeneration) return;
      status = cause instanceof Error ? cause.message : 'The evidence file could not be replayed.';
      statusState = 'error';
    } finally {
      if (generation === replayGeneration) loading = false;
      control.value = '';
    }
  }

  async function saveReplayToCase() {
    const caseDomain = replay?.caseDomain;
    if (!replay || !caseDomain || caseBusy) return;
    const current = replay;
    const generation = replayGeneration;
    caseBusy = true;
    const result = await caseController.openReplay(
      caseDomain,
      buildLookupReplayCaseEvidence(current),
      caseRecord ? { caseId: caseRecord.id } : {},
    );
    if (generation === replayGeneration && replay === current) {
      if (result.record) {
        caseRecord = result.record;
        caseCandidates = [...caseCandidates.filter(record => record.id !== result.record!.id), result.record];
      }
      caseStatus = result.status;
      caseBusy = false;
    }
  }

  async function saveReplayCheckpoint(
    fields: string[],
    expectations: Readonly<Record<string, CaseTransitionExpectation>> = {},
  ) {
    if (!replay || !caseRecord || caseBusy) return 'stale' as const;
    const current = replay;
    const generation = replayGeneration;
    caseBusy = true;
    const result = await caseController.recordCheckpoint(
      caseRecord,
      replayCheckpointFacts,
      fields,
      expectations,
    );
    if (generation === replayGeneration && replay === current) {
      caseRecord = result.record;
      caseStatus = result.status;
      caseBusy = false;
      return result.mutationOutcome ?? 'rejected';
    }
    return 'stale' as const;
  }

  async function loadComparison(event: Event) {
    const control = event.currentTarget as HTMLInputElement;
    const file = control.files?.[0];
    if (!file || !replay || loading || comparisonLoading) return;
    const primary = replay;
    const primaryGeneration = replayGeneration;
    const generation = ++comparisonGeneration;
    comparisonLoading = true;
    comparisonStatus = '';
    comparisonState = 'idle';
    try {
      if (file.size > LOOKUP_EVIDENCE_REPLAY_MAX_BYTES) throw new Error('Lookup evidence replay files are limited to 5 MB.');
      const second = await parseLookupEvidenceReplay(await file.text());
      if (generation !== comparisonGeneration || primaryGeneration !== replayGeneration || replay !== primary) return;
      comparison = buildLookupEvidenceReplayDiff(primary, second);
      comparisonState = 'success';
      comparisonStatus = `Compared ${file.name} locally. No source was contacted.`;
    } catch (cause) {
      if (generation !== comparisonGeneration || primaryGeneration !== replayGeneration || replay !== primary) return;
      comparison = null;
      comparisonStatus = cause instanceof Error ? cause.message : 'The second evidence file could not be compared.';
      comparisonState = 'error';
    } finally {
      if (generation === comparisonGeneration) comparisonLoading = false;
      control.value = '';
    }
  }
</script>

<details class="replay card">
  <summary>
    <span>
      <strong>Replay exported evidence</strong>
      <small>Review a supported WHOISleuth Lookup evidence JSON file without contacting a source.</small>
    </span>
  </summary>
  <div class="body">
    <label class="picker">
      <span>{loading ? 'Reading evidence…' : 'Choose evidence JSON'}</span>
      <input type="file" accept="application/json,.json" disabled={loading} onchange={load} />
    </label>
    <label class="checksum">
      <span>Expected SHA-256 <small>optional</small></span>
      <input bind:value={expectedSha256} maxlength="64" inputmode="text" autocomplete="off" spellcheck="false" placeholder="Paste a trusted 64-character checksum before choosing the file" />
    </label>
    <p class="note">The file stays in this browser tab. Replay validates schema, nesting and entry bounds, calculates the file digest, optionally verifies a trusted checksum, and renders bounded normalised facts only.</p>
    <p class="replay-status" class:status-success={statusState === 'success'} class:status-error={statusState === 'error'} role={statusState === 'error' ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">{status}</p>

    {#if replay}
      <section class="replay-result" aria-labelledby="replay-title">
        <LookupEvidenceReading {replay} />

        {#if replay.caseDomain}
          <section class="case-handoff" aria-labelledby="replay-case-title">
            <div>
              <p class="eyebrow">Saved handoff</p>
              <h3 id="replay-case-title">Continue this historical review in a Case</h3>
              <p class="note">Registration: {replay.caseDomain}. Submitted target: {replay.target}.{' '}{#if replay.observationHostname}DNS, TLS and web collection scope: {replay.observationHostname}.{' '}{/if}{#if replay.webObservationMode}Web evidence concerns a selected URL, not the homepage.{' '}{/if}Saving retains the export time and imported provenance without contacting a source.</p>
            </div>
            {#if caseCandidates.length > 1}<CasePicker id="replay-incident-case" records={caseCandidates} selectedId={caseRecord?.id ?? ''} disabled={caseBusy} select={(id) => { caseRecord = caseCandidates.find(record => record.id === id) ?? null; caseStatus = ''; }} />{/if}
            <button class="btn" type="button" disabled={caseBusy || (caseCandidates.length > 0 && !caseRecord)} onclick={() => void saveReplayToCase()}>{caseBusy ? 'Saving…' : caseRecord ? 'Add replay evidence to Case' : 'Create Case'}</button>
            <p class="case-status" role="status" aria-live="polite" aria-atomic="true">{caseStatus}</p>
            {#if caseRecord}<a class="case-link" href={`/monitor?case=${encodeURIComponent(caseRecord.id)}`}>Open Case in Respond →</a>{/if}
          </section>

          {#if caseRecord && replayCheckpointFacts.length}
            <LookupEvidenceCheckpoint
              facts={replayCheckpointFacts}
              pins={caseRecord.evidencePins}
              onsave={saveReplayCheckpoint}
              actionBusy={caseBusy}
              headingId="replay-checkpoint-title"
            />
          {/if}
        {/if}

        <section class="comparison" aria-labelledby="replay-comparison-title">
          <h3 id="replay-comparison-title">Compare another capture</h3>
          <p class="note">Choose a second export for the same target. The comparison separates observed value changes from source-quality and application-interpretation differences.</p>
          <label class="picker"><span>{comparisonLoading ? 'Reading second evidence…' : 'Choose second evidence JSON'}</span><input type="file" accept="application/json,.json" disabled={loading || comparisonLoading} onchange={loadComparison} /></label>
          <p class="comparison-status" class:status-success={comparisonState === 'success'} class:status-error={comparisonState === 'error'} role={comparisonState === 'error' ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">{comparisonStatus}</p>
          {#if comparison}
            <div class="comparison-counts"><span><strong>{comparison.counts.observedChanges}</strong> observed</span><span><strong>{comparison.counts.collectionDifferences}</strong> collection</span><span><strong>{comparison.counts.interpretationDifferences}</strong> interpretation</span></div>
            <ol>{#each comparison.rows.filter((item) => item.kind !== 'unchanged') as row}<li data-comparison-kind={row.kind}><div><strong>{row.label}</strong><span>{row.kind.replaceAll('_', ' ')}</span></div><p>{row.left} → {row.right}</p><small>{row.explanation}</small></li>{/each}</ol>
            {#if !comparison.rows.some((item) => item.kind !== 'unchanged')}<p>No bounded difference was observed in the comparable replay fields.</p>{/if}
          {/if}
        </section>


      </section>
    {/if}
  </div>
</details>

<style>
  .replay{margin-top:12px;padding:0;overflow:clip}
  .replay>summary{padding:13px var(--card-pad);cursor:pointer;list-style:none}
  .replay>summary::-webkit-details-marker{display:none}
  .replay>summary span{display:grid;gap:3px}
  .replay>summary strong{font:700 var(--text-sm) var(--mono)}
  .replay>summary small,.note{color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .body{padding:0 var(--card-pad) var(--card-pad);border-top:1px solid var(--border)}
  .picker{display:inline-flex;align-items:center;margin-top:12px;padding:8px 11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font:680 var(--text-xs) var(--mono);cursor:pointer}
  .picker:focus-within{outline:2px solid var(--focus);outline-offset:3px}
  .picker input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .checksum{display:grid;gap:5px;max-width:760px;margin-top:10px}.checksum span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.checksum small{font-weight:500}.checksum input{width:100%;font-family:var(--mono)}
  .note{max-width:760px;margin:9px 0}
  .status-success{color:var(--success)}
  .status-error{color:var(--danger)}
  .replay-status:empty,.comparison-status:empty{min-height:0;margin:0}
  .replay-result{display:grid;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
  .case-handoff{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px 14px;padding:11px;border:1px solid color-mix(in srgb,var(--accent2) 38%,var(--border));border-radius:var(--radius-sm);background:var(--panel-raised)}
  .case-handoff h3,.case-handoff p{margin:0}.case-handoff .note{margin-top:5px}.case-status{grid-column:1/-1;margin:0;color:var(--muted);font-size:var(--text-xs)}.case-status:empty{display:none}.case-link{grid-column:1/-1;width:max-content;font:680 var(--text-xs) var(--mono)}
  h3{margin:2px 0 -3px;font-size:var(--text-sm)}
  .comparison{display:grid;gap:8px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.comparison .picker{width:max-content;margin:0}.comparison-counts{display:flex;flex-wrap:wrap;gap:6px}.comparison-counts span{padding:6px 8px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font-size:var(--text-2xs)}.comparison ol{display:grid;gap:6px;margin:0;padding:0;list-style:none}.comparison li{min-width:0;padding:8px;border:1px solid color-mix(in srgb,var(--amber) 48%,var(--border));border-radius:var(--radius-sm);background:rgb(var(--amber-rgb) / .06)}.comparison li div{display:flex;justify-content:space-between;gap:8px}.comparison li span{color:var(--amber);font:650 var(--text-2xs) var(--mono)}.comparison li p,.comparison li small{overflow-wrap:anywhere}.comparison li p{margin:5px 0;font-size:var(--text-xs)}.comparison li small{color:var(--muted)}
  @media(max-width:760px){
    .case-handoff{grid-template-columns:minmax(0,1fr)}.case-handoff .btn{width:100%}.case-status,.case-link{grid-column:1}
  }
</style>
