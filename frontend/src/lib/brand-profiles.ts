import { downloadLocalFile } from './download-local-file.ts';
import {
  buildBrandProfileExport,
  createBrandProfileId,
  applyBrandProfileFieldPatch,
  brandPostureCollectionFingerprint,
  mergeBrandProfiles,
  normalizeBrandProfile,
  serializeBrandProfileStore,
  MAX_PROFILES,
  normalizeBrandProfileId,
  normalizeProfileDomains,
  type BrandProfileFieldPatch,
} from './analysis/brand-profile-model.ts';
import {
  parseProfileList,
  profileDomainKind,
  profileSignals,
} from './analysis/brand-profile-signals.ts';
import type { BrandProfile } from './analysis/brand-profile-model.ts';
export type { BrandProfile } from './analysis/brand-profile-model.ts';
import { normalizePageBaseline } from './analysis/page-baseline.ts';
import { readBrowserLocalData, updateBrowserLocalData, updateBrowserLocalDataCollections } from './browser-local-data-service.ts';
import { BrowserLocalDataError } from './browser-local-data-content.ts';
import { loadBrowserLocalDataPreparation } from './browser-local-data-worker.ts';
import { assertLocalRecordCurrent, LocalRecordConflictError } from './local-mutation-outcome.ts';
import { LEGACY_PROFILES_KEY } from './browser-local-data-contract.ts';
import { workspacePreferenceStorage } from './browser-workspace-context.ts';
import { serialiseWorkspacePortableJson } from '../../../packages/contracts/workspace-portability.mts';
import { candidateMaterialFingerprint, mergeCandidateObservations, normalizeCandidateObservation, normalizeCandidateObservations, reviseCandidateException, type BrandCandidateObservation, type BrandCandidateException } from '../../../packages/workspace/brand-candidate-workflow.mts';
import { candidateReviewItem } from '../../../packages/monitoring/brand-candidate-review.mts';
import { reviseBrandKeywordCampaign, attributeKeywordCampaignCandidate, type BrandKeywordCampaignInput } from '../../../packages/workspace/brand-keyword-campaign.mts';
import { setAnalystReviewDecision, type AnalystReviewItem, type AnalystReviewStateStore } from '../../../packages/monitoring/analyst-review-state.mts';
export { MAX_PROFILE_IMPORT_BYTES } from '../../../packages/contracts/workspace-portability.mts';

export const PROFILES_KEY = LEGACY_PROFILES_KEY;
export const ACTIVE_PROFILE_KEY = 'whois-rdap-active-brand-profile-v1';
export type ActiveBrandProfileSourceState = 'loading' | 'ready' | 'unavailable';

export class BrandProfileMutationCommittedError extends BrowserLocalDataError {
  readonly operation: 'delete' | 'save';
  readonly profile: BrandProfile | null;
  readonly profiles: readonly BrandProfile[];

  constructor(operation: 'delete' | 'save', profile: BrandProfile | null, profiles: readonly BrandProfile[], cause: unknown) {
    super(
      'LOCAL_DATA_POST_COMMIT_FAILED',
      operation === 'save'
        ? 'The Brand Profile was saved, but its active-profile preference could not be updated.'
        : 'The Brand Profile was deleted, but its active-profile preference could not be checked or cleared.',
      { cause },
    );
    this.name = 'BrandProfileMutationCommittedError';
    this.operation = operation;
    this.profile = profile;
    this.profiles = profiles;
  }
}

export function isBrandProfileMutationCommittedError(cause: unknown): cause is BrandProfileMutationCommittedError {
  return cause instanceof BrandProfileMutationCommittedError;
}

export type PageBaseline = ReturnType<typeof normalizePageBaseline>;
export type BrandProfileSaveResult =
  | { committed: true; profile: BrandProfile }
  | { committed: false; message: string };

export function normalizeProfile(raw: unknown, existing?: BrandProfile, touch = false): BrandProfile {
  const profile = normalizeBrandProfile(raw, { existing, touch, makeId: createBrandProfileId });
  if (!profile) throw new Error('Enter a brand name.');
  return profile;
}

export async function loadProfiles(): Promise<BrandProfile[]> {
  return readBrowserLocalData('brand_profiles');
}

