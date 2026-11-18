<script lang="ts">
  import { onDestroy } from 'svelte';
  import { SELECTED_PROOF_FILES, type SelectedProofKind } from '../../../../packages/evidence/selected-proof-input.mts';
  import { runSelectedProofWorker } from '#lib/retained-review-worker.ts';
  import type { SelectedProofResult } from '#lib/retained-review-worker-model.ts';
  import { tokenLabel } from '../../../../packages/analysis/display-label.mts';
  import { downloadLocalFile } from '#lib/download-local-file.ts';
  let kind = $state<SelectedProofKind>('ct'), files = $state.raw<Record<string, File[]>>({});
  let policy = $state(''), nonce = $state(''), busy = $state(false), message = $state('');
  let report = $state.raw<SelectedProofResult | null>(null);
  let controller: AbortController | null = null, generation = 0;
  let form: HTMLFormElement;
  const id = $props.id();
  const definitions = $derived(SELECTED_PROOF_FILES[kind]);
  function clear() { generation++; controller?.abort(); controller = null; busy = false; report = null; message = ''; }
  function reset() { clear(); files = {}; policy = nonce = ''; form?.reset(); }
  onDestroy(clear);
  function select(event: Event, field: (typeof definitions)[number]) {
    clear();
    const input = event.currentTarget as HTMLInputElement, selected = Array.from(input.files ?? []);
    if (selected.length > field.maximumFiles || selected.some(file => file.size < 1 || file.size > field.maximumBytes)) {
      message = `Select up to ${field.maximumFiles} non-empty file${field.maximumFiles === 1 ? '' : 's'}, each no larger than ${field.maximumBytes.toLocaleString('en-AU')} bytes.`;
      files = { ...files, [field.id]: [] }; input.value = ''; return;
    }
    files = { ...files, [field.id]: selected };
  }
  async function review(event: SubmitEvent) {
    event.preventDefault(); if (busy) return; clear();
    const current = ++generation, abort = new AbortController(); controller = abort; busy = true;
    try {
      const next = await runSelectedProofWorker({ kind: 'proof', proofKind: kind, files, fields: { policy, nonce }, evaluatedAt: new Date().toISOString() }, abort.signal);
      if (current === generation && !abort.signal.aborted) report = next;
    } catch { if (current === generation && !abort.signal.aborted) message = 'The selected proof could not be reviewed. Check the required files, formats and trust selections.'; }
    finally { if (current === generation) { busy = false; controller = null; } }
  }
</script>

<details class="proof-review compact-disclosure">
  <summary>Review a certificate-log proof or timestamp token offline</summary>
  <div class="body">
    <p>Choose supplied proof material and your trust basis. Files are processed in one cancellable local worker; no log, authority or revocation source is contacted.</p>
    <label>Proof family<select bind:value={kind} onchange={reset} disabled={busy}><option value="ct">Certificate-log inclusion (RFC 6962 v1)</option><option value="timestamp">Timestamp token (RFC 3161)</option></select></label>
    <form bind:this={form} onsubmit={review} aria-label="Selected proof files">
      {#each definitions as field (field.id)}<label>{field.label}<small>Up to {field.maximumFiles > 1 ? `${field.maximumFiles} files, ` : ''}{field.maximumBytes.toLocaleString('en-AU')} bytes each</small><input type="file" multiple={field.maximumFiles > 1} onchange={event => select(event, field)} disabled={busy} required={!field.optional} /></label>{/each}
      {#if kind === 'timestamp'}<label>Expected policy OID<input bind:value={policy} maxlength="200" oninput={clear} required disabled={busy} autocomplete="off" /></label><label>Expected nonce hex (optional)<input bind:value={nonce} maxlength="80" oninput={clear} disabled={busy} autocomplete="off" /></label>{/if}
      <div class="actions"><button type="submit" class="btn" disabled={busy || definitions.some(field => !field.optional && !files[field.id]?.length)}>{busy ? 'Reviewing files…' : 'Review selected proof'}</button>{#if busy}<button type="button" class="btn" onclick={clear}>Cancel proof review</button>{:else}<button type="button" class="btn" onclick={reset}>Clear proof files</button>{/if}</div>
    </form>
    {#if message}<p role="alert">{message}</p>{/if}
    {#if report}<section aria-labelledby={`${id}-result`}>
      <h3 id={`${id}-result`}>{report.state === 'checks_passed' ? 'Supported proof checks passed' : 'Proof checks need review'}</h3>
      <dl>{#each report.checks as check (check.id)}<div><dt>{'label' in check ? check.label : tokenLabel(check.id)}</dt><dd><strong>{tokenLabel(check.state)}</strong><span>{check.detail}</span></dd></div>{/each}</dl>
      <button type="button" class="btn" onclick={() => { if (report) downloadLocalFile(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `${kind}-proof-review.json`); }}>Download proof review</button>
      <details><summary>Trust scope and file digests</summary><ul>{#each report.limitations as limitation}<li>{limitation}</li>{/each}</ul>{#if 'leaf' in report}<p>Leaf SHA-256 <code>{report.leaf.digestSha256}</code></p><p>Selected log key SHA-256 <code>{report.selectedLogKeySha256}</code></p>{:else}<p>Artefact SHA-256 <code>{report.artifact.digestSha256}</code></p><p>Token SHA-256 <code>{report.tokenSha256}</code></p>{/if}</details>
    </section>{/if}
  </div>
</details>

<style>
  .proof-review{margin-top:16px;min-width:0;border-top:1px solid var(--border);padding-top:12px}.body{display:grid;gap:14px;min-width:0;padding-top:12px}p,li{font-size:var(--text-xs);line-height:1.6}p{margin:0;color:var(--muted)}form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}label{display:grid;gap:6px;min-width:0;font-size:var(--text-sm);font-weight:650}small{font-size:var(--text-xs);font-weight:400;color:var(--muted)}input,select{max-width:100%;min-width:0}input[type=file]{font-size:var(--text-xs)}.actions{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px}section{display:grid;gap:12px;min-width:0}h3{margin:0;font-size:var(--text-md)}dl{margin:0;display:grid;gap:12px}dl>div{border-top:1px solid var(--border);padding-top:10px;min-width:0}dt{font-size:var(--text-sm);font-weight:650}dd{display:grid;grid-template-columns:8rem minmax(0,1fr);gap:12px;margin:6px 0 0;font-size:var(--text-xs);line-height:1.6}code{overflow-wrap:anywhere;white-space:normal}[role=alert]{color:var(--amber)}@media(max-width:640px){form,dd{grid-template-columns:minmax(0,1fr)}dd{gap:4px}}
</style>
