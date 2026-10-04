<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CaseRecord } from '#lib/cases.ts';
  import type { PersistCaseOperation } from '#lib/analysis/case-response-stage.ts';
  import { CASE_PROVIDER_OUTCOMES, CASE_OBSERVED_EFFECT_STATES } from '../../../../packages/cases/case-response-records.mts';
  import { PLATFORM_OBJECT_TYPES, PLATFORM_REPORT_STATES, PLATFORM_CONTINUITY_INPUT_SCHEMA, PLATFORM_CONTINUITY_INPUT_VERSION, readPlatformObjects, reviewPlatformContinuity, type PlatformObject, type PlatformObjectType } from '../../../../packages/investigation/platform-continuity-review.mts';
  import { MAX_CONTEXT_RECORDS, MAX_CONTEXT_INPUT_BYTES, type ContextReview } from '../../../../packages/contracts/context-review.mts';
  import { platformPresentation, type ContextReviewPresentation } from '#lib/analysis/context-review-presentation.ts';
  import LocalFileInput from './LocalFileInput.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  import { readContextFile, readContextEvidence } from '#lib/context-review-input.ts';
  import CaseContextReport from './CaseContextReport.svelte';
  import Pagination from './Pagination.svelte';
  import './context-review.css';
  let { record, mutationBusy, persistOperation }: { record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation } = $props();
  let rows = $state<PlatformObject[]>([]), platformOrigin = $state(''), objectType = $state<PlatformObjectType>('account'), objectId = $state(''), version = $state(''), observedAt = $state(''), source = $state('');
  let reportState = $state<PlatformObject['report']>('not_reported'), outcome = $state(''), recheck = $state<PlatformObject['recheck']>('not_checked'), recheckedAt = $state('');
  let report = $state.raw<ContextReview | null>(null), input = $state.raw<unknown>(null), error = $state(''), page = $state(1), loading = $state(false), generation = 0;
  let editing = $state<number | null>(null);
  let presentation = $state<ContextReviewPresentation | null>(null);
  onDestroy(() => { generation++; });
  function edit(index: number) {
    const row = rows[index]; if (!row) return;
    const localInput = (value: string) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, -1); };
    editing = index; platformOrigin = row.platformOrigin; objectType = row.objectType; objectId = row.objectId; version = row.version ?? ''; observedAt = localInput(row.observedAt); source = row.source;
    reportState = row.report; outcome = row.providerOutcome ?? ''; recheck = row.recheck; recheckedAt = row.recheckedAt ? localInput(row.recheckedAt) : '';
  }
  function add(event: SubmitEvent) {
    event.preventDefault(); error = '';
    try { const submitted = { platformOrigin: platformOrigin.trim(), objectType, objectId: objectId.trim(), version: version.trim() || null, observedAt: new Date(observedAt).toISOString(), source: source.trim(),
      report: reportState, providerOutcome: outcome || null, recheck, recheckedAt: recheck === 'not_checked' ? null : new Date(recheckedAt).toISOString() };
      rows = readPlatformObjects(editing === null ? [...rows, submitted] : rows.map((row, index) => index === editing ? submitted : row)); report = null; editing = null; objectId = ''; version = ''; page = Math.ceil(rows.length / 10); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'The object could not be added.'; }
  }
  async function load(file: File | null) {
    if (!file) { generation++; loading = false; return; }
    const request = ++generation; loading = true; error = '';
    try { const evidence = readContextEvidence(await readContextFile(file), PLATFORM_CONTINUITY_INPUT_SCHEMA); const parsed = readPlatformObjects(evidence); if (request === generation) { rows = parsed; report = null; page = 1; editing = null; } }
    catch { if (request === generation) error = 'Select a valid platform-continuity input file. The existing draft was preserved.'; }
    finally { if (request === generation) loading = false; }
  }
  function review() { report = reviewPlatformContinuity(rows, new Date().toISOString()); presentation = platformPresentation(rows); input = { schema: PLATFORM_CONTINUITY_INPUT_SCHEMA, version: PLATFORM_CONTINUITY_INPUT_VERSION, evidence: rows }; }
