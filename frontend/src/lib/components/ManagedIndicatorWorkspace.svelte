<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { downloadLocalFile } from '#lib/download-local-file.ts';
  import { createDraftRevision, restoreSubmittedFocus } from '#lib/controllers/submitted-draft.ts';
  import { buildManagedIndicatorRevision, compareManagedIndicatorRevisions, managedIndicatorState, parseManagedIndicatorJson, readManagedIndicatorSet, MAX_INDICATOR_REVIEW_BASIS, type ManagedIndicatorSet, type ManagedIndicatorChange } from '../../../../packages/interchange/managed-indicator-set.mts';
  import { exportManagedIndicators } from '../../../../packages/interchange/managed-indicator-export.mts';
  import { MAX_MANAGED_INDICATOR_SET_BYTES } from '../../../../packages/contracts/analyst-interchange.mts';

  let { rows, selectedDomains, officialDomains, allowlistedDomains, contextReady }: {
    rows: readonly unknown[]; selectedDomains: readonly string[]; officialDomains: readonly string[];
    allowlistedDomains: readonly string[]; contextReady: boolean;
  } = $props();
  const id = $props.id();
  let baseline = $state<ManagedIndicatorSet | null>(null);
  let incoming = $state<{ manifest: ManagedIndicatorSet; changes: ManagedIndicatorChange[] | null } | null>(null);
  let prepared = $state<Awaited<ReturnType<typeof buildManagedIndicatorRevision>> | null>(null);
  let name = $state('Reviewed domain indicators'), reviewBasis = $state('');
  let expiresAt = $state(new Date(Date.now() + 30 * 86_400_000).toISOString());
  let renewIds = $state<string[]>([]), withdrawIds = $state<string[]>([]), reintroduceDomains = $state<string[]>([]);
  let includeSelected = $state(false), busy = $state(false), status = $state('');
  let selection = 0, destroyed = false;
  let componentRoot = $state<HTMLElement>();
  const draft = createDraftRevision(() => baseline?.revisionId ?? 'new-indicator-set');
  let reviewedAt = $state(new Date().toISOString());
  onDestroy(() => { selection += 1; draft.changed(); destroyed = true; });
  function invalidatePlan() { draft.changed(); prepared = null; }
  $effect(() => { void [rows, selectedDomains, officialDomains, allowlistedDomains, contextReady]; invalidatePlan(); });
  const reintroductions = $derived([...new Set((baseline?.entries ?? []).filter(entry => entry.withdrawal && selectedDomains.includes(entry.domain)).map(entry => entry.domain))]);
  function clearPlan() { invalidatePlan(); renewIds = []; withdrawIds = []; reintroduceDomains = []; reviewBasis = ''; includeSelected = false; }
  async function selectFile(file?: File) {
    const origin = document.activeElement;
    const generation = ++selection;
    incoming = null; invalidatePlan();
    if (!file) return;
    busy = true; status = 'Checking the selected revision…';
    try {
      if (file.size < 1 || file.size > MAX_MANAGED_INDICATOR_SET_BYTES) throw new TypeError('Choose a managed indicator manifest of at most 4 MiB.');
      const manifest = await readManagedIndicatorSet(parseManagedIndicatorJson(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())));
      const changes = baseline?.id === manifest.id && baseline.integrity.digestSha256 !== manifest.integrity.digestSha256
        ? compareManagedIndicatorRevisions(baseline, manifest) : null;
      if (generation !== selection) return;
      incoming = { manifest, changes }; reviewedAt = new Date().toISOString();
      status = 'Content verified. Review the file before using it as the baseline; it has not changed saved work.';
    } catch (cause) { if (generation === selection) status = cause instanceof Error ? cause.message : 'The selected revision could not be read.'; }
    finally { if (generation === selection) { busy = false; await tick(); restoreSubmittedFocus(origin, origin instanceof HTMLElement ? origin : null, componentRoot); } }
  }
  async function useIncoming() {
    if (!incoming) return;
    const origin = document.activeElement;
    baseline = incoming.manifest; name = baseline.name; incoming = null; clearPlan();
    status = 'Using the selected revision in this panel only. Keep its file for the revision history.';
    await tick(); restoreSubmittedFocus(origin, document.getElementById(`${id}-baseline`), componentRoot);
  }
  async function prepare(submitter: HTMLElement | null) {
    if (busy) return;
    const unchanged = draft.capture();
    const origin = document.activeElement;
    busy = true; prepared = null;
    try {
      if (includeSelected && !contextReady) throw new TypeError('Saved review context is unavailable. Existing identities can still be withdrawn or deliberately renewed.');
      const result = await buildManagedIndicatorRevision({ name, basis: reviewBasis, expiresAt,
        ...(baseline ? { previous: $state.snapshot(baseline) } : {}), rows: includeSelected ? $state.snapshot(rows) : [],
        selectedDomains: includeSelected ? [...selectedDomains] : [], officialDomains: [...officialDomains], allowlistedDomains: [...allowlistedDomains],
        renewIds: [...renewIds], withdrawIds: [...withdrawIds], reintroduceDomains: [...reintroduceDomains] });
      if (destroyed) return;
      if (!unchanged()) { status = 'Inputs changed while preparing the revision. Prepare a new preview before downloading.'; return; }
      prepared = result;
      reviewedAt = new Date().toISOString();
      status = `Prepared revision ${prepared.manifest.revision}. Review its ${prepared.changes.length} change${prepared.changes.length === 1 ? '' : 's'} before downloading.`;
    } catch (cause) { if (!destroyed) status = cause instanceof Error ? cause.message : 'The revision could not be prepared.'; }
    finally {
      if (!destroyed) {
        busy = false; await tick();
        restoreSubmittedFocus(origin, origin instanceof HTMLElement ? origin : submitter, componentRoot);
      }
    }
  }
  async function download(format: 'manifest' | 'stix' | 'misp') {
    if (!prepared || busy) return;
    const unchanged = draft.capture();
    const origin = document.activeElement;
    busy = true;
    try {
      const file = await exportManagedIndicators($state.snapshot(prepared.manifest), format);
      if (destroyed) return;
      if (!unchanged()) { status = 'Inputs changed before export. Prepare a new preview before downloading.'; return; }
      downloadLocalFile(new Blob([file.content], { type: file.mimeType }), file.filename);
      status = `Downloaded the ${format === 'manifest' ? 'revision manifest' : format.toUpperCase() + ' file'}. Nothing was submitted or applied.`;
    } catch (cause) { if (!destroyed) status = cause instanceof Error ? cause.message : 'The revision could not be exported.'; }
    finally { if (!destroyed) { busy = false; await tick(); restoreSubmittedFocus(origin, origin instanceof HTMLElement ? origin : null, componentRoot); } }
  }
