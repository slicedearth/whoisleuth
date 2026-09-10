<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount, tick, untrack } from 'svelte';
  import { parseBoundedJson } from '$lib/bounded-json';
  import { BrowserLocalDataError } from '$lib/browser-local-data.ts';
  import { registerAnalystUndo } from '$lib/analyst-undo';
  import { createDraftRevision } from '$lib/controllers/submitted-draft';
  import { preloadBestEffort } from '$lib/idle-preload';
  import { selectConsoleCase } from '$lib/console-workflow-state';
  import { buildMonitorNavigationUrl, monitorRouteKey, monitorRouteTarget } from '$lib/controllers/monitor-route-controller.ts';
  import { loadInvestigationGuide } from '$lib/investigation-guide';
  import { loadProfiles, type BrandProfile } from '$lib/brand-profiles';
  import type { ParentDomainCampaignSourceState } from '$lib/analysis/parent-domain-campaign-review.ts';
  import {
    addCaseBrandProfileAssociation, addCaseNote, CASE_DISPOSITIONS, CASE_STATUSES,
    caseFreeformTags, caseTagsWithTypes, caseTypeIds, caseTypeRecords, deleteCase,
    dispositionLabel, editCase, editCaseTags, restoreCaseTags, exportCases,
    exportRiskCalibrationDataset, importCases, loadCases, MAX_CASE_IMPORT_BYTES,
    openCase, previewRiskCalibrationDataset, removeCaseBrandProfileAssociation,
    statusLabel, type CaseRecord, type RiskCalibrationExportPreview,
  } from '$lib/cases';
  import LocalCollectionState from '$lib/components/LocalCollectionState.svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import CaseWorkspaceToolbar from '$lib/components/CaseWorkspaceToolbar.svelte';
  import CaseFilters from '$lib/components/CaseFilters.svelte';
  import CaseList from '$lib/components/CaseList.svelte';
  let { initialCases = null, initialMessage = '', onchange }: {
    initialCases?: CaseRecord[] | null;
    initialMessage?: string;
    onchange?: (records: CaseRecord[], state: ParentDomainCampaignSourceState) => void;
  } = $props();
  let cases = $state.raw<CaseRecord[]>(untrack(() => initialCases ?? []));
  let casesSourceState = $state<'loading' | 'ready' | 'unavailable'>(untrack(() => initialCases ? 'ready' : 'loading'));
  let caseMessage = $state(untrack(() => initialMessage));
  const CASE_PAGE_SIZE = 25;
  let pendingNoteCaseIds = $state<string[]>([]);
  let casesRefreshing = $state(false);
  let brandProfiles = $state<BrandProfile[]>([]);
  let brandProfilesUnavailable = $state(true);
  let casePage = $state(1);
  let statusFilter = $state('');
  let dispositionFilter = $state('');
  let caseSearch = $state('');
  let caseSort = $state<'updated' | 'domain' | 'status'>('updated');
  let expandedId = $state('');
  let noteDraft = $state('');
  let tagDraft = $state('');
  let newDomain = $state('');
  let openingCase = $state(false);
  let calibrationCaseIds = $state<string[]>([]);
  let calibrationReview = $state<RiskCalibrationExportPreview | null>(null);
  let calibrationExportBusy = $state(false);
  let guidedDomains = $state<string[]>([]);
  let guidedDomainsTruncated = $state(false);
  let mounted = false;
  const existingCaseDomains = $derived(new Set(cases.map((record) => record.domain)));
  const statusOrder = new Map(CASE_STATUSES.map((item, index) => [item.value, index]));
  const filteredCases = $derived.by(() => {
    const term = caseSearch.trim().toLowerCase();
    return cases.filter(record => {
      if (statusFilter && record.status !== statusFilter)
        return false;
      if (dispositionFilter && record.disposition !== dispositionFilter)
        return false;
      if (term && !record.domain.includes(term) && !caseFreeformTags(record.tags).some(tag => tag.toLowerCase().includes(term)) && !caseTypeRecords(record.tags).some(type => type.label.toLowerCase().includes(term)))
        return false;
      return true;
    }).sort((a, b) => {
      if (caseSort === 'domain')
        return a.domain.localeCompare(b.domain);
      if (caseSort === 'status')
        return (statusOrder.get(a.status) ?? 99) - (statusOrder.get(b.status) ?? 99) || a.domain.localeCompare(b.domain);
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
  });
  const casePageCount = $derived(Math.max(1, Math.ceil(filteredCases.length / CASE_PAGE_SIZE)));
  const currentCasePage = $derived(Math.min(casePage, casePageCount));
  const pagedCases = $derived(filteredCases.slice((currentCasePage - 1) * CASE_PAGE_SIZE, currentCasePage * CASE_PAGE_SIZE));
  function date(value: string) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }
  function setCasePage(value: number) {
    selectionRevision.changed();
    casePage = Math.min(casePageCount, Math.max(1, Math.trunc(value)));
  }
  function changeCaseView(change: () => void) {
    selectionRevision.changed();
    change();
    casePage = 1;
  }
  function showCasePage(record: CaseRecord) {
    const index = filteredCases.findIndex(item => item.id === record.id);
    if (index >= 0)
      casePage = Math.floor(index / CASE_PAGE_SIZE) + 1;
  }
  function caseTagDraft(record: CaseRecord) {
    return caseFreeformTags(record.tags).join(', ');
  }
  function expand(record: CaseRecord) {
    selectionRevision.changed();
    if (expandedId === record.id) {
      expandedId = '';
      return;
    }
    showCasePage(record);
    expandedId = record.id;
    selectConsoleCase(record.id);
    tagDraft = caseTagDraft(record);
    noteDraft = '';
  }
  async function focusCase(record: CaseRecord) {
    await tick();
    const target = document.getElementById(`case-head-${record.id}`);
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  }
  async function focusResponsePreflight(record: CaseRecord) {
    await tick();
    const details = document.getElementById(`case-response-preflight-${record.id}`) as HTMLDetailsElement | null;
    if (!details)
      return;
    details.open = true;
    details.scrollIntoView({ block: 'center' });
    details.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  }
  async function openGuidedCase(domain: string) {
    const editorUnchanged = captureCaseOpeningIntent();
    const responseRequested = page.url.searchParams.get('response') === '1';
    let committed: Awaited<ReturnType<typeof openCase>>;
    try {
      committed = await openCase({ domain, source: 'monitor' });
    }
    catch (cause) {
      caseMessage = cause instanceof Error ? cause.message : 'Could not open the guided case.';
      return;
    }
    const { record, created } = committed;
    await reconcileCommittedCaseSnapshot(committed, created ? `Opened a new case for ${record.domain}.` : `Opened the existing case for ${record.domain}.`);
    if (!mounted || !editorUnchanged())
      return;
    selectConsoleCase(record.id);
    clearCaseFilters();
    casePage = 1;
    showCasePage(record);
    expandedId = record.id;
    tagDraft = caseTagDraft(record);
    noteDraft = '';
    await navigateCase(record.id);
    if (responseRequested)
      await focusResponsePreflight(record);
    else
      await focusCase(record);
  }
  function prunedNote(pruned: number) {
    return pruned ? ` (pruned ${pruned} old evidence snapshot${pruned === 1 ? '' : 's'} to stay within storage)` : '';
  }
  async function trackDomain() {
    if (openingCase)
      return;
    const unchanged = newCaseDraft.capture();
    const domain = newDomain.trim();
    if (!domain) {
      caseMessage = 'Enter a domain to track.';
      return;
    }
    const editorUnchanged = captureCaseOpeningIntent();
    openingCase = true;
    try {
      let committed: Awaited<ReturnType<typeof openCase>>;
      try {
        committed = await openCase({ domain, source: 'monitor' });
      }
      catch (cause) {
        caseMessage = cause instanceof Error ? cause.message : 'Could not open the case.';
        return;
      }
      const { record, created } = committed;
      if (unchanged())
        newDomain = '';
      await reconcileCommittedCaseSnapshot(committed, created ? `Opened a new case for ${record.domain}.` : `${record.domain} already has a case.`);
      if (!mounted || !editorUnchanged())
        return;
      selectConsoleCase(record.id);
      clearCaseFilters();
      casePage = 1;
      showCasePage(record);
      expandedId = record.id;
      tagDraft = caseTagDraft(record);
      noteDraft = '';
      await navigateCase(record.id);
      if (unchanged())
        await focusCase(record);
    }
    finally {
      openingCase = false;
    }
  }
  async function setStatus(record: CaseRecord, value: string) {
    try {
      const committed = await editCase(record.id, { status: value });
      await reconcileCommittedCaseMutation(committed, `Set ${record.domain} to ${statusLabel(value)}.`);
    }
    catch (cause) {
      caseMessage = cause instanceof Error ? cause.message : 'Could not update the case.';
    }
  }
  async function setDisposition(record: CaseRecord, value: string) {
    try {
      const committed = await editCase(record.id, { disposition: value });
      await reconcileCommittedCaseMutation(committed, `Marked ${record.domain} as ${dispositionLabel(value)}.`);
    }
    catch (cause) {
      caseMessage = cause instanceof Error ? cause.message : 'Could not update the case.';
    }
  }
  async function setReviewReason(record: CaseRecord, value: string) {
    try {
      const committed = await editCase(record.id, { reviewReasonCode: value });
      await reconcileCommittedCaseMutation(committed, `Updated the review reason for ${record.domain}.`);
    }
    catch (cause) {
      caseMessage = cause instanceof Error ? cause.message : 'Could not update the review reason.';
    }
  }
  async function changeBrandProfileAssociation(record: CaseRecord, profileId: string, operation: 'add' | 'remove') {
    let persisted: CaseRecord;
    let committedCases: CaseRecord[] = [];
    let pruned = 0;
    try {
      const result = operation === 'add'
        ? await addCaseBrandProfileAssociation(record.id, profileId)
        : await removeCaseBrandProfileAssociation(record.id, profileId);
      persisted = result.record;
      committedCases = result.cases;
      pruned = result.pruned;
    }
    catch (cause) {
      caseMessage = cause instanceof Error ? cause.message : `Could not ${operation} the Brand Profile association.`;
      return false;
    }
    try {
      await refreshCases();
      if (expandedId === persisted.id) showCasePage(persisted);
      caseMessage = `${operation === 'add' ? 'Added' : 'Removed'} an explicit Brand Profile association for ${persisted.domain}.${prunedNote(pruned)}`;
    }
    catch {
      installCommittedCaseSnapshot(committedCases, 'partial');
      if (expandedId === persisted.id) showCasePage(persisted);
      caseMessage = `Brand Profile association saved for ${persisted.domain}, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the browser-local read.${prunedNote(pruned)}`;
    }
    return true;
  }
  function addBrandProfileAssociation(record: CaseRecord, profileId: string) {
    return changeBrandProfileAssociation(record, profileId, 'add');
  }
  function removeBrandProfileAssociation(record: CaseRecord, profileId: string) {
    return changeBrandProfileAssociation(record, profileId, 'remove');
  }
  async function saveTags(record: CaseRecord) {
    const previous = [...record.tags];
    const submittedDraft = tagDraft;
    const unchanged = tagRevision.capture();
    try {
      const next = caseTagsWithTypes(submittedDraft.split(/[,\n]+/).map(value => value.trim()).filter(Boolean), caseTypeIds(record.tags));
      if (previous.join('\\0') === next.join('\\0'))
        return;
      const committed = await editCaseTags(record.id, next);
      if (unchanged())
        tagDraft = caseTagDraft(committed.record);
      await reconcileCommittedCaseSnapshot(committed, `Updated tags for ${record.domain}.`, expandedId === record.id ? committed.record : null);
      registerAnalystUndo({
        kind: 'case_tags', action: 'Case tags updated', affectedRecord: record.domain,
        undo: async () => {
          const unchangedUndo = tagRevision.capture();
          const restored = await restoreCaseTags(committed.undo);
          if (expandedId === restored.record.id && unchangedUndo())
            tagDraft = caseTagDraft(restored.record);
          await reconcileCommittedCaseSnapshot(restored, `Restored the previous tags for ${record.domain}.`, expandedId === restored.record.id ? restored.record : null);
          return `Restored the previous tags for ${record.domain}.`;
        },
      });
    }
    catch (cause) {
      caseMessage = cause instanceof Error ? cause.message : 'Could not update tags.';
    }
  }
  async function addNote(record: CaseRecord) {
    if (pendingNoteCaseIds.includes(record.id))
      return;
    const unchanged = noteRevision.capture();
    const body = noteDraft.trim();
    if (!body) {
      caseMessage = 'A note cannot be empty.';
      return;
    }
    pendingNoteCaseIds = [...pendingNoteCaseIds, record.id];
    caseMessage = `Adding a note to ${record.domain}…`;
    try {
      let committed: Awaited<ReturnType<typeof addCaseNote>>;
      try {
        committed = await addCaseNote(record.id, body);
      }
      catch (cause) {
        caseMessage = cause instanceof Error ? cause.message : 'Could not add the note.';
        return;
      }
      if (unchanged())
        noteDraft = '';
      await reconcileCommittedCaseSnapshot(committed, `Added a note to ${record.domain}.`, expandedId === record.id ? committed.record : null);
    }
    finally {
      pendingNoteCaseIds = pendingNoteCaseIds.filter((id) => id !== record.id);
    }
  }
  async function downloadCases() {
    try {
      await exportCases();
    }
    catch (cause) {
      caseMessage = cause instanceof Error ? cause.message : 'Could not export cases.';
    }
  }
  function toggleCalibrationCase(record: CaseRecord, selected: boolean) {
    calibrationReview = null;
    calibrationCaseIds = selected ? [...new Set([...calibrationCaseIds, record.id])] : calibrationCaseIds.filter(id => id !== record.id);
  }
  async function reviewCalibrationDataset() {
    try {
      calibrationReview = await previewRiskCalibrationDataset(calibrationCaseIds);
    }
    catch (cause) {
      caseMessage = cause instanceof Error ? cause.message : 'Could not review the Risk calibration dataset.';
    }
  }
  async function downloadCalibrationDataset() {
    calibrationExportBusy = true;
    try {
      const result = await exportRiskCalibrationDataset(calibrationCaseIds);
      calibrationReview = null;
      caseMessage = `Exported ${result.included} reviewed case${result.included === 1 ? '' : 's'} for offline Risk calibration${result.excluded ? `; excluded ${result.excluded} incompatible selection${result.excluded === 1 ? '' : 's'}` : ''}. No model setting was changed.`;
    }
    catch (cause) {
      caseMessage = cause instanceof Error ? cause.message : 'Could not export the Risk calibration dataset.';
    }
    finally {
      calibrationExportBusy = false;
    }
  }
  async function removeCase(record: CaseRecord) {
    if (!confirm(`Delete the case for ${record.domain}? Its notes are removed unless you exported them.`))
      return;
    let committed: Awaited<ReturnType<typeof deleteCase>>;
    try {
      committed = await deleteCase(record.id);
    }
    catch (cause) {
      caseMessage = cause instanceof Error ? cause.message : 'Could not delete the case.';
      return;
    }
    if (expandedId === record.id)
      expandedId = '';
    try {
      await refreshCases();
      caseMessage = `Deleted the case for ${record.domain}.`;
    }
    catch {
      installCommittedCaseSnapshot(committed.cases, 'partial');
      caseMessage = `Deleted the case for ${record.domain}. The change was saved, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the browser-local read.`;
    }
  }
  function clearCaseFilters() {
    statusFilter = '';
    dispositionFilter = '';
    caseSearch = '';
  }
  async function importCaseFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file)
      return;
    try {
      if (file.size > MAX_CASE_IMPORT_BYTES)
        throw new Error('Case imports are limited to 2 MB.');
      const result = await importCases(parseBoundedJson(await file.text(), { label: 'Case import', maximumBytes: MAX_CASE_IMPORT_BYTES }));
      const success = `Imported ${result.added} new and ${result.updated} merged cases${result.skipped ? `; skipped ${result.skipped} invalid or over-limit record${result.skipped === 1 ? '' : 's'}` : ''}${result.brandProfileReferencesOmitted ? `; omitted ${result.brandProfileReferencesOmitted} Brand Profile reference${result.brandProfileReferencesOmitted === 1 ? '' : 's'} beyond the retained bounds` : ''}${result.authoredHistoryOmitted ? `; omitted ${result.authoredHistoryOmitted} malformed, duplicate or over-limit authored-history record${result.authoredHistoryOmitted === 1 ? '' : 's'}` : ''}.`;
      await reconcileCommittedCaseSnapshot(result, success);
    }
    catch (cause) {
      caseMessage = cause instanceof Error ? cause.message : 'Case import failed';
    }
    finally {
      input.value = '';
    }
  }
  function restoreGuidedQueueTarget() {
    if (page.url.hash !== '#case-review-queue')
      return;
    const target = document.getElementById('case-review-queue');
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  }
  async function restoreCaseListTarget() {
    const caseId = page.url.searchParams.get('case');
    if (!caseId || caseId !== expandedId || page.url.hash === `#case-response-${encodeURIComponent(caseId)}`)
      return;
    const target = cases.find((record) => record.id === caseId);
    if (target)
      await focusCase(target);
  }
  const newCaseDraft = createDraftRevision(() => 'new-case');
  const tagRevision = createDraftRevision(() => expandedId);
  const noteRevision = createDraftRevision(() => expandedId);
  const selectionRevision = createDraftRevision(() => expandedId);
  function captureCaseOpeningIntent() {
    selectionRevision.changed();
    const selected = selectionRevision.capture();
    const note = noteRevision.capture();
    const tags = tagRevision.capture();
    return () => selected() && note() && tags();
  }
  async function navigateCase(id: string) {
    const destination = page.url.pathname === '/monitor'
      ? buildMonitorNavigationUrl(page.url, 'cases', { parameter: 'case', value: id })
      : `/cases?case=${encodeURIComponent(id)}`;
    appliedRouteKey = monitorRouteKey(new URL(destination, page.url));
    await goto(destination, { noScroll: true, keepFocus: true });
  }
  async function refreshCases() {
    const hadSnapshot = casesSourceState === 'ready';
    casesRefreshing = true;
    try {
      installCommittedCaseSnapshot(await loadCases());
    }
    catch (cause) {
      if (!hadSnapshot)
        casesSourceState = 'unavailable';
      const state = hadSnapshot ? 'partial'
        : cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_FUTURE_SCHEMA' ? 'future_schema' : 'unavailable';
      onchange?.(cases, state);
      throw cause;
    }
    finally {
      casesRefreshing = false;
    }
  }
  function installCommittedCaseSnapshot(records: CaseRecord[], state: ParentDomainCampaignSourceState = 'ready') {
    cases = records;
    casesSourceState = 'ready';
    calibrationCaseIds = calibrationCaseIds.filter(id => records.some(record => record.id === id));
    if (expandedId && !records.some(record => record.id === expandedId))
      expandedId = '';
    onchange?.(records, state);
  }
  async function reconcileCommittedCaseSnapshot(committed: {
    cases: CaseRecord[];
    pruned: number;
  }, success: string, record: CaseRecord | null = null) {
    try {
      await refreshCases();
      if (record && expandedId === record.id)
        showCasePage(record);
      caseMessage = `${success}${prunedNote(committed.pruned)}`;
    }
    catch {
      installCommittedCaseSnapshot(committed.cases, 'partial');
      if (record && expandedId === record.id)
        showCasePage(record);
      caseMessage = `${success} The change was saved, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the browser-local read.${prunedNote(committed.pruned)}`;
    }
  }
  async function reconcileCommittedCaseMutation(committed: Awaited<ReturnType<typeof editCase>>, success: string) {
    await reconcileCommittedCaseSnapshot(committed, success, committed.record);
  }
  let appliedRouteKey = '';
  async function applyCaseTarget(currentUrl: URL, routeKey: string) {
    if (routeKey === appliedRouteKey || casesSourceState === 'loading')
      return;
    const target = monitorRouteTarget(currentUrl);
    selectionRevision.changed();
    appliedRouteKey = routeKey;
    if (casesSourceState !== 'ready')
      return;
    if (target.kind === 'case') {
      const record = cases.find(record => record.id === target.id);
      if (!record) {
        expandedId = '';
        selectConsoleCase(null);
        caseMessage = 'That Case is not available in this browser workspace. Choose a retained Case or import its workspace archive.';
        return;
      }
      clearCaseFilters();
      selectConsoleCase(record.id);
      casePage = 1;
      showCasePage(record);
      if (expandedId !== record.id) {
        expandedId = record.id;
        tagDraft = caseTagDraft(record);
        noteDraft = '';
      }
      await tick();
      if (monitorRouteKey(page.url) !== routeKey)
        return;
      const workspace = document.getElementById(`case-response-${record.id}`);
      if (target.responseHash && workspace) {
        workspace.scrollIntoView({ block: 'start' });
        workspace.focus({ preventScroll: true });
      }
      else
        await focusCase(record);
      return;
    }
    guidedDomains = [];
    guidedDomainsTruncated = false;
    if (target.kind === 'investigation') {
      const guide = loadInvestigationGuide();
      const carried = guide?.recipeId === 'brand_sweep' ? (guide.focusDomain ? [guide.focusDomain] : []) : guide?.reviewDomains ?? [];
      guidedDomains = [...new Set([...carried, target.domain].filter(Boolean))];
      guidedDomainsTruncated = Boolean(guide?.reviewDomainsTruncated);
      await tick();
      if (monitorRouteKey(page.url) === routeKey && target.restoreQueue)
        restoreGuidedQueueTarget();
    }
    else if (target.kind === 'domain')
      newDomain = target.domain;
  }
  $effect(() => {
    const currentUrl = new URL(page.url);
    const routeKey = monitorRouteKey(currentUrl);
    cases;
    casesSourceState;
    untrack(() => {
      void applyCaseTarget(currentUrl, routeKey);
    });
  });
  onMount(() => {
    mounted = true;
    const preloadController = new AbortController();
    preloadBestEffort(() => import('$lib/components/CaseResponseWorkspace.svelte'), preloadController.signal);
    void refreshCases().catch(cause => {
      caseMessage = cause instanceof Error ? cause.message : 'Could not read browser-local Cases.';
    });
    void loadProfiles().then(profiles => {
      brandProfiles = profiles;
      brandProfilesUnavailable = false;
    }).catch(() => {
      brandProfilesUnavailable = true;
    });
    return () => {
      mounted = false;
      preloadController.abort();
    };
  });
