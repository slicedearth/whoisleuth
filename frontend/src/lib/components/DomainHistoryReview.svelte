<script lang="ts">
  import type { CaseRecord } from '#lib/cases.ts';
  import type { PersistCaseOperation } from '#lib/analysis/case-response-stage.ts';
  import { CASE_SCHEMA_VERSION } from '../../../../packages/contracts/case-portability.mts';
  import { MAX_CONTEXT_RECORDS, type ContextReview } from '../../../../packages/contracts/context-review.mts';
  import { DOMAIN_HISTORY_INPUT_SCHEMA, DOMAIN_HISTORY_INPUT_VERSION, DOMAIN_CHANGE_FAMILIES, REGISTRATION_BOUNDARY_KINDS, MAX_REGISTRATION_BOUNDARIES, readDomainHistoryDeclarations, reviewDomainHistory, type RegistrationBoundary, type DomainChangeFamily, type ExpectedDomainChange, type RetiredDependency } from '../../../../packages/investigation/domain-history-review.mts';
  import CaseContextReport from './CaseContextReport.svelte';
  import './context-review.css';
  let { record, mutationBusy, persistOperation }: { record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation } = $props();
  let expected = $state<ExpectedDomainChange[]>([]), retired = $state<RetiredDependency[]>([]), family = $state<DomainChangeFamily>('web');
  let start = $state(''), end = $state(''), reason = $state(''), asset = $state(''), dependency = $state(''), retiredAt = $state(''), source = $state(''), authorised = $state(false);
  let report = $state.raw<ContextReview | null>(null), input = $state.raw<unknown>(null), error = $state('');
  let boundaries = $state<RegistrationBoundary[]>([]), boundaryKind = $state<RegistrationBoundary['kind']>('review_boundary');
  let boundaryTime = $state(''), boundarySource = $state(''), boundaryRationale = $state(''), boundarySnapshot = $state(''), boundaryPin = $state('');
  function add(kind: 'expected' | 'retired', event: SubmitEvent) {
    event.preventDefault(); error = '';
    if (!authorised) { error = 'Confirm your authority before adding an owned-asset declaration.'; return; }
    try {
      const expectedChanges = kind === 'expected' ? [...expected, { family, start: new Date(start).toISOString(), end: new Date(end).toISOString(), reason: reason.trim() }] : expected;
      const retiredDependencies = kind === 'retired' ? [...retired, { asset: asset.trim().toLowerCase(), dependency: dependency.trim().toLowerCase(), family, retiredAt: new Date(retiredAt).toISOString(), source: source.trim() }] : retired;
      const checked = readDomainHistoryDeclarations({ expectedChanges, retiredDependencies, registrationBoundaries: boundaries }, 2);
      expected = checked.expectedChanges; retired = checked.retiredDependencies; report = null;
    } catch (cause) { error = cause instanceof Error ? cause.message : 'The declaration could not be added.'; }
  }
  function addBoundary(event: SubmitEvent) {
    event.preventDefault(); error = '';
    try {
      const registrationBoundaries = [...boundaries, { kind: boundaryKind, occurredAt: new Date(boundaryTime).toISOString(), source: boundarySource.trim(), rationale: boundaryRationale.trim(),
        snapshotIds: boundarySnapshot ? [boundarySnapshot] : [], evidencePinIds: boundaryPin ? [boundaryPin] : [] }];
      boundaries = readDomainHistoryDeclarations({ expectedChanges: expected, retiredDependencies: retired, registrationBoundaries }, 2).registrationBoundaries;
      report = null;
    } catch (cause) { error = cause instanceof Error ? cause.message : 'The declared boundary could not be added.'; }
  }
  function review() {
    error = '';
    try { const declarations = { expectedChanges: expected, retiredDependencies: retired, registrationBoundaries: boundaries }; report = reviewDomainHistory(record, declarations, new Date().toISOString(), 2);
      input = { schema: DOMAIN_HISTORY_INPUT_SCHEMA, version: DOMAIN_HISTORY_INPUT_VERSION, evidence: { caseExport: { version: CASE_SCHEMA_VERSION, cases: [record] }, caseId: record.id, declarations } };
    } catch (cause) { report = null; error = cause instanceof Error ? cause.message : 'Retained history could not be reviewed.'; }
  }