</script>

<section class="managed-indicators" aria-labelledby={`${id}-heading`} bind:this={componentRoot}>
  <h2 id={`${id}-heading`}>Indicator revisions</h2>
  <p>Keep stable identities across reviewed exports. Changes stay in this panel until you download a file.</p>
  <label class="field" for={`${id}-file`}>Preview a retained revision</label>
  <input id={`${id}-file`} type="file" accept="application/json,.json" disabled={busy} onchange={event => void selectFile(event.currentTarget.files?.[0])}>
  {#if incoming}
    <div class="revision-preview" aria-label="Imported indicator revision preview">
      <h3>{incoming.manifest.name} · revision {incoming.manifest.revision}</h3>
      <p>Retained identities: {incoming.manifest.entries.length} · {incoming.manifest.id}</p>
      <p>Digest verification checks content, not authorship. {incoming.changes ? `${incoming.changes.length} changes against the selected predecessor.` : 'Earlier revisions were not supplied for comparison.'}</p>
      <ul>{#each incoming.manifest.entries as entry}<li>{entry.domain} · {managedIndicatorState(entry, reviewedAt)} · expires {entry.expiresAt}</li>{/each}</ul>
      <button type="button" class="btn" onclick={useIncoming}>Use this revision as baseline</button>
    </div>
  {/if}
  <form aria-label="Prepare indicator revision" oninput={invalidatePlan} onsubmit={event => { event.preventDefault(); void prepare(event.submitter); }}>
    <div class="field"><label for={`${id}-name`}>Set name</label><input id={`${id}-name`} bind:value={name} maxlength="120" required readonly={baseline !== null}></div>
    {#if baseline}<p id={`${id}-baseline`} tabindex="-1">Baseline revision {baseline.revision} · retained identities: {baseline.entries.length}</p>{/if}
    <label class="choice"><input type="checkbox" bind:checked={includeSelected} disabled={!contextReady || busy}><span>Add eligible shortlisted domains from the current filtered results ({selectedDomains.length} shortlisted)</span></label>
    {#if !contextReady}<p>Current candidate eligibility is unavailable; no new domains will be added.</p>{/if}
    {#if baseline}
      <fieldset><legend>Explicit changes to retained identities</legend>
        {#each baseline.entries as entry}
          <div class="entry"><strong>{entry.domain}</strong><span>{managedIndicatorState(entry, reviewedAt)} · expires {entry.expiresAt}</span>
            <small>{entry.id}</small>
            {#if entry.withdrawal}<p>Withdrawn: {entry.withdrawal.reason}</p>{:else}
              <div class="entry-choices"><label class="choice"><input type="checkbox" bind:group={renewIds} value={entry.id} disabled={busy || withdrawIds.includes(entry.id)}><span>Renew {entry.domain}</span></label>
              <label class="choice"><input type="checkbox" bind:group={withdrawIds} value={entry.id} disabled={busy || renewIds.includes(entry.id)}><span>Withdraw {entry.domain}</span></label></div>
            {/if}
          </div>
        {/each}
      </fieldset>
    {/if}
    {#if includeSelected && reintroductions.length}<fieldset><legend>New identities for withdrawn domains</legend>
      {#each reintroductions as domain}<label class="choice"><input type="checkbox" bind:group={reintroduceDomains} value={domain}><span>Reintroduce {domain} with a new identity</span></label>{/each}
    </fieldset>{/if}
    <div class="field"><label for={`${id}-expiry`}>Expiry for additions and renewals (UTC)</label><input id={`${id}-expiry`} bind:value={expiresAt} maxlength="64" placeholder="2026-10-23T00:00:00.000Z"></div>
    <div class="field"><label for={`${id}-basis`}>Review basis</label><textarea id={`${id}-basis`} bind:value={reviewBasis} rows="3" maxlength={MAX_INDICATOR_REVIEW_BASIS} required></textarea></div>
    <button type="submit" class="btn" disabled={busy}>Prepare revision preview</button>
  </form>
  <p role="status" aria-atomic="true">{status}</p>
  {#if prepared}
    <section class="revision-preview" aria-label="Prepared indicator revision">
      <h3>Revision {prepared.manifest.revision} · changes: {prepared.changes.length}</h3>
      <ul>{#each prepared.changes as change}<li>{change.domain} · {change.kind}</li>{/each}</ul>
      <p>{prepared.unchanged} identities unchanged. {prepared.exclusions.length} candidate exclusions.</p>
      {#if prepared.exclusions.length}<details><summary>Excluded candidates</summary><ul>{#each prepared.exclusions as item}<li>{item.domain} · {item.reason.replaceAll('_', ' ')}</li>{/each}</ul></details>{/if}
      <div class="downloads"><button class="btn" type="button" disabled={busy} onclick={() => void download('manifest')}>Download revision manifest</button><button class="btn" type="button" disabled={busy} onclick={() => void download('stix')}>Download STIX</button><button class="btn" type="button" disabled={busy} onclick={() => void download('misp')}>Download MISP JSON</button></div>
      <p>Keep the manifest and its predecessor. Importing an export into another system is a separate action.</p>
    </section>
  {/if}
  <details><summary>Revision behaviour</summary><p>Expiry and withdrawal are separate. Missing candidates are unchanged. Renewals do not refresh the original observation. Withdrawn identities cannot be revived; a reintroduced domain gets a new identity. MISP receives expiry as a review deadline, not an automatic deletion rule. These files contain domains and your review basis; review them before sharing.</p></details>
</section>

<style>
  .managed-indicators{min-width:0;overflow-wrap:anywhere;display:grid;gap:12px}h2,h3,p{margin:0}form{display:grid;gap:14px;max-width:900px}.field{display:grid;gap:5px}input:not([type=checkbox]),textarea{width:100%;min-width:0;max-width:100%}
  .choice{display:flex;align-items:flex-start;gap:9px;padding:8px 0}.choice input{flex:none;margin-top:3px}.entry{display:grid;gap:5px;padding:12px 0;border-bottom:1px solid var(--border)}.entry-choices,.downloads{display:flex;flex-wrap:wrap;gap:12px}.revision-preview{display:grid;gap:12px;border:1px solid var(--border);padding:14px;border-radius:var(--radius-sm)}fieldset{min-width:0}.entry small{overflow-wrap:anywhere}summary{padding:10px 0}
</style>
