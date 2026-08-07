import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { migrateLegacyBrowserData } from './helpers';

export interface SnapshotOverrides {
  id?: string;
  fingerprint?: string;
  firstCapturedAt?: string;
  capturedAt?: string;
  source?: string;
  scanDepth?: 'fast' | 'deep';
  availability?: string | null;
  riskModelVersion?: number | null;
  riskScore?: number | null;
  registrar?: string | null;
  activityStatus?: string | null;
  hasMx?: boolean | null;
  faviconMatch?: boolean | null;
  hasPasswordField?: boolean | null;
  nameservers?: string[];
  pageTitle?: string | null;
  httpSummaryVersion?: number | null;
  httpEvidenceStatus?: string | null;
  httpFinalOrigin?: string | null;
  httpResponseStatus?: number | null;
  httpTransportSecurity?: string | null;
  httpRedirectCount?: number | null;
  httpCrossOriginRedirect?: boolean | null;
  httpHttpsDowngrade?: boolean | null;
  httpContentType?: string | null;
  httpSecurityHeaders?: string[] | null;
}

export function snapshot(overrides: SnapshotOverrides = {}) {
  const id = overrides.id ?? 'ev-abc';
  return {
    id,
    fingerprint: overrides.fingerprint ?? id,
    firstCapturedAt:
      overrides.firstCapturedAt ?? '2026-06-01T00:00:00.000Z',
    capturedAt: overrides.capturedAt ?? '2026-06-01T00:00:00.000Z',
    source: overrides.source ?? 'lookup',
    scanDepth: overrides.scanDepth ?? 'deep',
    availability: overrides.availability ?? 'registered',
    confidence: null,
    riskModelVersion: Object.hasOwn(overrides, 'riskModelVersion')
      ? overrides.riskModelVersion
      : 1,
    riskScore: overrides.riskScore ?? 40,
    opportunityScore: null,
    riskFactors: [],
    opportunityFactors: [],
    registrar: overrides.registrar ?? 'Example Registrar',
    createdDate: null,
    expiryDate: null,
    nameservers: overrides.nameservers ?? [],
    hasMx: overrides.hasMx ?? null,
    hasSpf: null,
    hasDmarc: null,
    activityStatus: overrides.activityStatus ?? null,
    websiteProbeDetail: null,
    pageTitle: overrides.pageTitle ?? null,
    httpSummaryVersion: overrides.httpSummaryVersion ?? null,
    httpEvidenceStatus: overrides.httpEvidenceStatus ?? null,
    httpFinalOrigin: overrides.httpFinalOrigin ?? null,
    httpResponseStatus: overrides.httpResponseStatus ?? null,
    httpTransportSecurity: overrides.httpTransportSecurity ?? null,
    httpRedirectCount: overrides.httpRedirectCount ?? null,
    httpCrossOriginRedirect: overrides.httpCrossOriginRedirect ?? null,
    httpHttpsDowngrade: overrides.httpHttpsDowngrade ?? null,
    httpContentType: overrides.httpContentType ?? null,
    httpSecurityHeaders: overrides.httpSecurityHeaders ?? null,
    faviconMatch: overrides.faviconMatch ?? null,
    faviconNearMatch: null,
    reusesOfficialAssets: null,
    hasPasswordField: overrides.hasPasswordField ?? null,
    phishingLanguageMatch: null,
    mutationTypes: [],
  };
}

export interface CaseOverrides {
  id?: string;
  domain?: string;
  status?: string;
  disposition?: string;
  source?: string;
  evidenceHistory?: ReturnType<typeof snapshot>[];
  evidencePins?: unknown[];
  sightings?: unknown[];
  createdAt?: string;
  updatedAt?: string;
  notes?: Array<{ createdAt: string; body: string }>;
}

export function caseRecord(overrides: CaseOverrides = {}) {
  return {
    id: overrides.id ?? 'case-1',
    domain: overrides.domain ?? 'test.invalid',
    status: overrides.status ?? 'new',
    disposition: overrides.disposition ?? 'unreviewed',
    tags: [],
    notes: overrides.notes ?? [],
    source: overrides.source ?? 'lookup',
    evidenceHistory: overrides.evidenceHistory ?? [],
    evidencePins: overrides.evidencePins ?? [],
    sightings: overrides.sightings ?? [],
    createdAt: overrides.createdAt ?? '2026-06-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00.000Z',
  };
}

export async function openSeededTimelineCase(
  page: Page,
  domain: string,
  records: ReturnType<typeof caseRecord>[],
) {
  await page.goto('/monitor');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: 2, cases: records },
  });
  await page.getByRole('tab', { name: /Cases/ }).click();
  await page.locator('.case-head', { hasText: domain }).click();
}

export async function openCasesView(page: Page) {
  await page.goto('/monitor');
  await page.getByRole('tab', { name: /Cases/ }).click();
}

export async function createCase(page: Page, domain: string) {
  await page.locator('#new-case').fill(domain);
  await page.getByRole('button', { name: 'Open or create case' }).click();
  await expect(page.locator('.case-head', { hasText: domain })).toBeVisible();
}
