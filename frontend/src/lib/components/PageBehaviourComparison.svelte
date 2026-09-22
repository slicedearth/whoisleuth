<script lang="ts">
  import { onDestroy } from 'svelte';
  import { comparePageBehaviour } from '../../../../packages/investigation/page-behaviour.mts';
  import { compareObservationContexts } from '../../../../packages/comparison/capture-context.mts';
  import type { CaptureManifestContext } from '../../../../packages/interchange/web-capture-import.mts';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { sha256ArtifactDigestV2 } from '../../../../packages/evidence/artifact-integrity.mts';
  import Pagination from './Pagination.svelte';
  let { left, right, caseDomain, persist, mutationBusy }: { left: CaptureManifestContext; right: CaptureManifestContext; caseDomain: string; persist: PersistCaseResponse; mutationBusy: boolean } = $props();
  const result = $derived(comparePageBehaviour(left.pageBehaviour, right.pageBehaviour));
  const context = $derived(compareObservationContexts([left, right]));
  const changes = $derived([...result.added.map(row => ({ ...row, change: 'Added observation' })), ...result.notReobserved.map(row => ({ ...row, change: 'Not re-observed' }))]);
  let page = $state(1), reason = $state(''), authorised = $state(false), saving = $state(false), message = $state('');
  let active = true;
  onDestroy(() => { active = false; });
  async function recordExpected(event: SubmitEvent) {
    event.preventDefault();
    if (!authorised || !reason.trim() || saving || mutationBusy) return;
    saving = true; message = '';
    const explanation = reason.trim();
    try {
      const digest = await sha256ArtifactDigestV2({ left, right });
      if (!active || mutationBusy) return;
      if (await persist({ assertion: { kind: 'hypothesis', state: 'open', statement: `Expected page-dependency change declared for ${caseDomain}.`, rationale: `${explanation}\nAnalyst declares authority to review this change. Selected observation digest (sorted-json-v2): ${digest}.`, evidenceRelations: [] } }, 'Recorded the expected page-dependency change.')) { reason = ''; authorised = false; message = 'Expected change recorded in the Case assessment. Original capture files remain separately selected for retention.'; }
    } catch { message = 'The expected change could not be recorded.'; }
    finally { saving = false; }
  }
</script>

<section class="page-comparison" aria-label="Page dependency comparison">
  <h5>Page dependency comparison · {result.state}</h5>
  <p>{left.domain} ({left.observedAt ?? 'time unknown'}) → {right.domain} ({right.observedAt ?? 'time unknown'})</p>
  {#if result.state === 'unavailable'}<p>Both captures need page observations to compare dependencies.</p>{:else}
    <p>{result.added.length} added observation groups · {result.notReobserved.length} not re-observed. {result.navigationChanged ? 'The navigation-origin sequence differs.' : 'The recorded navigation-origin sequence matches.'}</p>
    {#if result.clipboardWriteDelta}<p>Blocked Clipboard API attempts changed by {result.clipboardWriteDelta}.</p>{/if}
    <ol>{#each changes.slice((page - 1) * 12, page * 12) as row}<li><strong>{row.change} × {row.count}</strong><span>{row.label}</span>{#if row.origin}<span>{row.origin}</span>{/if}{#if row.digest}<code>{row.digest}</code>{/if}</li>{/each}</ol>
    <Pagination currentPage={page} pageCount={Math.ceil(changes.length / 12)} setPage={next => page = next} ariaLabel="Page dependency changes" />
  {/if}
  <details><summary>Comparison conditions</summary><dl>{#each context.rows as row}<div><dt>{row.label} · {row.state}</dt><dd>{row.values.map(value => value ?? 'Not declared').join(' → ')}</dd></div>{/each}</dl><p>Different conditions can explain differences. Not re-observed does not mean removed. Script hashes compare admitted bytes; changes do not establish compromise or authorisation.</p></details>
  {#if left.domain === caseDomain && right.domain === caseDomain && result.state !== 'unavailable'}
    <details><summary>Record an expected change</summary><form onsubmit={recordExpected}><fieldset disabled={saving || mutationBusy}>
      <label><input type="checkbox" required bind:checked={authorised}> I own or am authorised to review this page and recognise the change.</label>
      <label>Reason or change reference<textarea required maxlength="1000" rows="3" bind:value={reason}></textarea></label>
      <button class="btn" type="submit">{saving ? 'Recording…' : 'Record expected page change'}</button>
    </fieldset></form></details>
  {/if}
  <p role="status">{message}</p>
</section>

<style>
  .page-comparison{display:grid;gap:10px;min-width:0;border-top:1px solid var(--border);padding-top:12px}h5{font-size:var(--text-sm);margin:0}p,li,label,dl{font-size:var(--text-xs);line-height:1.6;margin:0;overflow-wrap:anywhere}ol{display:grid;gap:10px;margin:0;padding-left:22px}li span,li code{display:block}code{font-size:var(--text-2xs);white-space:normal}summary{cursor:pointer;min-height:40px;padding-block:10px}dl{display:grid;gap:10px}dd{margin:0;color:var(--muted)}fieldset{display:grid;gap:10px;padding:0;border:0;min-width:0}label{display:block}textarea{display:block;min-width:0;width:100%}button{justify-self:start;max-width:100%;white-space:normal}[role=status]:empty{display:none}
</style>