</script>
<section class="context-review" aria-label="Platform objects and version continuity"><h3>Platform objects and version continuity</h3><div class="body">
  <p>Keep an account, tenant, application, extension, package or page tied to its stable platform ID. Record version observations and outcomes per object.</p>
  <LocalFileInput label="Load an earlier platform review input" accept=".json,application/json" maximumBytes={MAX_CONTEXT_INPUT_BYTES} disabled={loading || mutationBusy} onselect={load} />
  {#if rows.length >= MAX_CONTEXT_RECORDS}<p role="status">The {MAX_CONTEXT_RECORDS}-observation limit is reached. You can edit existing observations, or remove one below before adding another.</p>{/if}
  <form onsubmit={add}><fieldset disabled={loading || mutationBusy || editing === null && rows.length >= MAX_CONTEXT_RECORDS}><legend>{editing === null ? 'Add an object observation' : `Edit observation ${editing + 1}`}</legend><div class="fields">
    <label>Platform origin<input required type="url" maxlength="500" bind:value={platformOrigin} placeholder="https://platform.example.test"></label><label>Object type<select bind:value={objectType}>{#each PLATFORM_OBJECT_TYPES as item}<option value={item}>{item}</option>{/each}</select></label>
    <label>Stable object ID<input required maxlength="240" bind:value={objectId}></label><label>Version (if supplied)<input maxlength="100" bind:value={version}></label>
    <label>Observed at (local time)<input required type="datetime-local" step="0.001" bind:value={observedAt}></label><label>Source or evidence reference<input required maxlength="500" bind:value={source}></label>
    <label>Report status<select bind:value={reportState}>{#each PLATFORM_REPORT_STATES as item}<option value={item}>{item.replaceAll('_', ' ')}</option>{/each}</select></label>
    <label>Provider outcome<select bind:value={outcome}><option value="">Not supplied</option>{#each CASE_PROVIDER_OUTCOMES as item}<option value={item}>{item.replaceAll('_', ' ')}</option>{/each}</select></label>
    <label>Independent recheck<select bind:value={recheck}>{#each CASE_OBSERVED_EFFECT_STATES as item}<option value={item}>{item.replaceAll('_', ' ')}</option>{/each}</select></label>
    {#if recheck !== 'not_checked'}<label>Rechecked at (local time)<input required type="datetime-local" step="0.001" bind:value={recheckedAt}></label>{/if}
  </div><button class="btn" type="submit">{editing === null ? 'Add object observation' : 'Update object observation'}</button>{#if editing !== null}<button class="btn" type="button" onclick={() => editing = null}>Cancel object edit</button>{/if}</fieldset></form>
  {#if rows.length}<ol start={(page - 1) * 10 + 1}>{#each rows.slice((page - 1) * 10, page * 10) as row, index}<li>{row.platformOrigin} · {row.objectType} · {row.objectId} · {row.version ?? 'version unknown'}<EvidenceTimestamp value={row.observedAt} label="draft observation time" /><div class="actions"><button class="btn small" type="button" onclick={() => edit((page - 1) * 10 + index)}>Edit observation {(page - 1) * 10 + index + 1}</button><button class="btn small" type="button" onclick={() => { rows = rows.filter((_, i) => i !== (page - 1) * 10 + index); page = Math.max(1, Math.min(page, Math.ceil(rows.length / 10))); editing = null; report = null; }}>Remove observation {(page - 1) * 10 + index + 1}</button></div></li>{/each}</ol><Pagination currentPage={page} pageCount={Math.ceil(rows.length / 10)} setPage={next => page = next} ariaLabel="Platform draft observations" />{/if}
  <button class="btn" type="button" disabled={loading || mutationBusy} onclick={review}>Review platform continuity</button>{#if error}<p role="alert">{error}</p>{/if}
  {#if report}<CaseContextReport {report} {record} {mutationBusy} {persistOperation} {presentation} reusableInput={input} />{/if}
</div></section>