</script>
<section class="context-review" aria-label="Domain history and retired dependencies"><h3>Domain history and retired dependencies</h3><div class="body">
  <p>Compare this Case’s retained observations. Add expected maintenance, a retired dependency or a source-linked registration boundary to put changes in context without replacing earlier evidence.</p>
  <details><summary>Declare an expected change or retired dependency</summary><div class="body">
    <label class="checkbox"><input type="checkbox" bind:checked={authorised}> I own or am authorised to review the affected assets.</label>
    <label>Evidence family<select bind:value={family}>{#each DOMAIN_CHANGE_FAMILIES as item}<option value={item}>{item}</option>{/each}</select></label>
    {#if expected.length >= MAX_CONTEXT_RECORDS}<p role="status">The {MAX_CONTEXT_RECORDS}-window limit is reached. Remove an expected window below before adding another.</p>{/if}
    <form onsubmit={event => add('expected', event)}><fieldset disabled={mutationBusy || expected.length >= MAX_CONTEXT_RECORDS}><legend>Expected change</legend><div class="fields"><label>Window start (local time)<input type="datetime-local" required bind:value={start}></label><label>Window end (local time)<input type="datetime-local" required bind:value={end}></label></div><label>Reason or change reference<input required maxlength="500" bind:value={reason}></label><button class="btn" type="submit">Add expected window</button></fieldset></form>
    {#if retired.length >= MAX_CONTEXT_RECORDS}<p role="status">The {MAX_CONTEXT_RECORDS}-dependency limit is reached. Remove a dependency below before adding another.</p>{/if}
    <form onsubmit={event => add('retired', event)}><fieldset disabled={mutationBusy || retired.length >= MAX_CONTEXT_RECORDS}><legend>Retired dependency</legend><div class="fields"><label>Owned asset hostname<input required maxlength="253" bind:value={asset} placeholder="www.example.test"></label><label>Dependency hostname<input required maxlength="253" bind:value={dependency} placeholder="retired.example.test"></label><label>Retirement time (local)<input type="datetime-local" required bind:value={retiredAt}></label><label>Source or change reference<input required maxlength="500" bind:value={source}></label></div><button class="btn" type="submit">Add retired dependency</button></fieldset></form>
    <ul>{#each expected as item, index}<li>{item.family}: {item.reason} <button class="btn small" type="button" onclick={() => { expected = expected.filter((_, i) => i !== index); report = null; }}>Remove expected window {index + 1}</button></li>{/each}
    {#each retired as item, index}<li>{item.asset} → {item.dependency} <button class="btn small" type="button" onclick={() => { retired = retired.filter((_, i) => i !== index); report = null; }}>Remove dependency {index + 1}</button></li>{/each}</ul>
  </div></details>
  <details><summary>Declare a registration-lifecycle review boundary</summary><div class="body">
    <p>Link an analyst-reported event or review boundary to retained evidence. Earlier observations and decisions are preserved. This does not confirm deletion, re-registration, transfer or a new owner.</p>
    <form onsubmit={addBoundary}><fieldset disabled={mutationBusy || boundaries.length >= MAX_REGISTRATION_BOUNDARIES}><legend>Analyst-declared registration boundary</legend>
      <label>Boundary kind<select bind:value={boundaryKind}>{#each REGISTRATION_BOUNDARY_KINDS as kind}<option value={kind}>{kind.replaceAll('_', ' ')}</option>{/each}</select></label>
      <label>Declared boundary time (local)<input type="datetime-local" required bind:value={boundaryTime}></label>
      <label>Boundary source label<input required maxlength="160" bind:value={boundarySource}></label>
      <label>Boundary rationale<input required maxlength="500" bind:value={boundaryRationale}></label>
      <label>Retained snapshot reference<select bind:value={boundarySnapshot}><option value="">None selected</option>{#each record.evidenceHistory as snapshot}<option value={snapshot.id}>{snapshot.source} · {snapshot.capturedAt} · {snapshot.id}</option>{/each}</select></label>
      <label>Retained evidence pin reference<select bind:value={boundaryPin}><option value="">None selected</option>{#each record.evidencePins as pin}<option value={pin.id}>{pin.label} · {pin.source} · {pin.id}</option>{/each}</select></label>
      <button class="btn" type="submit">Add declared boundary</button>
    </fieldset></form>
    {#if boundaries.length >= MAX_REGISTRATION_BOUNDARIES}<p role="status">The {MAX_REGISTRATION_BOUNDARIES}-boundary limit is reached.</p>{/if}
    <ul>{#each boundaries as boundary, index}<li>{boundary.kind.replaceAll('_', ' ')} · {boundary.occurredAt} · {boundary.rationale}<button class="btn small" type="button" disabled={mutationBusy} onclick={() => { boundaries = boundaries.filter((_, i) => i !== index); report = null; }}>Remove declared boundary {index + 1}</button></li>{/each}</ul>
  </div></details>
  <button class="btn" type="button" disabled={mutationBusy} onclick={review}>Review retained history</button>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if report}<CaseContextReport {report} {record} {mutationBusy} {persistOperation} reusableInput={input} retainReusableInput={false} /><p class="meta">The reusable input download includes this Case’s retained record. It is not duplicated in Case storage.</p>{/if}
</div></section>