/** Explicit retained review selection; no collection runs and concurrent additions merge. */
export async function retainBrandCandidates(profileId: string, candidates: readonly BrandCandidateObservation[], campaignContext?: Readonly<{ id: string; revision: number }>) {
  if (candidates.length > 200) throw new RangeError('Retain at most 200 selected candidate domains per Brand.');
  return updateBrowserLocalData('brand_profiles', current => {
    const profiles = [...current], index = profiles.findIndex(profile => profile.id === profileId), profile = profiles[index];
    if (!profile) throw new LocalRecordConflictError('Brand Profile');
    const campaign = campaignContext ? profile.keywordCampaigns?.find(value => value.id === campaignContext.id) : null;
    if (campaignContext && (!campaign || campaign.revision !== campaignContext.revision)) throw new LocalRecordConflictError('keyword campaign revision');
    const byDomain = new Map(profile.candidateObservations.map(candidate => [candidate.domain, candidate]));
    const outcomes: Array<{ domain: string; state: 'retained' | 'rejected'; reason: string }> = [];
    for (const input of candidates) {
      const candidate = normalizeCandidateObservation(input);
      if (campaign && candidate) {
        const expected = attributeKeywordCampaignCandidate(candidate, campaign, profileId, new Date().toISOString());
        if (JSON.stringify(candidate.matches) !== JSON.stringify(expected.matches)) throw new LocalRecordConflictError('campaign nomination');
      }
      if (!candidate || !candidate.matches.some(match => match.brandProfileId === profileId)) { outcomes.push({ domain: input.domain, state: 'rejected', reason: 'No exact selected Brand match context.' }); continue; }
      if (!byDomain.has(candidate.domain) && byDomain.size >= 200) { outcomes.push({ domain: candidate.domain, state: 'rejected', reason: 'This Brand candidate capacity is exhausted.' }); continue; }
      byDomain.set(candidate.domain, mergeCandidateObservations(byDomain.get(candidate.domain), candidate)!);
      outcomes.push({ domain: candidate.domain, state: 'retained', reason: 'Candidate provenance retained without a Lookup or scan.' });
    }
    profiles[index] = normalizeProfile({ ...profile, candidateObservations: normalizeCandidateObservations([...byDomain.values()]) }, profile, true);
    return { document: boundedProfiles(profiles), result: outcomes };
  });
}

/** Revision-owned local intent; never requests a feed or changes a Watchlist. */
export async function saveBrandKeywordCampaign(profileId: string, input: BrandKeywordCampaignInput, expectedRevision: number | null, now = new Date().toISOString()) {
  return updateBrowserLocalData('brand_profiles', current => {
    const profiles = [...current], index = profiles.findIndex(profile => profile.id === profileId), profile = profiles[index];
    if (!profile) throw new LocalRecordConflictError('Brand Profile');
    const campaigns = profile.keywordCampaigns ?? [];
    const existing = campaigns.find(campaign => campaign.id === input.id) ?? null;
    const campaign = reviseBrandKeywordCampaign(existing, input, expectedRevision, now);
    profiles[index] = normalizeProfile({ ...profile, keywordCampaigns: [...campaigns.filter(value => value.id !== campaign.id), campaign] }, profile, true);
    return { document: boundedProfiles(profiles), result: campaign };
  });
}

export async function saveBrandCandidateException(profileId: string, input: Omit<BrandCandidateException, 'revision' | 'history' | 'historyOmitted'>, expectedRevision: number | null) {
  return updateBrowserLocalData('brand_profiles', current => {
    const profiles = [...current], index = profiles.findIndex(profile => profile.id === profileId), profile = profiles[index];
    if (!profile) throw new LocalRecordConflictError('Brand Profile');
    const existing = profile.candidateExceptions.find(exception => exception.id === input.id) ?? null;
    const candidate = profile.candidateObservations.find(candidate => candidate.domain === input.domain);
    if (!candidate || !candidate.matches.some(match => match.brandProfileId === profileId && match.ruleKey === input.ruleKey)) throw new LocalRecordConflictError('candidate match');
    if (candidateMaterialFingerprint(candidate, profileId, input.ruleKey) !== input.reviewedFingerprint) throw new LocalRecordConflictError('candidate evidence');
    const exception = reviseCandidateException(existing, input, expectedRevision);
    if (!existing && profile.candidateExceptions.length >= 200) throw new Error('Scoped exception capacity is exhausted; retain the current exceptions.');
    profiles[index] = normalizeProfile({ ...profile, candidateExceptions: [...profile.candidateExceptions.filter(value => value.id !== exception.id), exception] }, profile, true);
    return { document: boundedProfiles(profiles), result: exception };
  });
}

