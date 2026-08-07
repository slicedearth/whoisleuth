<script lang="ts">
  import {
    LOOKUP_EVIDENCE_REPLAY_MAX_BYTES,
    parseLookupEvidenceReplay,
    type LookupEvidenceReplay,
  } from '$lib/analysis/lookup-evidence-replay.ts';
  import LookupAssetGraph from '$lib/components/LookupAssetGraph.svelte';
  import { buildLookupEvidenceReplayDiff } from '$lib/analysis/lookup-evidence-replay-diff.ts';

  let replay = $state<LookupEvidenceReplay | null>(null);
  let status = $state('');
  let loading = $state(false);
  let expectedSha256 = $state('');
  let comparison = $state<ReturnType<typeof buildLookupEvidenceReplayDiff> | null>(null);
  let comparisonStatus = $state('');

  async function load(event: Event) {
    const control = event.currentTarget as HTMLInputElement;
    const file = control.files?.[0];
    if (!file) return;
    loading = true;
    status = '';
    replay = null;
    comparison = null;
    try {
      if (file.size > LOOKUP_EVIDENCE_REPLAY_MAX_BYTES) {
        throw new Error('Lookup evidence replay files are limited to 5 MB.');
      }
      const checksum = expectedSha256.trim();
      replay = await parseLookupEvidenceReplay(
        await file.text(),
        checksum ? { expectedSha256: checksum } : {},
      );
      status = `Loaded ${file.name} locally${replay.digestVerified ? ' and verified its checksum' : ''}. No source was contacted.`;
    } catch (cause) {
      status = cause instanceof Error ? cause.message : 'The evidence file could not be replayed.';
    } finally {
      loading = false;
      control.value = '';
    }
  }

  async function loadComparison(event: Event) {
    const control = event.currentTarget as HTMLInputElement;
    const file = control.files?.[0];
    if (!file || !replay) return;
    comparisonStatus = '';
    try {
      if (file.size > LOOKUP_EVIDENCE_REPLAY_MAX_BYTES) throw new Error('Lookup evidence replay files are limited to 5 MB.');
      const second = await parseLookupEvidenceReplay(await file.text());
      comparison = buildLookupEvidenceReplayDiff(replay, second);
      comparisonStatus = `Compared ${file.name} locally. No source was contacted.`;
    } catch (cause) {
      comparison = null;
      comparisonStatus = cause instanceof Error ? cause.message : 'The second evidence file could not be compared.';
    } finally {
      control.value = '';
    }
  }
</script>

