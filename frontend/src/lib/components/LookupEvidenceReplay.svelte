<script lang="ts">
  import {
    LOOKUP_EVIDENCE_REPLAY_MAX_BYTES,
    parseLookupEvidenceReplay,
    type LookupEvidenceReplay,
  } from '$lib/analysis/lookup-evidence-replay.ts';

  let replay = $state<LookupEvidenceReplay | null>(null);
  let status = $state('');
  let loading = $state(false);

  async function load(event: Event) {
    const control = event.currentTarget as HTMLInputElement;
    const file = control.files?.[0];
    if (!file) return;
    loading = true;
    status = '';
    replay = null;
    try {
      if (file.size > LOOKUP_EVIDENCE_REPLAY_MAX_BYTES) {
        throw new Error('Lookup evidence replay files are limited to 5 MB.');
      }
      replay = await parseLookupEvidenceReplay(await file.text());
      status = `Loaded ${file.name} locally. No source was contacted.`;
    } catch (cause) {
      status = cause instanceof Error ? cause.message : 'The evidence file could not be replayed.';
    } finally {
      loading = false;
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
    <p class="note">The file stays in this browser tab. Replay validates the current schema, records the file digest, and renders bounded normalized facts only.</p>
    {#if status}<p class:loaded={Boolean(replay)} aria-live="polite">{status}</p>{/if}

    {#if replay}
      <section class="replay-result" aria-labelledby="replay-title">
        <header>
          <div>
            <p class="eyebrow">Offline evidence</p>
            <h2 id="replay-title">{replay.target}</h2>
            <p>Exported {replay.exportedAt} · {replay.targetType} · schema {replay.schemaVersion}</p>
          </div>
          <span class="chip info">{replay.availability}</span>
        </header>

        <div class="digest">
          <small>File SHA-256</small>
          <code>{replay.digestSha256}</code>
        </div>

        <div class="source-grid" aria-label="Replayed source health">
          {#each replay.sources as source (source.id)}
            <article>
              <strong>{source.label}</strong>
              <span>{source.state}</span>
              <small>{source.observedAt ? `Observed ${source.observedAt}` : 'Observation time not reported'}</small>
            </article>
          {/each}
        </div>

        {#if replay.facts.length}
          <h3>Normalized facts</h3>
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
  .note{max-width:760px;margin:9px 0}
  .loaded{color:var(--good)}
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
  .source-grid span{color:var(--cyan);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .source-grid small{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  h3{margin:2px 0 -3px;font-size:var(--text-sm)}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0}
  dl div{display:grid;gap:3px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  dt{color:var(--muted);font-size:var(--text-2xs)}
  dd{margin:0;font-size:var(--text-xs);overflow-wrap:anywhere}
  dd small{display:block;margin-top:3px;color:var(--muted)}
  aside{padding:10px;border:1px solid color-mix(in srgb,var(--warn) 42%,var(--border));border-radius:var(--radius-sm);background:var(--warn-bg)}
  aside ul,.limits ul{margin:7px 0 0;padding-left:18px;font-size:var(--text-xs);line-height:1.5}
  .limits{border-top:1px solid var(--border)}
  .limits>summary{padding:10px 0;font:680 var(--text-xs) var(--mono);cursor:pointer}
  @media(max-width:760px){
    .source-grid,dl{grid-template-columns:minmax(0,1fr)}
    .replay-result>header{display:grid}
  }
</style>
