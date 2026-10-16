<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import type { BrandProfile } from '#lib/brand-profiles.ts';
  import type { CaseRecord } from '#lib/cases.ts';
  import { BRAND_REFERENCE_CONTEXTS, MAX_BRAND_REVIEW_REFERENCES, brandReviewReferences, type BrandReferenceContext } from '#lib/analysis/brand-review-references.ts';
  import { filterGalleryFiles, type GalleryFile } from '#lib/analysis/retained-evidence-gallery.ts';
  import { readRetainedCaseFile } from '#lib/case-attachments.ts';
  import DeferredSurface from './DeferredSurface.svelte';
  import Pagination from './Pagination.svelte';

  let { profile, cases, casesState }: { profile: BrandProfile; cases: readonly CaseRecord[]; casesState: 'loading' | 'ready' | 'unavailable' } = $props();
  let open = $state(false), query = $state(''), page = $state(1), chosenKey = $state('');
  let selected = $state<{ key: string; context: BrandReferenceContext }[]>([]);
  let baselineSelected = $state(false), baselineContext = $state<BrandReferenceContext>('Unspecified');
  let message = $state(''), error = $state(''), busy = $state(false);
  let prepared = $state.raw<{ source: GalleryFile; body: Blob } | null>(null);
  let heading = $state<HTMLHeadingElement>(), picker = $state<HTMLSelectElement>(), previewTrigger: HTMLButtonElement | null = null;
  let generation = 0;
  const files = $derived(casesState === 'ready' ? brandReviewReferences(profile.id, cases) : []);
  const matches = $derived(filterGalleryFiles(files, 'png', query));
  const pageCount = $derived(Math.max(1, Math.ceil(matches.length / 20)));
  const currentPage = $derived(Math.min(page, pageCount));
  const visible = $derived(matches.slice((currentPage - 1) * 20, currentPage * 20));
  const count = $derived(selected.length + Number(baselineSelected));

  function invalidate() { generation++; prepared = null; busy = false; error = ''; previewTrigger = null; }
  function clear() { invalidate(); selected = []; baselineSelected = false; baselineContext = 'Unspecified'; chosenKey = ''; query = ''; page = 1; }
  $effect(() => {
    profile; cases; casesState;
    untrack(() => { const hadReferences = count > 0; clear(); message = hadReferences ? 'The Brand or Case source changed. Choose references from the current records.' : ''; });
  });
  onDestroy(clear);
  function toggle() { if (!open) { clear(); message = ''; } }
  async function setPage(next: number) { page = Math.max(1, Math.min(pageCount, next)); chosenKey = ''; await tick(); picker?.focus(); }
  function add() {
    if (count >= MAX_BRAND_REVIEW_REFERENCES || selected.some(item => item.key === chosenKey) || !visible.some(file => file.key === chosenKey)) return;
    selected = [...selected, { key: chosenKey, context: 'Unspecified' }]; chosenKey = ''; message = 'Reference added for this review only.';
  }
  function remove(key: string) { invalidate(); selected = selected.filter(item => item.key !== key); message = 'Reference removed from this review. The retained file is unchanged.'; }
  async function closePreview() { const trigger = previewTrigger; invalidate(); await tick(); if (trigger?.isConnected) trigger.focus(); }
  async function preview(file: GalleryFile, trigger: HTMLButtonElement) {
    if (busy || casesState !== 'ready' || !open || !selected.some(item => item.key === file.key)) return;
    invalidate(); const current = generation; const expectedProfile = profile, expectedCases = cases;
    previewTrigger = trigger; busy = true;
    const owns = () => current === generation && open && profile === expectedProfile && cases === expectedCases
      && casesState === 'ready' && selected.some(item => item.key === file.key);
    try {
      const body = await readRetainedCaseFile(file.attachment);
      if (!owns()) return;
      prepared = { source: file, body }; await tick(); if (owns()) heading?.focus();
    } catch { if (owns()) error = 'The selected original could not be read and verified. Open its Case to restore or retain the matching original. Saved evidence is unchanged.'; }
    finally { if (current === generation) busy = false; }
  }
</script>