<details class="replay card">
  <summary>
    <span>
      <strong>Replay exported evidence</strong>
      <small>Review a current WHOISleuth Lookup evidence JSON file without contacting a source.</small>
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
    <p class="replay-status" class:loaded={Boolean(replay)} role="status" aria-live="polite" aria-atomic="true">{status}</p>

    {#if replay}
      <section class="replay-result" aria-labelledby="replay-title">
        <header>
          <div>
            <p class="eyebrow">Offline evidence</p>
            <h2 id="replay-title">{replay.target}</h2>
            <p>Exported {replay.exportedAt} · {replay.targetType} · schema {replay.schemaVersion}{replay.generatorVersion ? ` · WHOISleuth ${replay.generatorVersion}` : ''}</p>
          </div>
          <span class="chip info">{replay.availability}</span>
        </header>

        <div class="digest">
          <small>File SHA-256 · {replay.digestVerified ? 'verified against supplied checksum' : 'calculated locally; no expected checksum supplied'}</small>
          <code>{replay.digestSha256}</code>
        </div>

        <div class="source-grid" role="group" aria-label="Replayed source health">
          {#each replay.sources as source (source.id)}
            <article>
              <strong>{source.label}</strong>
              <span>{source.state}</span>
              <small>{source.observedAt ? `Observed ${source.observedAt}` : 'Observation time not reported'}</small>
            </article>
          {/each}
        </div>

        {#if replay.facts.length}
          <h3>Normalised facts</h3>
          <dl>
            {#each replay.facts as fact}
              <div><dt>{fact.label}</dt><dd>{fact.value}<small>{fact.source}</small></dd></div>
            {/each}
          </dl>
        {/if}

        {#if replay.contradictions.length}
          <aside>
            <strong>Contradictory registration evidence</strong>
            <ul>{#each replay.contradictions as contradiction}<li>{contradiction}</li>{/each}</ul>
          </aside>
        {/if}

        <section class="brief" aria-labelledby="replay-brief-title">
          <h3 id="replay-brief-title">Historical review brief</h3>
          <div>
            <article>
              <strong>Verified export facts</strong>
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
          <label class="picker"><span>Choose second evidence JSON</span><input type="file" accept="application/json,.json" onchange={loadComparison} /></label>
          <p class="comparison-status" role="status" aria-live="polite" aria-atomic="true">{comparisonStatus}</p>
          {#if comparison}
            <div class="comparison-counts"><span><strong>{comparison.counts.observedChanges}</strong> observed</span><span><strong>{comparison.counts.collectionDifferences}</strong> collection</span><span><strong>{comparison.counts.interpretationDifferences}</strong> interpretation</span></div>
            <ol>{#each comparison.rows.filter((item) => item.kind !== 'unchanged') as row}<li><div><strong>{row.label}</strong><span>{row.kind.replaceAll('_', ' ')}</span></div><p>{row.left} → {row.right}</p><small>{row.explanation}</small></li>{/each}</ol>
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
  .loaded{color:var(--success)}
  .replay-status:empty,.comparison-status:empty{min-height:0;margin:0}
  .replay-result{display:grid;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
  .replay-result>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  h2{margin:2px 0 0;font-size:var(--text-lg);overflow-wrap:anywhere}
  header p:not(.eyebrow){margin:5px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .digest{display:grid;gap:4px;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .digest small{color:var(--muted)}
  .digest code{font-size:var(--text-2xs);overflow-wrap:anywhere}
  .source-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
  .source-grid article{display:grid;gap:3px;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .source-grid strong{font-size:var(--text-xs)}
  .source-grid span{color:var(--source-network);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .source-grid small{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  h3{margin:2px 0 -3px;font-size:var(--text-sm)}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0}
  dl div{display:grid;gap:3px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  dt{color:var(--muted);font-size:var(--text-2xs)}
  dd{margin:0;font-size:var(--text-xs);overflow-wrap:anywhere}
  dd small{display:block;margin-top:3px;color:var(--muted)}
  aside{padding:10px;border:1px solid color-mix(in srgb,var(--amber) 42%,var(--border));border-radius:var(--radius-sm);background:rgb(var(--amber-rgb) / .08)}
  aside ul,.limits ul{margin:7px 0 0;padding-left:18px;font-size:var(--text-xs);line-height:1.5}
  .brief{display:grid;gap:8px}
  .brief>div{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
  .brief article{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .brief strong{font-size:var(--text-xs)}
  .brief p,.brief ul,.brief ol{margin:5px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .brief ul,.brief ol{padding-left:17px}
  .limits{border-top:1px solid var(--border)}
  .comparison{display:grid;gap:8px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.comparison .picker{width:max-content;margin:0}.comparison-counts{display:flex;flex-wrap:wrap;gap:6px}.comparison-counts span{padding:6px 8px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font-size:var(--text-2xs)}.comparison ol{display:grid;gap:6px;margin:0;padding:0;list-style:none}.comparison li{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.comparison li div{display:flex;justify-content:space-between;gap:8px}.comparison li span{color:var(--source-network);font:650 var(--text-2xs) var(--mono)}.comparison li p,.comparison li small{overflow-wrap:anywhere}.comparison li p{margin:5px 0;font-size:var(--text-xs)}.comparison li small{color:var(--muted)}
  .limits>summary{padding:10px 0;font:680 var(--text-xs) var(--mono);cursor:pointer}
  @media(max-width:760px){
    .source-grid,dl,.brief>div{grid-template-columns:minmax(0,1fr)}
    .replay-result>header{display:grid}
  }
</style>
