<script lang="ts">
  import { buildBulkCollectionPreflight } from '$lib/analysis/collection-preflight.ts';
  import CollectionPreflight from '$lib/components/CollectionPreflight.svelte';
  import type {
    BulkPacing,
    BulkPacingOption,
    BulkProgressEstimate,
    BulkProgressOutcomes,
  } from '$lib/analysis/bulk-pacing.ts';

  type ScanMode = 'fast' | 'deep';

  let {
    lookupDisabledReason,
    scanLimitations,
    profileName,
    handoffCount,
    handoffSource,
    input,
    setInput,
    mode,
    setMode,
    pacing,
    setPacing,
    pacingOptions,
    concurrency,
    progress,
    outcomes,
    running,
    paused,
    entryCount,
    queryLimit,
    duplicateCount,
    importDomainFile,
    start,
    togglePause,
    cancel,
    completed,
    total,
    status,
  }: {
    lookupDisabledReason: string;
    scanLimitations: string[];
    profileName: string;
    handoffCount: number;
    handoffSource: string;
    input: string;
    setInput: (value: string) => void;
    mode: ScanMode;
    setMode: (value: ScanMode) => void;
    pacing: BulkPacing;
    setPacing: (value: BulkPacing) => void;
    pacingOptions: readonly BulkPacingOption[];
    concurrency: number;
    progress: BulkProgressEstimate;
    outcomes: BulkProgressOutcomes;
    running: boolean;
    paused: boolean;
    entryCount: number;
    queryLimit: number;
    duplicateCount: number;
    importDomainFile: (event: Event) => void | Promise<void>;
    start: () => void | Promise<void>;
    togglePause: () => void;
    cancel: () => void;
    completed: number;
    total: number;
    status: string;
  } = $props();
  const preflight = $derived(buildBulkCollectionPreflight({
    mode,
    targetCount: entryCount,
    concurrency,
    pacingLabel: pacingOptions.find((option) => option.id === pacing)?.detail ?? 'Bounded request pacing',
    disabledSourceIds: scanLimitations.map((item) => item.replaceAll(' ', '_')),
  }));
</script>