export async function saveBrandCandidateDecision(profileId: string, item: AnalystReviewItem, input: Parameters<typeof setAnalystReviewDecision>[2]) {
  const now = new Date().toISOString();
  return updateBrowserLocalDataCollections(['brand_profiles', 'analyst_review_state'], documents => {
    const profile = (documents.brand_profiles as BrandProfile[]).find(profile => profile.id === profileId);
    const candidate = profile?.candidateObservations.find(candidate => candidate.domain === item.caseDomain);
    if (!profile || !candidate || candidateReviewItem(candidate, profile, now).materialFingerprint !== item.materialFingerprint) throw new LocalRecordConflictError('candidate evidence');
    const document = setAnalystReviewDecision(documents.analyst_review_state, item, { ...input, reviewedAt: input.reviewedAt ?? now });
    return { documents: { ...documents, analyst_review_state: document }, result: document as AnalystReviewStateStore };
  });
}

function boundedProfiles(profiles: BrandProfile[]): BrandProfile[] {
  return JSON.parse(serializeBrandProfileStore(profiles)).profiles as BrandProfile[];
}

export async function writeProfiles(profiles: BrandProfile[]): Promise<void> {
  await updateBrowserLocalData('brand_profiles', () => ({ document: boundedProfiles(profiles), result: undefined }));
}

export function activeProfileId() {
  try {
    return normalizeBrandProfileId(workspacePreferenceStorage().getItem(ACTIVE_PROFILE_KEY)) || '';
  } catch (cause) {
    throw new BrowserLocalDataError('LOCAL_DATA_READ_FAILED', 'Could not read the active-profile preference. Browser storage may be unavailable.', { cause });
  }
}

export function setActiveProfile(profileId: string) {
  try {
    const normalized = normalizeBrandProfileId(profileId);
    if (profileId && !normalized) throw new Error('Active profile identifier is invalid.');
    if (normalized) workspacePreferenceStorage().setItem(ACTIVE_PROFILE_KEY, normalized);
    else workspacePreferenceStorage().removeItem(ACTIVE_PROFILE_KEY);
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'Active profile identifier is invalid.') throw cause;
    throw new BrowserLocalDataError('LOCAL_DATA_WRITE_FAILED', 'Could not set the active profile. Browser storage may be full or unavailable.', { cause });
  }
}

export async function activeProfile(): Promise<BrandProfile | null> {
  const active = activeProfileId();
  return (await loadProfiles()).find((profile) => profile.id === active) || null;
}

export function isDomainAllowlisted(domain: string, profile: BrandProfile | null = null) {
  return profileDomainKind(domain, profile) !== null;
}

export async function upsertProfile(raw: Partial<BrandProfile>, editingId = '', expected: BrandProfile | null = null): Promise<BrandProfile> {
  const committed = await updateBrowserLocalData('brand_profiles', (current) => {
    const profiles = [...current] as BrandProfile[];
    const index = editingId ? profiles.findIndex((item) => item.id === editingId) : -1;
    const existing = index >= 0 ? profiles[index] : undefined;
    if (editingId && !existing) throw new LocalRecordConflictError('Brand Profile');
    const fields = Object.keys(raw) as (keyof BrandProfile)[];
    const officialDomains = raw.officialDomains === undefined ? null : new Set(normalizeProfileDomains(raw.officialDomains));
    // Removing an official domain also removes its expected settings. A
    // confirmation based on an older baseline must not delete a newer one.
    if (officialDomains && existing?.officialDomains.some(domain => !officialDomains.has(domain))) {
      fields.push('desiredPostureBaselines');
    }
    assertLocalRecordCurrent(existing, expected, 'Brand Profile', fields);
    const normalized = normalizeProfile({ ...existing, ...raw }, existing, true);
    if (!editingId && profiles.some((profile) => profile.id === normalized.id)) throw new LocalRecordConflictError('Brand Profile');
    if (!normalized.name) throw new Error('Enter a brand name.');
    if (index >= 0) profiles[index] = normalized;
    else {
      if (profiles.length >= MAX_PROFILES) throw new Error(`Profiles are limited to ${MAX_PROFILES}.`);
      profiles.push(normalized);
    }
    const document = boundedProfiles(profiles);
    const profile = document.find((item) => item.id === normalized.id) ?? normalized;
    return { document, result: { profile, profiles: document } };
  });
  try { setActiveProfile(committed.profile.id); }
  catch (cause) { throw new BrandProfileMutationCommittedError('save', committed.profile, committed.profiles, cause); }
  return committed.profile;
}

