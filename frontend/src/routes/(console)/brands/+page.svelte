<script lang="ts">
  import { formatEvidenceDate } from '$lib/analysis/evidence-time.ts';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { getContext, onDestroy, onMount, tick } from 'svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import BrandProfileList from '$lib/components/BrandProfileList.svelte';
  import BrandProfileEditor from '$lib/components/BrandProfileEditor.svelte';
  import BrandAllowlistManager from '$lib/components/BrandAllowlistManager.svelte';
  import BrandReviewInbox from '$lib/components/BrandReviewInbox.svelte';
  import BrandAssetRegisterSummary from '$lib/components/BrandAssetRegisterSummary.svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import {
    activeProfileId,
    deleteProfile,
    exportProfiles,
    importProfileFile,
    isBrandProfileMutationCommittedError,
    loadProfiles,
    normalizeProfile,
    parseList,
    setActiveProfile,
    updateProfileFields,
    upsertProfile,
    type BrandProfile,
    type BrandProfileSaveResult,
  } from '$lib/brand-profiles';
  import { LocalRecordConflictError } from '$lib/local-mutation-outcome';
  import { createPageBaseline } from '$lib/analysis/page-baseline.ts';
  import { loadCases, type CaseRecord } from '$lib/cases';
  import {
    loadRelationshipObservations,
    type RelationshipObservation,
  } from '$lib/relationship-observations';
  import { BrowserLocalDataError } from '$lib/browser-local-data-content.ts';
  import type {
    DesiredPostureBaseline,
    ProtectionAttestation,
  } from '$lib/analysis/brand-profile-model.ts';
  import {
    brandPostureCollectionFingerprint,
    brandPostureObservationContext,
    currentDesiredPostureObservation,
    desiredPostureObservations,
    normalizeDesiredPostureObservationHistory,
  } from '$lib/analysis/brand-profile-model.ts';
  import {
    buildDesiredPostureObservation,
    officialDomainReviewBatch,
    type DomainPostureAuditResult as AuditResult,
  } from '$lib/analysis/owned-domain-posture-review.ts';
  import {
    brandProfileDeletionImpact,
    buildBrandReviewInbox,
    type BrandReviewSourceState,
  } from '$lib/analysis/brand-review-inbox.ts';
  import { buildBrandAssetRegister } from '$lib/analysis/brand-asset-register.ts';
  import {
    clientHttpErrorMessage,
    parseAvailabilityCaptureResponse,
    parseDomainPostureHttpResponse,
    type DomainPostureHttpResponse,
  } from '$lib/analysis/client-response-contracts';
  import { CAPABILITY_CONTEXT, disabledCapability, type CapabilityGetter } from '$lib/capabilities';
  import {
    LARGE_JSON_RESPONSE_BYTES,
    requestJsonCapped,
    STANDARD_JSON_RESPONSE_BYTES,
  } from '$lib/bounded-json-response';
  import { preloadBestEffort } from '$lib/idle-preload';
  import { restoreSubmittedFocus } from '$lib/controllers/submitted-draft';
  import {
    BrandProfileEditorController,
    type BrandProfileCommitIssue,
  } from '$lib/controllers/brand-profile-editor.ts';
  const pageController = new AbortController();
  const preloadModule = (load: () => Promise<unknown>) =>
    preloadBestEffort(load, pageController.signal);
  onDestroy(() => pageController.abort());
  const BRAND_VIEWS = [
    { id: 'overview', label: 'Overview' },
    { id: 'assets', label: 'Assets' },
    { id: 'tools', label: 'Tools' },
  ] as const;
  type BrandsView = (typeof BRAND_VIEWS)[number]['id'];
  const brandWorkbenches = {
    control: {
      label: 'Domain controls',
      load: () => import('$lib/components/DomainControlCentre.svelte'),
      retainDraft: false,
    },
    portfolio: {
      label: 'Compare owned domains',
      load: () => import('$lib/components/BrandPortfolioPostureMatrix.svelte'),
      retainDraft: false,
    },
    posture: {
      label: 'Review current settings',
      load: () => import('$lib/components/BrandPostureAudit.svelte'),
      retainDraft: false,
    },
    baselines: {
      label: 'Expected domain settings',
      load: () => import('$lib/components/BrandDesiredPostureBaselines.svelte'),
      retainDraft: true,
    },
    passport: {
      label: 'Portable domain settings',
      load: () => import('$lib/components/BrandDomainControlPassport.svelte'),
      retainDraft: true,
    },
    certificates: {
      label: 'Certificate events',
      load: () => import('$lib/components/BrandCertificateEventReplay.svelte'),
      retainDraft: false,
    },
    attestations: {
      label: 'Reviewed account controls',
      load: () => import('$lib/components/BrandProtectionAttestations.svelte'),
      retainDraft: true,
    },
    mail: {
      label: 'Mail reports',
      load: () => import('$lib/components/MailReportWorkbench.svelte'),
      retainDraft: true,
    },
  } as const;
  type BrandWorkbench = keyof typeof brandWorkbenches;
  const brandWorkbenchOptions = (Object.keys(brandWorkbenches) as BrandWorkbench[]).map((id) => ({
    id,
    label: brandWorkbenches[id].label,
  }));
  function resolveBrandWorkbench(value: string | null): BrandWorkbench | null {
    return brandWorkbenchOptions.find((option) => option.id === value)?.id ?? null;
  }
  let profiles = $state<BrandProfile[]>([]);
  let activeId = $state('');
  let message = $state('');
  let auditing = $state(false);
  let auditResults = $state<AuditResult[]>([]);
  const profileEditor = new BrandProfileEditorController({
    publish: (next) => (editorState = next),
    message: (next) => (message = next),
    clearMessage: (expected) => {
      if (message === expected) message = '';
    },
  });
  let editorState = $state.raw(profileEditor.state);
  const editing = $derived(editorState.editingId);
  const showForm = $derived(editorState.visible);
  const savingProfile = $derived(editorState.saving);
  let draftProfile = $state.raw<BrandProfile | null>(null);
  let profileMutationPending = $state(false);
  let profileRefreshRequired = $state(false);
  let refreshingProfiles = $state(false);
  let auditGeneration = 0;
  let auditController: AbortController | null = null;
  let baselineMutationFocus: { profileId: string; origin: Element | null } | null = null;
  let cases = $state<CaseRecord[]>([]);
  let relationships = $state<RelationshipObservation[]>([]);
  let profileSourceState = $state<BrandReviewSourceState>('loading');
  let caseSourceState = $state<BrandReviewSourceState>('loading');
  let relationshipSourceState = $state<BrandReviewSourceState>('loading');
  let activePreferenceSourceState = $state<BrandReviewSourceState>('loading');
  let certificateReplayUnavailable = $state(false);
  const capabilityReport = getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const siteIdentityDisabled = $derived(
    disabledCapability(capabilityReport?.() || null, 'availability') ||
      disabledCapability(capabilityReport?.() || null, 'website_probe'),
  );
  const postureDisabled = $derived(
    disabledCapability(capabilityReport?.() || null, 'domain_posture'),
  );
  const active = $derived(
    profileSourceState === 'ready' && activePreferenceSourceState === 'ready'
      ? profiles.find((p) => p.id === activeId) || null
      : null,
  );
  const profileWriteDisabled = $derived(
    profileMutationPending || profileRefreshRequired || profileSourceState !== 'ready',
  );
  const draftWriteDisabled = $derived(profileWriteDisabled || active?.id !== draftProfile?.id);
  const orphanedProfileDraft = $derived(
    Boolean(
      showForm &&
      editing &&
      profileSourceState === 'ready' &&
      !profiles.some((profile) => profile.id === editing),
    ),
  );
  const brandsView = $derived.by<BrandsView>(() => {
    const requested = BRAND_VIEWS.find((view) => view.id === page.url.searchParams.get('view'));
    return requested?.id ?? (brandWorkbench ? 'tools' : 'overview');
  });
  let profilesOpen = $state(true);
  $effect(() => {
    profilesOpen = brandsView === 'overview';
  });
  const brandWorkbench = $derived.by<BrandWorkbench | null>(() => {
    if (page.url.searchParams.has('baseline')) return 'baselines';
    return resolveBrandWorkbench(page.url.searchParams.get('workbench'));
  });
  let openedDraftTools = $state<{ profileId: string; tools: BrandWorkbench[] }>({
    profileId: '',
    tools: [],
  });
  $effect(() => {
    const profileId = draftProfile?.id || '';
    if (openedDraftTools.profileId !== profileId) openedDraftTools = { profileId, tools: [] };
    if (
      brandWorkbench &&
      brandWorkbenches[brandWorkbench].retainDraft &&
      !openedDraftTools.tools.includes(brandWorkbench)
    ) {
      openedDraftTools = { profileId, tools: [...openedDraftTools.tools, brandWorkbench] };
    }
  });
  const brandReviewInbox = $derived(
    buildBrandReviewInbox({
      cases,
      profiles,
      activeProfileId: activeId,
      sourceStates: {
        cases: caseSourceState,
        profiles: profileSourceState,
        activePreference: activePreferenceSourceState,
      },
    }),
  );
  const brandAssetRegister = $derived(
    buildBrandAssetRegister({
      profiles,
      activeProfileId: activeId,
      cases,
      relationships,
      sourceStates: {
        profiles: profileSourceState,
        activePreference: activePreferenceSourceState,
        cases: caseSourceState,
        relationships: relationshipSourceState,
      },
    }),
  );
  const localContextStatus = $derived(
    [
      profileSourceState === 'unavailable' ? 'Saved Brand Profiles could not be read.' : null,
      activePreferenceSourceState === 'unavailable'
        ? 'The active-profile preference could not be read; profile-scoped tools are suppressed.'
        : null,
      caseSourceState === 'unavailable'
        ? 'Cases could not be read, so linked-case context cannot be checked or displayed.'
        : null,
      relationshipSourceState === 'unavailable'
        ? 'Retained relationship observations could not be read, so Brand asset relationship coverage is partial.'
        : null,
    ]
      .filter(Boolean)
      .join(' '),
  );
  const hasBrandWorkspace = $derived(
    Boolean(
      profiles.length ||
      cases.length ||
      relationships.length ||
      activeId ||
      draftProfile ||
      localContextStatus ||
      brandsView !== 'overview' ||
      [
        profileSourceState,
        caseSourceState,
        relationshipSourceState,
        activePreferenceSourceState,
      ].includes('loading'),
    ),
  );
  const siteIdentityReason = $derived(
    siteIdentityDisabled
      ? siteIdentityDisabled.reason || 'Website checks are disabled by deployment policy.'
      : '',
  );
  const postureReason = $derived(
    postureDisabled
      ? postureDisabled.reason || 'Official-domain settings review is disabled by deployment policy.'
      : '',
  );
  function closeActivePreferenceSource() {
    cancelAudit();
    activeId = '';
    auditResults = [];
    activePreferenceSourceState = 'unavailable';
    profileRefreshRequired = true;
  }
  function closeProfileSource() {
    cancelAudit();
    cancelIdentityCapture();
    profiles = [];
    profileSourceState = 'unavailable';
    profileRefreshRequired = true;
  }
  function closeCaseSource() {
    cases = [];
    caseSourceState = 'unavailable';
    certificateReplayUnavailable = true;
  }
  function closeRelationshipSource() {
    relationships = [];
    relationshipSourceState = 'unavailable';
  }
  function profileFailureMessage(cause: unknown, fallback: string) {
    if (cause instanceof BrowserLocalDataError) {
      closeProfileSource();
      return `${fallback} ${cause.message} Saved Brand Profiles are unavailable; reload to retry.`;
    }
    return cause instanceof Error ? cause.message : fallback;
  }
  async function refreshProfiles() {
    cancelAudit();
    refreshingProfiles = true;
    profileSourceState = 'loading';
    activePreferenceSourceState = 'loading';
    profiles = [];
    activeId = '';
    auditResults = [];
    const [profileResult, preferenceResult] = await Promise.allSettled([
      loadProfiles(),
      Promise.resolve().then(() => activeProfileId()),
    ]);
    if (profileResult.status === 'fulfilled') {
      profiles = profileResult.value;
      profileSourceState = 'ready';
    } else closeProfileSource();
    if (preferenceResult.status === 'fulfilled') {
      activeId = preferenceResult.value;
      activePreferenceSourceState = 'ready';
    } else closeActivePreferenceSource();
    refreshingProfiles = false;
    if (profileResult.status === 'rejected') throw profileResult.reason;
    if (preferenceResult.status === 'rejected') throw preferenceResult.reason;
    const selected = profileResult.value.find(
      (profile) => profile.id === (draftProfile?.id || preferenceResult.value),
    );
    if (selected) draftProfile = selected;
    profileRefreshRequired = false;
    return profileResult.value;
  }
  async function retryProfiles() {
    if (profileMutationPending || refreshingProfiles) return;
    const origin = document.activeElement;
    try {
      await refreshProfiles();
      message =
        'Refreshed saved profiles. Unsaved drafts are unchanged; reopen an editor to review the current saved values.';
    } catch {
      message = 'Saved profiles could not be refreshed. Unsaved drafts remain available.';
    }
    await tick();
    restoreSubmittedFocus(
      origin,
      document.getElementById('refresh-brand-profiles') ||
        document.getElementById('brand-profile-name') ||
        document.getElementById('new-brand-profile'),
      document.getElementById('new-brand-profile'),
    );
  }
  async function refreshCasesForBrands() {
    caseSourceState = 'loading';
    cases = [];
    certificateReplayUnavailable = true;
    try {
      const loaded = await loadCases();
      cases = loaded;
      caseSourceState = 'ready';
      certificateReplayUnavailable = false;
      return loaded;
    } catch (cause) {
      closeCaseSource();
      throw cause;
    }
  }
  async function refreshRelationshipsForBrands() {
    relationshipSourceState = 'loading';
    relationships = [];
    try {
      const loaded = await loadRelationshipObservations();
      relationships = loaded;
      relationshipSourceState = 'ready';
      return loaded;
    } catch (cause) {
      closeRelationshipSource();
      throw cause;
    }
  }
  function preloadBrandsView(next: BrandsView) {
    if (next === 'assets') preloadModule(() => import('$lib/components/BrandAssetRegister.svelte'));
  }
  async function selectBrandsView(next: BrandsView) {
    preloadBrandsView(next);
    if (next === brandsView) return;
    const url = new URL(page.url);
    if (next === 'overview' && !brandWorkbench) url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    if (next !== 'assets')
      for (const parameter of ['assetClass', 'assetSource', 'assetEvidence', 'assetPage'])
        url.searchParams.delete(parameter);
    url.hash = '';
    await goto(`${url.pathname}${url.search}`, { noScroll: true, keepFocus: true });
  }
  async function chooseProfile() {
    profilesOpen = true;
    await tick();
    document.getElementById('brand-profiles-summary')?.focus();
  }
  function preloadBrandWorkbench(next: string) {
    const selected = resolveBrandWorkbench(next);
    if (selected) preloadModule(brandWorkbenches[selected].load);
  }
  async function selectBrandWorkbench(next: string) {
    const url = new URL(page.url);
    const selected = resolveBrandWorkbench(next);
    if (selected) preloadBrandWorkbench(selected);
    if (selected) url.searchParams.set('workbench', selected);
    else url.searchParams.delete('workbench');
    if (selected !== 'baselines') url.searchParams.delete('baseline');
    if (selected) url.searchParams.delete('view');
    else url.searchParams.set('view', 'tools');
    for (const parameter of ['assetClass', 'assetSource', 'assetEvidence', 'assetPage'])
      url.searchParams.delete(parameter);
    url.hash =
      selected === 'baselines' && page.url.hash === '#desired-posture-baseline' ? page.url.hash : '';
    await goto(`${url.pathname}${url.search}${url.hash}`, { noScroll: true, keepFocus: true });
  }
  function restoreBaselineMutationFocus(): boolean {
    const pending = baselineMutationFocus;
    if (!pending) return false;
    if (document.activeElement !== document.body && document.activeElement !== pending.origin) {
      baselineMutationFocus = null;
      return false;
    }
    if (profileSourceState === 'unavailable') {
      baselineMutationFocus = null;
      document.getElementById('brand-profile-source-state')?.focus({ preventScroll: true });
      return true;
    }
    if (active && active.id !== pending.profileId) {
      baselineMutationFocus = null;
      return false;
    }
    const editor = document.getElementById('desired-posture-baseline');
    const target = document.getElementById('save-desired-posture-settings');
    if (
      editor?.dataset.profileId !== pending.profileId ||
      !(target instanceof HTMLButtonElement) ||
      target.disabled
    )
      return false;
    baselineMutationFocus = null;
    target.focus({ preventScroll: true });
    return true;
  }
  async function deferredBrandReady() {
    await tick();
    if (restoreBaselineMutationFocus()) return;
    const hash = page.url.hash;
    if (!hash.startsWith('#') || hash.length > 257) return;
    let targetId = '';
    try {
      targetId = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    const target = document.getElementById(targetId);
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  }
  function brandsViewKeydown(event: KeyboardEvent) {
    const views = BRAND_VIEWS.map((view) => view.id);
    const current = views.indexOf(brandsView);
    let index = -1;
    if (event.key === 'ArrowRight') index = (current + 1) % views.length;
    else if (event.key === 'ArrowLeft') index = (current + views.length - 1) % views.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = views.length - 1;
    if (index < 0) return;
    const next = views[index];
    if (!next) return;
    event.preventDefault();
    void selectBrandsView(next);
    const tablist = (event.currentTarget as HTMLButtonElement).closest('[role="tablist"]');
    requestAnimationFrame(() =>
      tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus(),
    );
  }
  async function focusEditor() {
    await tick();
    document.getElementById('brand-profile-name')?.focus();
  }
  function cancelIdentityCapture() {
    profileEditor.cancelCapture();
  }
  function clearForm(prefillDomain = '') {
    profileEditor.create(prefillDomain);
    void focusEditor();
  }
  function edit(profile: BrandProfile) {
    profileEditor.edit($state.snapshot(profile));
    void focusEditor();
  }
  type ProfileCommitIssue = BrandProfileCommitIssue;
  type ProfileCommitOptions = Readonly<{
    preserveCompletedAudit?: boolean;
    expected?: BrandProfile | null;
  }>;
  type CompletedAuditSnapshot = Readonly<{
    profileId: string;
    profileFingerprint: string;
    results: readonly AuditResult[];
  }>;
  function captureCompletedAudit(): CompletedAuditSnapshot | null {
    const current = active;
    if (!current || auditing || auditController !== null || !auditResults.length) return null;
    return {
      profileId: current.id,
      profileFingerprint: auditProfileFingerprint(current),
      results: [...auditResults],
    };
  }
  function restoreCompletedAudit(snapshot: CompletedAuditSnapshot | null) {
    if (!snapshot || profileSourceState !== 'ready' || activePreferenceSourceState !== 'ready')
      return;
    const current = profiles.find((profile) => profile.id === activeId) || null;
    if (
      !current ||
      current.id !== snapshot.profileId ||
      auditProfileFingerprint(current) !== snapshot.profileFingerprint
    )
      return;
    auditResults = [...snapshot.results];
  }
  function installCommittedProfileSnapshot(committedProfiles: readonly BrandProfile[]) {
    cancelAudit();
    profiles = [...committedProfiles];
    profileSourceState = 'ready';
    closeActivePreferenceSource();
  }
  function committedIssueText(issue: Exclude<ProfileCommitIssue, null>, noun = 'profile write') {
    return issue === 'active-preference'
      ? `The ${noun} was committed, but the active-profile preference could not be updated or reread. Refresh saved profiles before using profile-scoped tools.`
      : `The ${noun} was committed, but Brand Profiles could not be reread. Refresh saved profiles to retry the read, not the write.`;
  }
  function profileWriteFailureMessage(cause: unknown, fallback: string) {
    if (cause instanceof LocalRecordConflictError) profileRefreshRequired = true;
    if (
      cause instanceof BrowserLocalDataError &&
      (cause.code === 'LOCAL_DATA_QUOTA' ||
        cause.code === 'LOCAL_DATA_WRITE_FAILED' ||
        cause.code === 'LOCAL_DATA_PREPARATION_FAILED')
    )
      return `${fallback} ${cause.message}`;
    return profileFailureMessage(cause, fallback);
  }
  async function commitProfileMutation(
    write: () => Promise<BrandProfile>,
    options: ProfileCommitOptions,
  ): Promise<{ profile: BrandProfile; issue: ProfileCommitIssue }> {
    if (profileWriteDisabled)
      throw new Error(
        'A profile write is pending or the saved profiles need to be refreshed. The draft is unchanged.',
      );
    const origin = document.activeElement;
    profileMutationPending = true;
    const completedAudit = options.preserveCompletedAudit ? captureCompletedAudit() : null;
    cancelAudit();
    try {
      let profile: BrandProfile;
      try {
        profile = await write();
      } catch (cause) {
        if (
          !isBrandProfileMutationCommittedError(cause) ||
          cause.operation !== 'save' ||
          !cause.profile
        ) {
          if (cause instanceof LocalRecordConflictError) profileRefreshRequired = true;
          restoreCompletedAudit(completedAudit);
          throw cause;
        }
        installCommittedProfileSnapshot(cause.profiles);
        restoreCompletedAudit(completedAudit);
        return { profile: cause.profile, issue: 'active-preference' };
      }
      try {
        await refreshProfiles();
        restoreCompletedAudit(completedAudit);
        return { profile, issue: null };
      } catch {
        restoreCompletedAudit(completedAudit);
        return {
          profile,
          issue: profileSourceState === 'unavailable' ? 'reread' : 'active-preference',
        };
      }
    } finally {
      profileMutationPending = false;
      if (profileRefreshRequired) {
        await tick();
        const recovery = document.getElementById('refresh-brand-profiles');
        restoreSubmittedFocus(origin, recovery, recovery);
      }
    }
  }
  function commitProfileWrite(
    raw: Partial<BrandProfile>,
    editingId = '',
    options: ProfileCommitOptions = {},
  ) {
    return commitProfileMutation(
      () => upsertProfile(raw, editingId, options.expected ?? null),
      options,
    );
  }
  async function commitProfileFieldWrite(
    profileId: string,
    patch: Parameters<typeof updateProfileFields>[1],
    options: ProfileCommitOptions = {},
  ): Promise<{ profile: BrandProfile; issue: ProfileCommitIssue }> {
    const expected = options.expected;
    if (!expected || active?.id !== profileId)
      throw new Error('The selected Brand Profile changed. Reopen its editor before saving.');
    return commitProfileMutation(() => updateProfileFields(profileId, patch, expected), options);
  }
  async function commitProfileDelete(profile: BrandProfile): Promise<ProfileCommitIssue> {
    if (profileWriteDisabled)
      throw new Error('Refresh saved profiles and wait for the pending write before deleting.');
    const origin = document.activeElement;
    profileMutationPending = true;
    cancelAudit();
    try {
      try {
        await deleteProfile(profile.id, profile);
      } catch (cause) {
        if (!isBrandProfileMutationCommittedError(cause) || cause.operation !== 'delete') {
          if (cause instanceof LocalRecordConflictError) profileRefreshRequired = true;
          throw cause;
        }
        installCommittedProfileSnapshot(cause.profiles);
        return 'active-preference';
      }
      try {
        await refreshProfiles();
        return null;
      } catch {
        return profileSourceState === 'unavailable' ? 'reread' : 'active-preference';
      }
    } finally {
      profileMutationPending = false;
      if (profileRefreshRequired) {
        await tick();
        const recovery = document.getElementById('refresh-brand-profiles');
        restoreSubmittedFocus(origin, recovery, recovery);
      }
    }
  }
  async function save() {
    if (savingProfile || profileWriteDisabled) return;
    const origin = document.activeElement;
    let savedProfileId = '';
    cancelIdentityCapture();
    message = 'Saving Brand Profile…';
    try {
      const result = await profileEditor.save((submitted) =>
        commitProfileWrite(submitted.profile, submitted.editingId, { expected: submitted.expected }),
        domains => confirm(`Remove expected settings for ${domains.length} official domain${domains.length === 1 ? '' : 's'} (${domains.join(', ')})? These settings will be removed when you save this profile.`),
      );
      if (!result) return;
      savedProfileId = result.profile.id;
      if (!result.issue && active?.id === result.profile.id && draftProfile?.id !== result.profile.id)
        draftProfile = $state.snapshot(active);
      message = result.issue
        ? `Saved "${result.profile.name}". ${committedIssueText(result.issue)}`
        : `Saved "${result.profile.name}" and set it active.`;
    } catch (cause) {
      message = profileWriteFailureMessage(cause, 'Could not save profile.');
    } finally {
      if (!showForm && savedProfileId) profilesOpen = true;
      await tick();
      if (document.activeElement === document.body || document.activeElement === origin) {
        const target = showForm
          ? origin
          : document.getElementById(`brand-profile-edit-${savedProfileId}`) ||
            document.getElementById('brand-profile-source-state') ||
            document.getElementById('new-brand-profile');
        if (
          target instanceof HTMLElement &&
          target.isConnected &&
          !(target instanceof HTMLButtonElement && target.disabled)
        )
          target.focus({ preventScroll: true });
      }
    }
  }
  async function saveProfileAsNew() {
    if (!orphanedProfileDraft || profileWriteDisabled) return;
    profileEditor.saveAsNew();
    await save();
  }
  async function remove(profile: BrandProfile) {
    if (profileWriteDisabled) return false;
    const submitted = $state.snapshot(profile);
    const unchanged = profileEditor.unchanged();
    let impact: string;
    try {
      const freshCases = await refreshCasesForBrands();
      impact = brandProfileDeletionImpact(freshCases, profile.id, 'ready');
    } catch {
      impact = brandProfileDeletionImpact([], profile.id, 'unavailable');
    }
    if (!confirm(`Delete brand profile "${profile.name}"? ${impact}`)) return false;
    let issue: ProfileCommitIssue;
    try {
      issue = await commitProfileDelete(submitted);
    } catch (cause) {
      message = profileWriteFailureMessage(cause, 'Could not delete profile.');
      return false;
    }
    const associationState =
      caseSourceState === 'ready'
        ? 'Case associations were not changed; retained references now appear unresolved.'
        : 'Case associations remain preserved, but cases are unavailable so retained references cannot currently be resolved or displayed.';
    profileEditor.removed(profile.id, unchanged);
    message = `Deleted "${profile.name}". ${issue ? `${committedIssueText(issue, 'deletion')} ` : ''}${associationState}`;
    return true;
  }
  async function saveAttestations(
    expected: BrandProfile,
    attestations: ProtectionAttestation[],
  ): Promise<BrandProfileSaveResult> {
    try {
      const result = await commitProfileFieldWrite(
        expected.id,
        { protectionAttestations: attestations },
        { preserveCompletedAudit: true, expected },
      );
      message = result.issue
        ? `Saved reviewed account controls. ${committedIssueText(result.issue)}`
        : 'Saved reviewed account controls. Untouched statements retain their review dates.';
      return { committed: true, profile: result.profile };
    } catch (cause) {
      const failure = profileWriteFailureMessage(cause, 'Could not save reviewed account controls.');
      message = failure;
      return { committed: false, message: failure };
    }
  }
  async function saveAllowlist(
    expected: BrandProfile,
    allowlistedDomains: string[],
    allowlistedRegistrars: string[],
  ): Promise<BrandProfileSaveResult> {
    try {
      const result = await commitProfileFieldWrite(
        expected.id,
        { allowlistedDomains, allowlistedRegistrars },
        { preserveCompletedAudit: true, expected },
      );
      message = result.issue
        ? `Saved the allowlist for "${expected.name}". ${committedIssueText(result.issue)}`
        : `Saved the allowlist for "${expected.name}".`;
      return { committed: true, profile: result.profile };
    } catch (cause) {
      const failure = profileWriteFailureMessage(cause, 'Could not save the allowlist.');
      message = failure;
      return { committed: false, message: failure };
    }
  }
  async function saveBaselines(
    expected: BrandProfile,
    desiredPostureBaselines: DesiredPostureBaseline[],
  ): Promise<BrandProfileSaveResult> {
    const profileId = expected.id;
    if (!active || active.id !== profileId)
      return {
        committed: false,
        message: 'The selected Brand Profile changed. Review its expected settings before saving.',
      };
    baselineMutationFocus = { profileId, origin: document.activeElement };
    try {
      const result = await commitProfileFieldWrite(
        profileId,
        { desiredPostureBaselines },
        { preserveCompletedAudit: true, expected },
      );
      message = result.issue
        ? `Saved expected domain settings. ${committedIssueText(result.issue)}`
        : 'Saved expected domain settings.';
      return { committed: true, profile: result.profile };
    } catch (cause) {
      baselineMutationFocus = null;
      const failure = profileWriteFailureMessage(cause, 'Could not save expected domain settings.');
      message = failure;
      return { committed: false, message: failure };
    } finally {
      await tick();
      restoreBaselineMutationFocus();
    }
  }
  async function savePassportProfile(
    profile: BrandProfile,
    expected: BrandProfile,
  ): Promise<BrandProfileSaveResult> {
    try {
      if (active?.id !== expected.id)
        throw new Error('The selected Brand Profile changed. Review it before importing.');
      const result = await commitProfileWrite(profile, profile.id, { expected });
      message = result.issue
        ? `Imported and saved the selected domain-control passport fields. ${committedIssueText(result.issue)}`
        : 'Imported the selected domain-control passport fields.';
      return { committed: true, profile: result.profile };
    } catch (cause) {
      const failure = profileWriteFailureMessage(
        cause,
        'Could not save imported domain-control fields.',
      );
      message = failure;
      return { committed: false, message: failure };
    }
  }
  async function retainObservation(report: DomainPostureHttpResponse) {
    const owner = active;
    if (!owner) return;
    const context = auditResults.find((item) => item.report === report)?.context;
    if (
      !context ||
      context.profileId !== owner.id ||
      context.domain !== report.domain ||
      context.profileFingerprint !== auditProfileFingerprint(owner)
    ) {
      message =
        'This observation no longer matches the active profile and collection settings. Run a new review before retaining it.';
      return;
    }
    const baseline = owner.desiredPostureBaselines.find((item) => item.domain === report.domain);
    if (!baseline) {
      message = 'Configure expected domain settings before retaining an observation.';
      return;
    }
    const observation = buildDesiredPostureObservation(report, context);
    const history = normalizeDesiredPostureObservationHistory(
      [...desiredPostureObservations(baseline), observation],
      null,
    );
    const previousObservation = currentDesiredPostureObservation({
      observationHistory: history,
      previousObservation: null,
    }).observation;
    const desiredPostureBaselines = owner.desiredPostureBaselines.map((item) =>
      item.domain === report.domain
        ? {
            ...item,
            previousObservation,
            observationHistory: history,
            updatedAt: new Date().toISOString(),
          }
        : item,
    );
    try {
      const result = await commitProfileFieldWrite(
        owner.id,
        { desiredPostureBaselines },
        { preserveCompletedAudit: true, expected: $state.snapshot(owner) },
      );
      message = `Saved the ${report.checkedAt} settings observation for ${report.domain}.${result.issue ? ` ${committedIssueText(result.issue, 'observation write')}` : ''}`;
    } catch (cause) {
      message = profileWriteFailureMessage(cause, 'Could not save the settings observation.');
    }
  }
  function cancelAudit() {
    auditGeneration += 1;
    auditController?.abort();
    auditController = null;
    auditing = false;
    auditResults = [];
  }
  function auditProfileFingerprint(profile: BrandProfile) {
    return brandPostureCollectionFingerprint(profile);
  }
  async function activate(id: string) {
    if (profileMutationPending || profileSourceState !== 'ready') return false;
    cancelAudit();
    try {
      setActiveProfile(id);
    } catch (cause) {
      closeActivePreferenceSource();
      message =
        cause instanceof BrowserLocalDataError
          ? 'Could not set the active profile. The active-profile preference is unavailable; retry selection or refresh saved profiles.'
          : cause instanceof Error
            ? cause.message
            : 'Could not set the active profile.';
      return false;
    }
    activeId = id;
    activePreferenceSourceState = 'ready';
    const profile = profiles.find((item) => item.id === id);
    draftProfile = profile ? $state.snapshot(profile) : null;
    if (profileRefreshRequired) {
      try {
        await refreshProfiles();
      } catch {
        message =
          'The active-profile preference was saved, but saved profiles could not be refreshed. Refresh saved profiles to retry the read.';
        return true;
      }
    }
    message = profile ? `Set "${profile.name}" active.` : 'Set the selected Brand Profile active.';
    return true;
  }
  async function captureSiteIdentity() {
    if (profileWriteDisabled) return;
    if (siteIdentityDisabled) {
      message = siteIdentityDisabled.reason || 'Website checks are disabled by deployment policy.';
      return;
    }
    await profileEditor.capture(async (domain, signal) => {
      const { response, body: raw } = await requestJsonCapped(
        `/api/availability?q=${encodeURIComponent(domain)}`,
        { cache: 'no-store', signal },
        { maximumBytes: LARGE_JSON_RESPONSE_BYTES, timeoutMs: 40_000 },
      );
      if (!response.ok)
        throw new Error(clientHttpErrorMessage(raw, response.status, 'Official-site capture failed'));
      const parsed = parseAvailabilityCaptureResponse(raw, domain);
      if (!parsed.ok) throw new Error(parsed.error);
      return createPageBaseline(domain, parsed.value);
    });
  }
  function baselineDate(value: string | null): string {
    return formatEvidenceDate(value, 'Unknown time');
  }
  async function audit(includeInheritedDns = false, batchIndex = 0) {
    if (profileWriteDisabled) return;
    if (postureDisabled) {
      message =
        postureDisabled.reason || 'Official-domain settings review is disabled by deployment policy.';
      return;
    }
    if (!active?.officialDomains.length) return;
    const profileSnapshot = normalizeProfile(active);
    const domains = officialDomainReviewBatch(profileSnapshot, batchIndex);
    if (!domains.length) {
      message = 'Select a current official-domain batch before reviewing.';
      return;
    }
    const profileId = profileSnapshot.id;
    const profileFingerprint = auditProfileFingerprint(profileSnapshot);
    const generation = ++auditGeneration;
    auditController?.abort();
    const controller = new AbortController();
    auditController = controller;
    const ownsRequest = () => generation === auditGeneration && auditController === controller;
    const canPublish = () => {
      const current = active;
      return (
        ownsRequest() &&
        activeId === profileId &&
        current !== null &&
        auditProfileFingerprint(current) === profileFingerprint
      );
    };
    auditing = true;
    auditResults = [];
    message = `Reviewing ${domains.length} official domain${domains.length === 1 ? '' : 's'}…`;
    let cursor = 0;
    const next: AuditResult[] = new Array(domains.length);
    const worker = async () => {
      while (cursor < domains.length && !controller.signal.aborted) {
        const index = cursor++,
          domain = domains[index];
        if (domain === undefined) break;
        try {
          const params = new URLSearchParams({
            q: domain,
            mailProfile: profileSnapshot.mailProtectionProfile,
          });
          if (includeInheritedDns) params.set('includeInheritedDns', '1');
          if (profileSnapshot.dkimSelectors.length)
            params.set('selectors', profileSnapshot.dkimSelectors.join(','));
          if (profileSnapshot.retiredDkimSelectors.length)
            params.set('retiredSelectors', profileSnapshot.retiredDkimSelectors.join(','));
          const { response, body: raw } = await requestJsonCapped(
            `/api/domain-posture?${params}`,
            { cache: 'no-store', signal: controller.signal },
            { maximumBytes: STANDARD_JSON_RESPONSE_BYTES, timeoutMs: 40_000 },
          );
          if (!response.ok)
            throw new Error(clientHttpErrorMessage(raw, response.status, 'Review failed'));
          const parsed = parseDomainPostureHttpResponse(raw, domain);
          if (!parsed.ok) throw new Error(parsed.error);
          next[index] = {
            domain,
            report: parsed.value,
            error: '',
            context: brandPostureObservationContext(profileSnapshot, domain),
          };
        } catch (cause) {
          if (controller.signal.aborted) return;
          next[index] = {
            domain,
            report: null,
            error: cause instanceof Error ? cause.message : 'Review failed',
          };
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, domains.length) }, worker));
      if (!canPublish()) return;
      auditResults = next;
      message = `Reviewed ${next.filter((v) => v?.report).length}/${domains.length} official domain${domains.length === 1 ? '' : 's'}${domains.length < profileSnapshot.officialDomains.length ? ` in this batch; ${profileSnapshot.officialDomains.length} domains in the profile` : ''}.`;
    } finally {
      if (ownsRequest()) {
        auditing = false;
        auditController = null;
      }
    }
  }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement,
      file = input.files?.[0];
    if (!file || profileWriteDisabled) return;
    profileMutationPending = true;
    cancelAudit();
    message = 'Importing Brand Profiles…';
    try {
      let result: Awaited<ReturnType<typeof importProfileFile>>;
      try {
        result = await importProfileFile(file, pageController.signal);
      } catch (cause) {
        if (!pageController.signal.aborted)
          message = profileWriteFailureMessage(cause, 'Import failed.');
        return;
      }
      if (pageController.signal.aborted) return;
      const skipped = result.skipped
        ? `; skipped ${result.skipped} older, same-time, invalid or over-limit profile${result.skipped === 1 ? '' : 's'}; local profiles were retained`
        : '';
      const imported = `Imported ${result.added} new and ${result.updated} updated profiles${skipped}.`;
      try {
        await refreshProfiles();
        message = imported;
      } catch {
        const issue: Exclude<ProfileCommitIssue, null> =
          profileSourceState === 'unavailable' ? 'reread' : 'active-preference';
        message = `${imported} ${committedIssueText(issue, 'profile import')}`;
      }
    } finally {
      input.value = '';
      profileMutationPending = false;
    }
  }
  async function download() {
    try {
      await exportProfiles();
      message = 'Exported the Brand Profile collection.';
    } catch (cause) {
      message = profileFailureMessage(cause, 'Could not export profiles.');
    }
  }
  onMount(() => {
    void (async () => {
      await Promise.allSettled([
        refreshProfiles(),
        refreshCasesForBrands(),
        refreshRelationshipsForBrands(),
      ]);
      const guideDomain = parseList(page.url.searchParams.get('domain') || '', true)[0] || '';
      if (page.url.searchParams.get('new') === '1' && guideDomain) {
        clearForm(guideDomain);
        await tick();
        if (page.url.hash === '#official-domains') {
          const target = document.getElementById('official-domains');
          target?.scrollIntoView({ block: 'center' });
          target?.focus({ preventScroll: true });
        }
      }
    })();
    return () => {
      cancelAudit();
      profileEditor.dispose();
    };
  });
