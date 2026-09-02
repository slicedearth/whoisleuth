<script lang="ts">
  import { evidenceStatusChipClass } from '$lib/analysis/evidence-status-tone.ts';
  import { availabilityStatusDisplay } from '$lib/analysis/availability-status-display.ts';
  import {
    buildLookupReplayCaseEvidence,
    LOOKUP_EVIDENCE_REPLAY_MAX_BYTES,
    parseLookupEvidenceReplay,
    type LookupEvidenceReplay,
  } from '$lib/analysis/lookup-evidence-replay.ts';
  import { buildLookupReplayCheckpointFacts } from '$lib/analysis/case-evidence-checkpoint.ts';
  import { LookupCaseController } from '$lib/controllers/lookup-case-controller.ts';
  import type { CaseRecord, CaseTransitionExpectation } from '$lib/cases';
  import LookupAssetGraph from '$lib/components/LookupAssetGraph.svelte';
  import LookupEvidenceCheckpoint from '$lib/components/LookupEvidenceCheckpoint.svelte';
  import LookupMetadataDisclosure from '$lib/components/LookupMetadataDisclosure.svelte';
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
  let caseStatus = $state('');
  let caseBusy = $state(false);
  const replayAvailability = $derived(availabilityStatusDisplay(replay?.availability));
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
      const existing = next.caseDomain
        ? await caseController.refresh(next.caseDomain)
        : { record: null, status: '' };
      if (generation !== replayGeneration || replay !== next) return;
      caseRecord = existing.record;
      caseStatus = existing.status;
      statusState = 'success';
      status = `Loaded ${file.name} locally${next.digestVerified ? ' and verified its checksum' : ''}. No source was contacted.`;
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
    );
    if (generation === replayGeneration && replay === current) {
      caseRecord = result.record;
      caseStatus = result.status;
      caseBusy = false;
    }
  }

  async function saveReplayCheckpoint(
    fields: string[],
    expectations: Readonly<Record<string, CaseTransitionExpectation>> = {},
  ) {
    if (!replay || !caseRecord || caseBusy) return;
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
    }
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
        <header>
          <div>
            <p class="eyebrow">Offline evidence</p>
            <h2 id="replay-title">{replay.target}</h2>
            <p>Exported {replay.exportedAt} · {replay.targetType} · schema {replay.schemaVersion}{replay.generatorVersion ? ` · WHOISleuth ${replay.generatorVersion}` : ''}</p>
          </div>
          <span class="chip {replayAvailability.className}">{replayAvailability.label}</span>
        </header>

        <div class="digest">
          <small>File SHA-256 · {replay.digestVerified ? 'verified against supplied checksum' : 'calculated locally; no expected checksum supplied'}</small>
          <code>{replay.digestSha256}</code>
        </div>

        {#if replay.caseDomain}
          <section class="case-handoff" aria-labelledby="replay-case-title">
            <div>
              <p class="eyebrow">Browser-local handoff</p>
              <h3 id="replay-case-title">Continue this historical review in a Case</h3>
              <p class="note">The Case uses {replay.caseDomain} as its registrable identity, retains {replay.target} as the observed hostname, and preserves the export time and imported provenance. This action does not refresh evidence or contact a source.</p>
            </div>
            <button class="btn" type="button" disabled={caseBusy} onclick={() => void saveReplayToCase()}>{caseBusy ? 'Saving…' : caseRecord ? 'Add replay evidence to Case' : 'Create browser-local Case'}</button>
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

        <div class="source-grid" role="group" aria-label="Replayed source health">
          {#each replay.sources as source (source.id)}
            <article>
              <strong>{source.label}</strong>
              <span class="chip {evidenceStatusChipClass(source.state, source.complete === null ? {} : { complete: source.complete })}">{source.state}</span>
              <small>{source.observedAt ? `Observed ${source.observedAt}` : 'Observation time not reported'}</small>
            </article>
          {/each}
        </div>

        {#if replay.facts.length}
          <h3>Normalised facts</h3>
          <dl>
            {#each replay.facts as fact}
              <div><dt>{fact.label}</dt><dd>{fact.value}<small>{fact.source} · {fact.sourceState}{fact.sourceComplete === false ? ' · incomplete' : ''}</small></dd></div>
            {/each}
          </dl>
        {/if}

        {#if replay.pagePublicationMetadata || replay.httpDeliveryMetadata}
          <section class="retained-homepage-metadata" aria-labelledby="replay-homepage-metadata-title">
            <h3 id="replay-homepage-metadata-title">Retained homepage metadata</h3>
            <p class="note">These bounded values came from the exported observation. No source was contacted during replay.</p>
            {#if replay.pagePublicationMetadata}<LookupMetadataDisclosure label="Publication metadata" metadata={replay.pagePublicationMetadata} />{/if}
            {#if replay.httpDeliveryMetadata}<LookupMetadataDisclosure label="Delivery and cache metadata" metadata={replay.httpDeliveryMetadata} />{/if}
          </section>
        {/if}

        {#if replay.contradictions.length}
          <aside class="contradictions" data-tone="danger">
            <strong>Contradictory registration evidence</strong>
            <ul>{#each replay.contradictions as contradiction}<li>{contradiction}</li>{/each}</ul>
          </aside>
        {/if}

        <section class="brief" aria-labelledby="replay-brief-title">
          <h3 id="replay-brief-title">Historical review brief</h3>
          <div>
            <article>
              <strong>Retained normalised facts</strong>
              <p>{replay.facts.length} normalised fact{replay.facts.length === 1 ? '' : 's'} retained with source labels.</p>
            </article>
            <article>
              <strong>Unknown or incomplete</strong>
              {#if replay.unknowns.length}<ul>{#each replay.unknowns as unknown}<li>{unknown}</li>{/each}</ul>{:else}<p>No incomplete replay source was identified.</p>{/if}
            </article>
            <article>
              <strong>Next manual steps</strong>
              <ol>{#each replay.recommendedSteps as step}<li>{step}</li>{/each}</ol>
            </article>
          </div>
        </section>

        <LookupAssetGraph graph={replay.graph} headingId="replay-asset-graph-title" evidenceLinks={false} />

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

        <details class="limits">
          <summary>Replay limitations</summary>
          <ul>{#each replay.limitations as limitation}<li>{limitation}</li>{/each}</ul>
        </details>
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
  .replay-result>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  h2{margin:2px 0 0;font-size:var(--text-lg);overflow-wrap:anywhere}
  header p:not(.eyebrow){margin:5px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .digest{display:grid;gap:4px;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .digest small{color:var(--muted)}
  .digest code{font-size:var(--text-2xs);overflow-wrap:anywhere}
  .case-handoff{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px 14px;padding:11px;border:1px solid color-mix(in srgb,var(--accent2) 38%,var(--border));border-radius:var(--radius-sm);background:var(--panel-raised)}
  .case-handoff h3,.case-handoff p{margin:0}.case-handoff .note{margin-top:5px}.case-status{grid-column:1/-1;margin:0;color:var(--muted);font-size:var(--text-xs)}.case-status:empty{display:none}.case-link{grid-column:1/-1;width:max-content;font:680 var(--text-xs) var(--mono)}
  .source-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
  .source-grid article{display:grid;gap:3px;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .source-grid strong{font-size:var(--text-xs)}
  .source-grid span{width:max-content;font-size:var(--text-2xs);text-transform:capitalize}
  .source-grid small{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  h3{margin:2px 0 -3px;font-size:var(--text-sm)}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0}
  dl div{display:grid;gap:3px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  dt{color:var(--muted);font-size:var(--text-2xs)}
  dd{margin:0;font-size:var(--text-xs);overflow-wrap:anywhere}
  dd small{display:block;margin-top:3px;color:var(--muted)}
  aside{padding:10px;border:1px solid color-mix(in srgb,var(--danger) 52%,var(--border));border-radius:var(--radius-sm);background:rgb(var(--danger-rgb) / .08)}
  aside ul,.limits ul{margin:7px 0 0;padding-left:18px;font-size:var(--text-xs);line-height:1.5}
  .brief{display:grid;gap:8px}
  .retained-homepage-metadata{display:grid;gap:8px;min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .brief>div{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
  .brief article{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .brief strong{font-size:var(--text-xs)}
  .brief p,.brief ul,.brief ol{margin:5px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .brief ul,.brief ol{padding-left:17px}
  .limits{border-top:1px solid var(--border)}
  .comparison{display:grid;gap:8px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.comparison .picker{width:max-content;margin:0}.comparison-counts{display:flex;flex-wrap:wrap;gap:6px}.comparison-counts span{padding:6px 8px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font-size:var(--text-2xs)}.comparison ol{display:grid;gap:6px;margin:0;padding:0;list-style:none}.comparison li{min-width:0;padding:8px;border:1px solid color-mix(in srgb,var(--amber) 48%,var(--border));border-radius:var(--radius-sm);background:rgb(var(--amber-rgb) / .06)}.comparison li div{display:flex;justify-content:space-between;gap:8px}.comparison li span{color:var(--amber);font:650 var(--text-2xs) var(--mono)}.comparison li p,.comparison li small{overflow-wrap:anywhere}.comparison li p{margin:5px 0;font-size:var(--text-xs)}.comparison li small{color:var(--muted)}
  .limits>summary{padding:10px 0;font:680 var(--text-xs) var(--mono);cursor:pointer}
  @media(max-width:760px){
    .source-grid,dl,.brief>div{grid-template-columns:minmax(0,1fr)}
    .replay-result>header{display:grid}
    .case-handoff{grid-template-columns:minmax(0,1fr)}.case-handoff .btn{width:100%}.case-status,.case-link{grid-column:1}
  }
</style>