export async function updateProfileFields(
  profileId: string,
  patch: BrandProfileFieldPatch,
  expected: BrandProfile,
): Promise<BrandProfile> {
  const committed = await updateBrowserLocalData('brand_profiles', (current) => {
    const profiles = [...current] as BrandProfile[];
    const index = profiles.findIndex((item) => item.id === profileId);
    const existing = index >= 0 ? profiles[index] : undefined;
    if (!existing) throw new LocalRecordConflictError('Brand Profile');
    assertLocalRecordCurrent(existing, expected, 'Brand Profile', Object.keys(patch) as (keyof BrandProfile)[]);
    if (Object.hasOwn(patch, 'desiredPostureBaselines')
      && brandPostureCollectionFingerprint(existing) !== brandPostureCollectionFingerprint(expected)) throw new LocalRecordConflictError('Brand Profile');
    const normalized = applyBrandProfileFieldPatch(existing, patch) as BrandProfile;
    profiles[index] = normalized;
    const document = boundedProfiles(profiles);
    const profile = document.find((item) => item.id === profileId) ?? normalized;
    return { document, result: { profile, profiles: document } };
  });
  try { setActiveProfile(committed.profile.id); }
  catch (cause) { throw new BrandProfileMutationCommittedError('save', committed.profile, committed.profiles, cause); }
  return committed.profile;
}

export async function deleteProfile(profileId: string, expected: BrandProfile): Promise<void> {
  const committed = await updateBrowserLocalData('brand_profiles', (current) => {
    assertLocalRecordCurrent(current.find((profile) => profile.id === profileId), expected, 'Brand Profile');
    const document = boundedProfiles((current as BrandProfile[]).filter((profile) => profile.id !== profileId));
    return { document, result: document };
  });
  try {
    if (activeProfileId() === profileId) setActiveProfile('');
  } catch (cause) {
    throw new BrandProfileMutationCommittedError('delete', null, committed, cause);
  }
}

export async function importProfiles(value: unknown) {
  return updateBrowserLocalData('brand_profiles', (current) => {
    const result = mergeBrandProfiles(current, value, { makeId: createBrandProfileId });
    return {
      document: result.profiles,
      result: { added: result.added, updated: result.updated, skipped: result.skipped },
    };
  });
}

export async function importProfileFile(file: Blob, signal?: AbortSignal) {
  const options = signal ? { signal } : {};
  const { mergeBrowserBrandProfileFile } = await loadBrowserLocalDataPreparation(options);
  return updateBrowserLocalData('brand_profiles', async (current) => {
    const result = await mergeBrowserBrandProfileFile(current, file, options);
    return {
      document: result.profiles,
      result: { added: result.added, updated: result.updated, skipped: result.skipped },
    };
  }, { preparation: 'background', ...options });
}

export async function exportProfiles() {
  const blob = new Blob([serialiseWorkspacePortableJson(buildBrandProfileExport(await loadProfiles()))], { type: 'application/json' });
  downloadLocalFile(blob, `whoisleuth-brand-profiles-${new Date().toISOString().slice(0, 10)}.json`);
}

export function parseList(raw: string, lower = false) {
  return parseProfileList(raw, lower);
}

export { profileDomainKind, profileSignals };