<section class="queue card">
  {#if lookupDisabledReason}<p class="feature-disabled" role="note">{lookupDisabledReason}</p>{/if}
  {#if !lookupDisabledReason && scanLimitations.length}<p class="feature-disabled" role="note">Some {mode} scan sources are disabled by deployment policy: {scanLimitations.join(', ')}. {mode === 'deep' ? 'Saved evidence will not claim a complete deep scan.' : 'Results will identify unevaluated evidence.'}</p>{/if}
  {#if profileName}<p class="profile-context">Active profile: <strong>{profileName}</strong>. Official, partner, and allowlisted domains remain visible but are excluded from high-risk triage and Monitor saves.</p>{/if}
  {#if handoffSource}<p class="handoff">Loaded {handoffCount} candidate{handoffCount === 1 ? '' : 's'} from {handoffSource}.</p>{/if}
  <div class="queue-label"><label class="queue-title" for="domains">Domains</label><label class="btn small file-btn">Import CSV or text<input type="file" accept=".csv,.txt,text/csv,text/plain" onchange={importDomainFile} disabled={running}></label></div>
  <textarea id="domains" value={input} oninput={(event) => setInput(event.currentTarget.value)} disabled={running} placeholder="example.com&#10;example.net"></textarea>
  <p class="input-help">Paste newline, comma, semicolon, or tab-separated entries. CSV files may include a named domain column. One {mode === 'deep' ? 'Deep' : 'Fast'} job is limited to {queryLimit} unique domains.{#if duplicateCount} {duplicateCount} duplicate{duplicateCount === 1 ? '' : 's'} removed.{/if}</p>
  {#if entryCount > queryLimit}<p class="input-limit" role="alert">Remove {entryCount - queryLimit} domain{entryCount - queryLimit === 1 ? '' : 's'} before starting this {mode === 'deep' ? 'Deep' : 'Fast'} job.</p>{/if}
  <div class="queue-actions">
    <label class="field">Scan mode<select value={mode} onchange={(event) => setMode(event.currentTarget.value as ScanMode)} disabled={running}><option value="fast">Fast · registration</option><option value="deep">Deep · compact web and mail triage</option></select></label>
    <label class="field">Request pacing<select value={pacing} onchange={(event) => setPacing(event.currentTarget.value as BulkPacing)} disabled={running}>{#each pacingOptions as option}<option value={option.id}>{option.label}</option>{/each}</select></label>
    <button class="primary" onclick={start} disabled={running || !input.trim() || entryCount > queryLimit || Boolean(lookupDisabledReason)}>{entryCount ? `Scan ${entryCount} domain${entryCount === 1 ? '' : 's'}` : 'Scan domains'}</button>
    {#if running}<button class="btn" onclick={togglePause}>{paused ? 'Resume' : 'Pause'}</button><button class="btn danger" onclick={cancel}>Cancel</button>{/if}
  </div>
  <p class="mode-help">{mode === 'deep' ? 'Bulk Deep collects compact WHOIS, DNS, website, TLS, mail, and bounded technology signals for triage and comparison. Open a domain in Lookup for the complete source-level evidence and optional enrichments.' : 'Fast keeps the lower-request registration-first contract and omits WHOIS, website, TLS, and deep enrichment.'} {pacingOptions.find((option) => option.id === pacing)?.detail ?? 'Bounded request pacing'}; at most {concurrency} {concurrency === 1 ? 'lookup runs' : 'lookups run'} in parallel.</p>
  <CollectionPreflight {preflight} />
  {#if running || total}<div class="progress" role="progressbar" aria-label="Bulk scan progress" aria-valuemin="0" aria-valuemax={total} aria-valuenow={completed}><span style:width={`${total ? completed / total * 100 : 0}%`}></span></div>{/if}
  {#if running || total}<p class="progress-detail">{progress.completed} of {progress.total} settled · {progress.percent}% · {progress.label}</p>{/if}
  {#if running || total}
    <dl class="outcomes" aria-label="Settled scan outcomes">
      <div><dt>Complete</dt><dd>{outcomes.complete}</dd></div>
      <div class:attention={outcomes.limited > 0}><dt>Limited</dt><dd>{outcomes.limited}</dd></div>
      <div class:error={outcomes.failed > 0}><dt>Failed</dt><dd>{outcomes.failed}</dd></div>
      <div><dt>Pending</dt><dd>{outcomes.pending}</dd></div>
    </dl>
  {/if}
  <p class="status" role="status" aria-live="polite">{status}</p>
</section>

<style>
  .queue{padding:var(--card-pad)}
  .profile-context{margin-top:0;padding:10px 12px;border:1px solid rgb(var(--accent2-rgb) / .3);border-radius:var(--radius-md);background:rgb(var(--accent2-rgb) / .04);color:var(--muted);font-size:var(--text-xs)}
  .profile-context strong{color:var(--text)}
  .handoff{margin-top:0;color:var(--accent);font-size:var(--text-sm)}
  .queue-label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px}
  .queue-title{font:700 var(--text-sm) var(--mono)}
  .input-help{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .input-limit{margin:8px 0 0;color:var(--danger);font-size:var(--text-xs)}
  textarea{width:100%;min-height:150px;padding:12px;background:rgb(var(--bg-rgb) / .78);font-family:var(--mono);font-size:var(--text-sm)}
  .queue-actions{display:flex;gap:9px;align-items:end;margin-top:12px}
  .queue-actions .field:first-child{margin-right:auto}
  .queue-actions select{min-width:220px;min-height:42px}
  .progress{height:6px;margin-top:16px;overflow:hidden;border-radius:99px;background:var(--border)}
  .progress span{display:block;height:100%;background:var(--accent);transition:width .15s}
  .status{margin-bottom:0}
  .progress-detail{margin:7px 0 0;color:var(--muted);font:600 var(--text-xs) var(--mono)}
  .outcomes{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0 0}
  .outcomes div{display:flex;gap:5px;align-items:baseline;padding:4px 7px;border:1px solid var(--border);border-radius:99px;background:var(--panel)}
  .outcomes dt{color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .outcomes dd{margin:0;color:var(--text);font:700 var(--text-xs) var(--mono)}
  .outcomes div.attention{border-color:color-mix(in srgb,var(--amber) 42%,var(--border))}
  .outcomes div.attention dd{color:var(--amber)}
  .outcomes div.error{border-color:color-mix(in srgb,var(--danger) 42%,var(--border))}
  .outcomes div.error dd{color:var(--danger)}
  .mode-help{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  @media(max-width:700px){
    .queue-label{align-items:flex-start;flex-direction:column;gap:8px}
    .queue-actions{align-items:stretch;flex-direction:column}
    .queue-actions .field{margin:0}
    .queue-actions select{width:100%;min-width:0}
  }
</style>