<details class="brand-reference-review card" bind:open ontoggle={toggle}>
  <summary>Choose Brand review references</summary>
  {#if open}
    <p>Compare the context of references you have reviewed for {profile.name}. Choose up to {MAX_BRAND_REVIEW_REFERENCES} for this visit.</p>
    <details><summary>Reference scope and lifetime</summary><p>Context labels are your choices for this review, not verified capture conditions or proof of legitimacy. PNG references come only from explicitly associated Cases; matching a domain does not associate a file. Ambiguous identities are excluded. A Case domain is not an observed image hostname. Choices and previews clear when this panel closes, its Brand or Case source refreshes, or you leave the page. Nothing is saved or exported.</p></details>
    {#if profile.pageBaseline}
      {@const baseline = profile.pageBaseline}
      <section aria-label="Saved Brand page baseline">
        <label class="choice"><input type="checkbox" bind:checked={baselineSelected} disabled={!baselineSelected && count >= MAX_BRAND_REVIEW_REFERENCES} />Use the saved page baseline</label>
        <p>{baseline.domain} · Observed: {baseline.observedAt}<br />Lookup domain: {baseline.lookupDomain} · Canonical host: {baseline.canonicalHost ?? 'Not retained'}<br />Page title: {baseline.pageTitle ?? 'Not retained'}</p>
        <p>{baseline.complete && !baseline.truncated ? 'Complete retained profile' : 'Partial retained profile'} · Baseline version {baseline.baselineVersion} · Fingerprint version {baseline.fingerprintVersion}. This compact profile contains no original screenshot, retained-at time or capture-condition declaration.</p>
        {#if baselineSelected}<label>Baseline context for this review<select bind:value={baselineContext}>{#each BRAND_REFERENCE_CONTEXTS as context}<option>{context}</option>{/each}</select></label>{/if}
      </section>
    {:else}<p>No saved page baseline is available for this Brand.</p>{/if}
    {#if casesState !== 'ready'}
      <p role="status">{casesState === 'loading' ? 'Reading associated Case references…' : 'Case references are unavailable. No absence of evidence is inferred.'}</p>
    {:else}
      <label>Find an associated PNG reference<input type="search" maxlength="200" bind:value={query} oninput={() => { page = 1; chosenKey = ''; }} /></label>
      <p>{matches.length} matching references from {files.length} PNG references in explicitly associated Cases. Showing page {currentPage} of {pageCount}. Listing references does not open their original files.</p>
      <label>Reference on this page<select bind:this={picker} bind:value={chosenKey}><option value="">Choose a reference</option>{#each visible as file (file.key)}<option value={file.key} disabled={selected.some(item => item.key === file.key)}>{file.attachment.fileName} · {file.caseNumber}</option>{/each}</select></label>
      <Pagination {currentPage} {pageCount} setPage={value => void setPage(value)} ariaLabel="Brand reference pages" pageInputLabel="Brand reference page" />
      <button class="btn" disabled={!chosenKey || count >= MAX_BRAND_REVIEW_REFERENCES} onclick={add}>Add review reference</button>
      <p role="status">{count} of {MAX_BRAND_REVIEW_REFERENCES} references selected. {message}</p>
      <ol aria-label="Selected Brand references">
        {#each selected as item, index (item.key)}
          {@const file = files.find(candidate => candidate.key === item.key)}
          {#if file}<li>
            <h3>{file.attachment.fileName}</h3><a href={`/cases?case=${encodeURIComponent(file.reference.caseId)}`}>Open {file.caseNumber}</a>
            <p>Case domain: {file.caseDomain}<br />Declared source: {file.attachment.source ?? 'Not declared'}<br />Observed: {file.attachment.observedAt ?? 'Unknown'}<br />Retained: {file.attachment.retainedAt}</p>
            <details><summary>Recorded file identity</summary><code>{file.reference.attachmentId}</code><br /><code>{file.attachment.digestSha256}</code><p>{file.attachment.byteLength} bytes. {file.attachment.derivation ? 'Derived image; the original parent pixels are not selected by this reference.' : 'No image derivation declaration is retained.'}</p>{#if file.attachment.derivation}<code>{file.attachment.derivation.source.digestSha256}</code>{/if}</details>
            <label>Context for reference {index + 1}: {file.attachment.fileName}<select bind:value={item.context}>{#each BRAND_REFERENCE_CONTEXTS as context}<option>{context}</option>{/each}</select></label>
            <div class="actions"><button class="btn" aria-label={`Preview reference ${index + 1}: ${file.attachment.fileName}`} disabled={busy} onclick={event => void preview(file, event.currentTarget)}>Preview {file.attachment.fileName}</button><button class="btn" aria-label={`Remove reference ${index + 1}: ${file.attachment.fileName}`} onclick={() => remove(file.key)}>Remove {file.attachment.fileName}</button></div>
          </li>{/if}
        {/each}
      </ol>
    {/if}
    {#if busy}<div class="actions"><p role="status">Reading and checking the selected original…</p><button class="btn" onclick={closePreview}>Cancel preview</button></div>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
    {#if prepared}
      <section aria-label="Selected Brand original">
        <h3 bind:this={heading} tabindex="-1">{prepared.source.attachment.fileName}</h3>
        <DeferredSurface load={() => import('./ArtifactPreview.svelte')} props={{ file: prepared.body, mediaType: 'image/png', label: prepared.source.attachment.fileName, focusOnReady: false }} loadingLabel="Preparing selected PNG…" unavailableLabel="The local PNG viewer could not be loaded. Saved evidence is unchanged." />
        <button class="btn" onclick={closePreview}>Close preview</button>
      </section>
    {/if}
  {/if}
</details>

<style>
  .brand-reference-review{padding:var(--card-pad);margin-bottom:16px;min-width:0}summary{min-height:44px;align-content:center;cursor:pointer}p{font-size:var(--text-xs);color:var(--muted);line-height:1.6}
  p,h3,a,code{overflow-wrap:anywhere}h3{font-size:var(--text-sm)}code{font-size:var(--text-2xs)}section,li{min-width:0}section,ol{margin-block:12px}li+li{margin-top:16px}label{display:grid;gap:6px;font-size:var(--text-xs);margin-block:10px;min-width:0}select,input{min-width:0;width:100%}.choice{display:flex;align-items:center;gap:8px}.choice input{width:auto}
  .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button{white-space:normal;max-width:100%}h3:focus{outline:2px solid var(--focus);outline-offset:3px}[role='alert']{color:var(--danger)}@media print{.brand-reference-review{display:none}}
</style>