</script>
<section class="case-workspace" data-case-workspace aria-label="Cases" aria-busy={casesRefreshing}>
  {#if casesSourceState === 'ready'}
    {#if casesRefreshing}
      <p class="refresh-status" role="status" aria-live="polite">Refreshing Cases while the last readable snapshot remains available.</p>
    {/if}
    {#if guidedDomains.length}
      <DeferredSurface load={() => import('$lib/components/GuidedCaseQueue.svelte')}
        loadingLabel="Loading guided Case queue…" unavailableLabel="The guided Case queue could not be loaded."
        onready={restoreGuidedQueueTarget}
        props={{ domains: guidedDomains, existingDomains: existingCaseDomains, truncated: guidedDomainsTruncated, openDomain: openGuidedCase }} />
    {/if}
    <CaseWorkspaceToolbar
      domain={newDomain} setDomain={(value) => { newCaseDraft.changed(); newDomain = value; }}
      {trackDomain} {openingCase} caseCount={cases.length} calibrationSelectedCount={calibrationCaseIds.length}
      {downloadCases} {reviewCalibrationDataset} {importCaseFile} message={caseMessage} />
    {#if calibrationReview}
      <DeferredSurface load={() => import('$lib/components/CalibrationExportReview.svelte')}
        loadingLabel="Loading calibration export review…" unavailableLabel="Calibration export review could not be loaded."
        props={{ preview: calibrationReview, busy: calibrationExportBusy, confirm: downloadCalibrationDataset,
          cancel: () => { if (!calibrationExportBusy) calibrationReview = null; } }} />
    {/if}

    {#if cases.length}
      <CaseFilters
        status={statusFilter} setStatus={(value) => changeCaseView(() => statusFilter = value)}
        disposition={dispositionFilter} setDisposition={(value) => changeCaseView(() => dispositionFilter = value)}
        search={caseSearch} setSearch={(value) => changeCaseView(() => caseSearch = value)}
        sort={caseSort} setSort={(value) => changeCaseView(() => caseSort = value)}
        statusOptions={CASE_STATUSES} dispositionOptions={CASE_DISPOSITIONS}
        clear={() => changeCaseView(clearCaseFilters)} matchedCount={filteredCases.length} totalCount={cases.length} />

      <CaseList
        onready={restoreCaseListTarget} records={pagedCases} allRecords={cases} {expandedId}
        {tagDraft} setTagDraft={(value) => { tagRevision.changed(); tagDraft = value; }}
        {noteDraft} setNoteDraft={(value) => { noteRevision.changed(); noteDraft = value; }}
        {pendingNoteCaseIds} {calibrationCaseIds} {toggleCalibrationCase} {expand}
        {setStatus} {setDisposition} {setReviewReason} {addBrandProfileAssociation} {removeBrandProfileAssociation}
        {saveTags} {addNote} {removeCase} {refreshCases} {installCommittedCaseSnapshot}
        setMessage={(value) => caseMessage = value} formatDate={date}
        currentPage={currentCasePage} pageCount={casePageCount} setPage={setCasePage}
        {brandProfiles} {brandProfilesUnavailable}
        responseCaseId={page.url.hash === `#case-response-${encodeURIComponent(expandedId)}`
          || (page.url.searchParams.get('response') === '1' && page.url.searchParams.get('case') === expandedId) ? expandedId : ''} />
    {:else}
      <section class="empty-state card">
        <h2>No cases yet</h2>
        <p>Retain evidence from Lookup or Bulk, or enter a domain above.</p>
        <a href="/lookup">Open Lookup →</a>
      </section>
    {/if}
    <details class="advanced-case-tools">
      <summary>Advanced Case tools</summary>
      <p>Calibration is a secondary reference for reviewing how triage performed.</p>
      <DeferredSurface load={() => import('$lib/components/RiskCalibrationDashboard.svelte')} props={{}}
        loadingLabel="Loading risk-calibration reference…" unavailableLabel="Risk-calibration reference could not be loaded." />
    </details>
    <DeferredSurface load={() => import('$lib/components/ExternalFindingsImport.svelte')}
      loadingLabel="Loading external-findings import…" unavailableLabel="External-findings import could not be loaded."
      props={{ cases, oncomplete: refreshCases, oncommitted: installCommittedCaseSnapshot, onmessage: (value: string) => caseMessage = value }} />
  {:else}
    <LocalCollectionState state={casesSourceState} title="Cases unavailable" detail="Browser-local cases could not be read, so the count, empty state, imports, and mutations remain unavailable. Reload to retry without overwriting unknown saved work." />
  {/if}
</section>

<style>
  .case-workspace { min-width: 0; --control-h: 44px; }
  .refresh-status { margin: 10px 2px; color: var(--muted); font-size: var(--text-xs); }
  .advanced-case-tools { margin: 16px 0; padding-block: 12px; border-block: 1px solid var(--border); }
  .advanced-case-tools summary { cursor: pointer; font: 650 var(--text-sm) var(--mono); }
  .advanced-case-tools > p { color: var(--muted); font-size: var(--text-sm); }
</style>