</script>

<svelte:head><title>Brands · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Assure" title="Brands" description="Review owned-domain profiles, trusted dependencies and externally visible security settings."><div class="top-actions toolbar"><button id="new-brand-profile" class="primary" onclick={()=>clearForm()} disabled={profileWriteDisabled}>New profile</button>{#if profiles.length}<button class="btn" onclick={download} disabled={profileSourceState!=='ready'}>Export JSON</button>{/if}<label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importFile} disabled={profileWriteDisabled}></label></div></PageHeading>
{#if localContextStatus}<p class="local-context-status" role="status">{localContextStatus}</p>{/if}
{#if message}<p class="message" role="status" aria-label="Brand Profile action status" aria-live="polite" aria-atomic="true">{message}</p>{/if}
{#if profileRefreshRequired}<button id="refresh-brand-profiles" class="btn" type="button" onclick={retryProfiles} disabled={profileMutationPending||refreshingProfiles}>Refresh saved profiles</button>{/if}
{#if hasBrandWorkspace}
<div class="brand-views workspace-view-nav" role="tablist" aria-label="Brands views">
  {#each BRAND_VIEWS as view}
    <button id={`brands-tab-${view.id}`} role="tab" aria-selected={brandsView===view.id} aria-controls="brands-view-panel" tabindex={brandsView===view.id?0:-1} onpointerenter={()=>preloadBrandsView(view.id)} onfocus={()=>preloadBrandsView(view.id)} onclick={()=>void selectBrandsView(view.id)} onkeydown={brandsViewKeydown}>{view.label}{#if view.id==='assets'} <span aria-label={brandAssetRegister.state==='unavailable'?'count unavailable':`${brandAssetRegister.rows.length} rows`}>{brandAssetRegister.state==='unavailable'?'—':brandAssetRegister.rows.length}</span>{/if}</button>
  {/each}
</div>
{/if}
{#snippet profilesList()}<BrandProfileList {profiles} {activeId} busy={profileWriteDisabled} activationDisabled={profileMutationPending||profileSourceState!=='ready'} focusId={page.url.searchParams.get('profile') || ''} {activate} {edit} {remove} formatDate={baselineDate} />{/snippet}
{#if profileSourceState === 'loading'}
  <section class="profile-source-state card" role="status" aria-busy="true">Loading saved Brand Profiles…</section>
{:else if profileSourceState === 'unavailable'}
  <section id="brand-profile-source-state" tabindex="-1" class="profile-source-state unavailable card" role="alert">Saved Brand Profiles could not be loaded. Refresh to try again. Your open drafts are still here.</section>
{:else}
  {#if profiles.length}<details class="brand-profiles" bind:open={profilesOpen}><summary id="brand-profiles-summary">Brand profiles <span>{profiles.length}</span><small>{active ? `Active: ${active.name}` : 'No active profile'}</small></summary><div>{@render profilesList()}</div></details>{:else if !showForm}{@render profilesList()}{/if}
{/if}
{#if showForm}<BrandProfileEditor editing={Boolean(editing)} values={editorState.values} setValue={(field,value)=>profileEditor.setValue(field,value)} officialChannels={editorState.officialChannels} rightsReferences={editorState.rightsReferences} setOfficialChannels={value=>profileEditor.setOfficialChannels(value)} setRightsReferences={value=>profileEditor.setRightsReferences(value)} pageBaseline={editorState.baseline} capturingIdentity={editorState.capturing} busy={savingProfile} saveDisabled={profileWriteDisabled} orphaned={orphanedProfileDraft} disabledReason={siteIdentityReason} {captureSiteIdentity} save={orphanedProfileDraft?saveProfileAsNew:save} close={()=>profileEditor.close()} formatDate={baselineDate} />{/if}
{#if hasBrandWorkspace}

<div id="brands-view-panel" role="tabpanel" aria-labelledby={`brands-tab-${brandsView}`}>
  <div hidden={brandsView==='assets'}>
    {#if draftProfile}
      {#if !active || active.id!==draftProfile.id}
        <p id="brand-tool-draft-owner" class="local-context-status" role="status">Open drafts belong to “{draftProfile.name}”. {#if active}The selected profile is “{active.name}”.{:else}Its saved profile is unavailable; saving and export are disabled.{/if}</p>
        {#if active}<button class="btn" type="button" aria-describedby="brand-tool-draft-owner" onclick={()=>active&&activate(active.id)} disabled={profileWriteDisabled}>Discard tool drafts and switch</button>{/if}
      {/if}
      <div hidden={brandsView!=='overview'}>{#key draftProfile.id}<BrandAllowlistManager profile={draftProfile} writeDisabled={draftWriteDisabled} profileAvailable={profileSourceState==='ready'&&activePreferenceSourceState==='ready'&&active?.id===draftProfile.id} retainedDomains={caseSourceState==='ready'?cases.map(record=>record.domain):[]} {caseSourceState} onsave={saveAllowlist} onmessage={(value)=>message=value} />{/key}</div>
      <div hidden={brandsView!=='tools'}>
      <section class="workbench-launcher" aria-labelledby="brand-workbench-title">
        <div><h2 id="brand-workbench-title">Profile tools</h2><p>{draftProfile.name}</p></div>
        <label for="brand-workbench">Tool<select id="brand-workbench" value={brandWorkbench??''} onfocus={()=>preloadBrandWorkbench(brandWorkbench??'control')} oninput={(event)=>preloadBrandWorkbench(event.currentTarget.value)} onchange={(event)=>void selectBrandWorkbench(event.currentTarget.value)}><option value="">Choose a tool</option>{#each brandWorkbenchOptions as option}<option value={option.id}>{option.label}</option>{/each}</select></label>
      </section>
      {#if active&&active.id===draftProfile.id}
      {#if brandWorkbench==='control'}
        <DeferredSurface load={brandWorkbenches.control.load} props={{active}} loadingLabel="Loading domain controls." unavailableLabel="Domain controls could not be loaded." placeholder="workspace" />
      {:else if brandWorkbench==='portfolio'&&active}
        <DeferredSurface load={brandWorkbenches.portfolio.load} props={{active}} loadingLabel="Loading the owned-domain comparison." unavailableLabel="The owned-domain comparison could not be loaded." placeholder="workspace" />
      {:else if brandWorkbench==='posture'&&active}
        <DeferredSurface load={brandWorkbenches.posture.load} props={{active,disabledReason:postureReason,auditing,results:auditResults,audit,retainObservation}} loadingLabel="Loading the current-settings review." unavailableLabel="The current-settings review could not be loaded." placeholder="workspace" />
      {:else if brandWorkbench==='certificates'&&active}
        <DeferredSurface load={brandWorkbenches.certificates.load} props={{active,cases,unavailable:certificateReplayUnavailable}} loadingLabel="Loading certificate events." unavailableLabel="Certificate events could not be loaded." placeholder="workspace" />
      {/if}
      {/if}
      {#if openedDraftTools.tools.includes('mail')}
        <div hidden={brandWorkbench!=='mail'}><DeferredSurface load={brandWorkbenches.mail.load} props={{active:draftProfile,available:active?.id===draftProfile.id}} loadingLabel="Loading mail reports." unavailableLabel="Mail reports could not be loaded." placeholder="workspace" /></div>
      {/if}
      {#key draftProfile.id}
        {#if openedDraftTools.tools.includes('baselines')}
          <div hidden={brandWorkbench!=='baselines'}><DeferredSurface load={brandWorkbenches.baselines.load} props={{active:draftProfile,writeDisabled:draftWriteDisabled,saveBaselines,requestedDomain:page.url.searchParams.get('baseline')||''}} loadingLabel="Loading expected domain settings." unavailableLabel="Expected domain settings could not be loaded." onready={deferredBrandReady} placeholder="workspace" /></div>
        {/if}
        {#if openedDraftTools.tools.includes('passport')}
          <div hidden={brandWorkbench!=='passport'}><DeferredSurface load={brandWorkbenches.passport.load} props={{active:draftProfile,writeDisabled:draftWriteDisabled,saveProfile:savePassportProfile}} loadingLabel="Loading portable domain settings." unavailableLabel="Portable domain settings could not be loaded." placeholder="workspace" /></div>
        {/if}
        {#if openedDraftTools.tools.includes('attestations')}
          <div hidden={brandWorkbench!=='attestations'}><DeferredSurface load={brandWorkbenches.attestations.load} props={{active:draftProfile,writeDisabled:draftWriteDisabled,saveAttestations}} loadingLabel="Loading reviewed account controls." unavailableLabel="Reviewed account controls could not be loaded." placeholder="workspace" /></div>
        {/if}
      {/key}
      </div>
    {:else if brandsView==='tools'}
      <section class="profile-source-state"><h2>Select a Brand Profile</h2><p>Profile tools use the explicitly active profile.</p>{#if profiles.length}<button class="btn" type="button" onclick={chooseProfile}>Choose profile</button>{:else}<button class="btn" type="button" onclick={()=>clearForm()} disabled={profileWriteDisabled}>Create profile</button>{/if}</section>
    {/if}
    <div hidden={brandsView!=='overview'}>
    <BrandReviewInbox inbox={brandReviewInbox} />
    {#if active}<DeferredSurface load={()=>import('$lib/components/BrandCandidateReviewWorkspace.svelte')} props={{active,onrefresh:refreshProfiles,disabled:profileWriteDisabled}} loadingLabel="Loading retained candidate review…" unavailableLabel="Retained candidate review could not be loaded. No candidate state was changed." placeholder="workspace" />{/if}
    <BrandAssetRegisterSummary projection={brandAssetRegister} />
    </div>
  </div>
  {#if brandsView==='assets'}
    <DeferredSurface load={()=>import('$lib/components/BrandAssetRegister.svelte')} props={{projection:brandAssetRegister}} loadingLabel="Loading the selected Brand asset register." unavailableLabel="The Brand asset register could not be loaded. The profile list remains available." onready={deferredBrandReady} placeholder="workspace" />
  {/if}
</div>
{/if}

<style>
  .message {
    min-width: 0;
    color: var(--accent);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }
  .top-actions > button,
  .top-actions > label {
    min-height: 44px;
  }
  .local-context-status {
    min-width: 0;
    color: var(--amber);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }
  .profile-source-state {
    padding: var(--card-pad);
    color: var(--muted);
    font-size: var(--text-sm);
  }
  .profile-source-state.unavailable {
    border-color: var(--muted);
    border-style: dotted;
    color: var(--muted);
  }
  .brand-views button span {
    padding: 1px 7px;
    border-radius: 99px;
    background: var(--border);
    color: var(--text);
    font-size: var(--text-2xs);
  }
  .brand-profiles {
    margin: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .brand-profiles > summary {
    padding: 12px 0;
    font: 650 var(--text-sm) var(--font-sans);
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .brand-profiles > summary span {
    margin-left: 6px;
    color: var(--muted);
  }
  .brand-profiles > summary small {
    margin-left: 16px;
    color: var(--muted);
    font-weight: 400;
  }
  .brand-profiles > div {
    padding-bottom: 14px;
  }
  #brands-view-panel {
    min-width: 0;
  }
  .workbench-launcher {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .workbench-launcher > div {
    min-width: 0;
  }
  .workbench-launcher h2 {
    margin: 0;
    font: 650 var(--text-lg) var(--font-sans);
  }
  .workbench-launcher p {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }
  .workbench-launcher label {
    flex: 0 1 340px;
    color: var(--muted);
    font: 700 var(--text-2xs) var(--mono);
  }
  .workbench-launcher select {
    display: block;
    width: 100%;
    min-width: 0;
    min-height: 44px;
    margin-top: 6px;
  }
  @media (max-width: 750px) {
    .top-actions {
      margin-top: 14px;
    }
    .brand-views button {
      min-height: 44px;
    }
    .workbench-launcher {
      align-items: stretch;
      flex-direction: column;
    }
    .workbench-launcher label {
      width: 100%;
      flex-basis: auto;
    }
  }
</style>
