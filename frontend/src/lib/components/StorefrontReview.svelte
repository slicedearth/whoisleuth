<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CaseRecord } from '#lib/cases.ts';
  import type { PersistCaseOperation } from '#lib/analysis/case-response-stage.ts';
  import { MAX_CONTEXT_INPUT_BYTES, type ContextReview } from '../../../../packages/contracts/context-review.mts';
  import { storefrontPresentation, type ContextReviewPresentation } from '#lib/analysis/context-review-presentation.ts';
  import LocalFileInput from './LocalFileInput.svelte';
  import { STOREFRONT_INPUT_SCHEMA, STOREFRONT_INPUT_VERSION, readStorefrontObservation, reviewStorefront } from '../../../../packages/investigation/storefront-review.mts';
  import { storefrontDraft, storefrontDraftInput, draftFromStorefront } from '#lib/analysis/storefront-review-draft.ts';
  import { readContextFile, readContextEvidence } from '#lib/context-review-input.ts';
  import { exact } from '../../../../packages/evidence/artifact-structure.mts';
  import StorefrontObservationFields from './StorefrontObservationFields.svelte';
  import CaseContextReport from './CaseContextReport.svelte';
  import './context-review.css';
  let { record, mutationBusy, persistOperation }: { record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation } = $props();
  let official = $state(storefrontDraft()), candidate = $state(storefrontDraft()), authorised = $state(false), reseller = $state<'unknown' | 'authorised' | 'not_authorised'>('unknown'), resellerSource = $state('');
  let report = $state.raw<ContextReview | null>(null), input = $state.raw<unknown>(null), error = $state(''), loading = $state(false), generation = 0;
  let presentation = $state<ContextReviewPresentation | null>(null);
  onDestroy(() => { generation++; });
  function review(event: SubmitEvent) {
    event.preventDefault(); error = '';
    try { const evidence = { official: storefrontDraftInput(official), candidate: storefrontDraftInput(candidate), authorisedComparator: authorised, resellerStatus: reseller, resellerSource: resellerSource.trim() || null };
      report = reviewStorefront(evidence, new Date().toISOString()); presentation = storefrontPresentation(evidence); input = { schema: STOREFRONT_INPUT_SCHEMA, version: STOREFRONT_INPUT_VERSION, evidence };
    } catch (cause) { report = null; error = cause instanceof Error ? cause.message : 'The comparison could not be prepared.'; }
  }
  async function load(file: File | null) {
    if (!file) { generation++; loading = false; return; }
    const request = ++generation; loading = true; error = '';
    try {
      const evidence = readContextEvidence(await readContextFile(file), STOREFRONT_INPUT_SCHEMA);
      reviewStorefront(evidence, new Date().toISOString());
      const checked = exact(evidence, ['official', 'candidate', 'authorisedComparator', 'resellerStatus', 'resellerSource'], 'Storefront input');
      if (request === generation) { official = draftFromStorefront(readStorefrontObservation(checked.official)); candidate = draftFromStorefront(readStorefrontObservation(checked.candidate)); reseller = checked.resellerStatus as typeof reseller; resellerSource = checked.resellerSource as string ?? ''; authorised = false; report = null; }
    } catch { if (request === generation) error = 'Select a valid storefront review input. The existing draft was preserved.'; }
    finally { if (request === generation) loading = false; }
  }
</script>
<section class="context-review" aria-label="Storefront and official-site comparison"><h3>Storefront and official-site comparison</h3><div class="body">
  <p>Compare recorded storefront evidence with an authorised official site. Mark only the categories you reviewed; an empty reviewed category means no values were recorded.</p>
  <LocalFileInput label="Load an earlier storefront review input" accept=".json,application/json" maximumBytes={MAX_CONTEXT_INPUT_BYTES} disabled={loading || mutationBusy} onselect={load} />
  <form onsubmit={review} oninput={() => report = null}><fieldset disabled={loading || mutationBusy}><legend>Comparison evidence</legend><div class="fields"><StorefrontObservationFields label="Official" bind:draft={official} /><StorefrontObservationFields label="Candidate" bind:draft={candidate} /></div>
    <label class="checkbox"><input required type="checkbox" bind:checked={authorised}> I own or am authorised to use this official comparator.</label>
    <label>Reseller or affiliate authority<select bind:value={reseller}><option value="unknown">Unknown</option><option value="authorised">Authorised, with evidence</option><option value="not_authorised">Not authorised, with rights-holder evidence</option></select></label>
    <label>Authority source or reference<input maxlength="500" required={reseller !== 'unknown'} bind:value={resellerSource}></label>
    <button class="btn" type="submit">Compare storefront evidence</button>
  </fieldset></form>
  {#if error}<p role="alert">{error}</p>{/if}{#if report}<CaseContextReport {report} {record} {mutationBusy} {persistOperation} {presentation} reusableInput={input} />{/if}
</div></section>
