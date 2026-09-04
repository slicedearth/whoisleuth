#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAPABILITY_MANIFEST } from '../packages/contracts/capability-manifest.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { PRIVACY_DATA_FLOW_CATALOGUE } from './privacy-data-flow-catalogue-renderer.mts';

export const VERIFICATION_OWNERSHIP_MAP_VERSION = 2;
export const MAX_VERIFICATION_CHANGED_PATHS = 128;
export const MAX_VERIFICATION_CHANGED_PATH_LENGTH = 320;
export const MAX_VERIFICATION_RULES = 64;
export const MAX_VERIFICATION_INVENTORY_FILES = 8_000;

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_CHANGED_PATH = /^(?:[a-zA-Z0-9._+()@-]+\/)*[a-zA-Z0-9._+()@-]+$/u;

export const FULL_BATCH_RELEASE_GATES = Object.freeze([
  'unit',
  'production-source-coverage',
  'typecheck',
  'frontend-check',
  'build',
  'architecture',
  'capability-catalogue',
  'privacy-catalogue',
  'schema-inventory',
  'licences',
  'production-dependency-audit',
  'cli-package',
  'release-contract',
  'browser-complete',
  'browser-timing-stress-when-affected',
  'diff-whitespace',
  'staged-security',
] as const);

type FullGate = typeof FULL_BATCH_RELEASE_GATES[number];
export type SpecialisedCheck =
  | 'architecture'
  | 'capability-catalogue'
  | 'privacy-catalogue'
  | 'schema-inventory'
  | 'cli-package'
  | 'release-contract'
  | 'licences'
  | 'production-dependency-audit'
  | 'staged-security'
  | 'documentation'
  | 'workflow-closure'
  | 'browser-build'
  | 'browser-loading-report'
  | 'browser-timing-plan'
  | 'analyst-journey-assurance'
  | 'critical-mutation'
  | 'critical-io-coverage';

type VerificationRule = Readonly<{
  id: string;
  area: string;
  priority: number;
  impactOnly?: boolean;
  matches: (changedPath: string) => boolean;
  focusedUnit: readonly string[];
  focusedBrowser: readonly string[];
  specialised: readonly SpecialisedCheck[];
  browserRequired: boolean;
}>;

export type VerificationOwnershipAssignment = Readonly<{
  changedPath: string;
  ownershipArea: string;
  impactAreas: readonly string[];
  focusedUnitChecks: readonly string[];
  focusedBrowserChecks: readonly string[];
  mandatorySpecialisedChecks: readonly SpecialisedCheck[];
  userFacingBrowserRequired: boolean;
}>;

export type VerificationOwnershipPlan = Readonly<{
  mapVersion: 2;
  changedPaths: readonly string[];
  assignments: readonly VerificationOwnershipAssignment[];
  ownershipAreas: readonly string[];
  impactAreas: readonly string[];
  focusedUnitChecks: readonly string[];
  focusedBrowserChecks: readonly string[];
  mandatorySpecialisedChecks: readonly SpecialisedCheck[];
  userFacingBrowserRequired: boolean;
  fullBatchReleaseGates: readonly FullGate[];
  interpretation: readonly string[];
}>;

const unit = (...values: string[]) => Object.freeze(values);
const browser = (...values: string[]) => Object.freeze(values);
const specialised = (...values: SpecialisedCheck[]) => Object.freeze(values);

const RULES: readonly VerificationRule[] = Object.freeze([
  Object.freeze({
    id: 'shared-contracts', area: 'shared contracts and lifecycle metadata', priority: 40,
    matches: (value: string) => value.startsWith('packages/contracts/'),
    focusedUnit: unit('test/schema-lifecycle-registry.test.mts', 'test/schema-lifecycle-v4.test.mts', 'test/schema-lifecycle-repository.test.mts', 'test/capability-manifest.test.mts', 'test/privacy-data-flow-catalogue.test.mts'),
    focusedBrowser: browser(),
    specialised: specialised('architecture', 'schema-inventory', 'capability-catalogue', 'privacy-catalogue', 'critical-mutation'),
    browserRequired: false,
  }),
  Object.freeze({
    id: 'case-domain', area: 'Case domain and response lifecycle', priority: 40,
    matches: (value: string) => value.startsWith('packages/cases/'),
    focusedUnit: unit('test/case-model.test.mts', 'test/case-report.test.mts', 'test/case-response-model.test.mts', 'test/case-portability-lifecycle.test.mts', 'test/model-contract-properties.test.mts'),
    focusedBrowser: browser(
      'e2e/cases.spec.ts',
      'e2e/case-evidence-workflows.spec.ts',
      'e2e/case-response-lifecycle.spec.ts',
      'e2e/case-import-workflows.spec.ts',
    ),
    specialised: specialised('architecture', 'schema-inventory', 'privacy-catalogue', 'critical-mutation', 'analyst-journey-assurance'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'workspace-domain', area: 'browser-local workspace domain', priority: 40,
    matches: (value: string) => value.startsWith('packages/workspace/'),
    focusedUnit: unit('test/workspace-domain-facades.test.mts', 'test/workspace-portability-lifecycle.test.mts', 'test/workspace-rollback.test.mts', 'test/model-contract-properties.test.mts'),
    focusedBrowser: browser('e2e/dashboard.spec.ts', 'e2e/local-data-platform.spec.ts'),
    specialised: specialised('architecture', 'schema-inventory', 'privacy-catalogue', 'analyst-journey-assurance'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'evidence-domain', area: 'bounded evidence domain', priority: 40,
    matches: (value: string) => value.startsWith('packages/evidence/') || value.startsWith('packages/collectors/'),
    focusedUnit: unit('test/evidence-quality-properties.test.mts', 'test/model-contract-properties.test.mts'),
    focusedBrowser: browser(),
    specialised: specialised('architecture', 'privacy-catalogue', 'staged-security', 'critical-mutation'),
    browserRequired: false,
  }),
  Object.freeze({
    id: 'anchored-artifact-writer', area: 'critical anchored artefact I/O', priority: 50,
    matches: (value: string) => value === 'packages/web-capture/anchored-artifact-writer.mts',
    focusedUnit: unit('test/anchored-artifact-writer.test.mts'),
    focusedBrowser: browser(),
    specialised: specialised('architecture', 'critical-io-coverage', 'staged-security'),
    browserRequired: false,
  }),
  Object.freeze({
    id: 'portable-domains', area: 'portable domain packages', priority: 30,
    matches: (value: string) => value.startsWith('packages/'),
    focusedUnit: unit('test/model-contract-properties.test.mts', 'test/schema-lifecycle-registry.test.mts'),
    focusedBrowser: browser(),
    specialised: specialised('architecture', 'schema-inventory', 'privacy-catalogue'),
    browserRequired: false,
  }),
  Object.freeze({
    id: 'shared-runtime', area: 'shared runtime and evidence orchestration', priority: 30,
    matches: (value: string) => value.startsWith('lib/'),
    focusedUnit: unit('test/model-contract-properties.test.mts', 'test/evidence-quality-properties.test.mts'),
    focusedBrowser: browser(),
    specialised: specialised('architecture', 'privacy-catalogue', 'staged-security', 'critical-mutation'),
    browserRequired: false,
  }),
  Object.freeze({
    id: 'cli', area: 'CLI command and installed-package surface', priority: 35,
    matches: (value: string) => value.startsWith('cli/') || value.startsWith('bin/'),
    focusedUnit: unit('test/cli-command-registry.test.mts', 'test/cli-process.test.mts', 'test/cli-investigation-run.test.mts'),
    focusedBrowser: browser(),
    specialised: specialised('architecture', 'schema-inventory', 'privacy-catalogue', 'cli-package', 'release-contract', 'staged-security'),
    browserRequired: false,
  }),
  Object.freeze({
    id: 'hosted-functions', area: 'hosted bounded functions', priority: 35,
    matches: (value: string) => value.startsWith('netlify/functions/'),
    focusedUnit: unit(
      'test/netlify-api-error-boundaries.test.mts',
      'test/netlify-network-guard.test.mts',
      'test/netlify-network-handler-contracts.test.mts',
      'test/outbound-request-bounds.test.mts',
    ),
    focusedBrowser: browser(),
    specialised: specialised('architecture', 'privacy-catalogue', 'staged-security'),
    browserRequired: false,
  }),
  Object.freeze({
    id: 'frontend-model', area: 'frontend analysis and controller models', priority: 40,
    matches: (value: string) => value.startsWith('frontend/src/lib/analysis/') || value.startsWith('frontend/src/lib/controllers/'),
    focusedUnit: unit('test/model-contract-properties.test.mts', 'test/lookup-request-controller.test.mts'),
    focusedBrowser: browser('e2e/dashboard.spec.ts', 'e2e/accessibility.spec.ts'),
    specialised: specialised('architecture', 'privacy-catalogue', 'analyst-journey-assurance'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'frontend-user-interface', area: 'frontend user-facing routes and components', priority: 30,
    matches: (value: string) => value.startsWith('frontend/src/'),
    focusedUnit: unit('test/model-contract-properties.test.mts'),
    focusedBrowser: browser('e2e/accessibility.spec.ts'),
    specialised: specialised('architecture', 'analyst-journey-assurance'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'frontend-navigation-impact', area: 'shared navigation, theme, and layout behaviour', priority: 0,
    impactOnly: true,
    matches: (value: string) => value === 'frontend/src/app.css'
      || /\/\+layout(?:\.svelte|\.ts)$/u.test(value)
      || /\/(?:CommandPalette|LocalSectionNav|PublicReferenceSidebar|SiteFooter|ThemeSelector)\.svelte$/u.test(value),
    focusedUnit: unit('test/public-product-catalogue.test.mts'),
    focusedBrowser: browser(
      'e2e/design-system.spec.ts',
      'e2e/mobile-nav.spec.ts',
      'e2e/skip-navigation.spec.ts',
      'e2e/theme.spec.ts',
    ),
    specialised: specialised('browser-timing-plan'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'frontend-lookup-impact', area: 'Lookup analyst workflow', priority: 0,
    impactOnly: true,
    matches: (value: string) => value.includes('/lookup/')
      || /\/(?:Lookup|lookup-)[^/]*\.(?:svelte|ts|mts)$/u.test(value),
    focusedUnit: unit('test/lookup-request-controller.test.mts', 'test/lookup-route-analysis.test.mts'),
    focusedBrowser: browser(
      'e2e/lookup-anchor-navigation.spec.ts',
      'e2e/lookup-input.spec.ts',
      'e2e/lookup-interaction-design.spec.ts',
      'e2e/lookup-network-evidence.spec.ts',
      'e2e/lookup-registration-evidence.spec.ts',
    ),
    specialised: specialised('privacy-catalogue', 'browser-timing-plan'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'frontend-bulk-impact', area: 'Bulk analyst workflow', priority: 0,
    impactOnly: true,
    matches: (value: string) => value.includes('/bulk/')
      || /\/(?:Bulk|bulk-)[^/]*\.(?:svelte|ts|mts)$/u.test(value),
    focusedUnit: unit('test/bulk-route-model.test.mts', 'test/bulk-session-model.test.mts'),
    focusedBrowser: browser('e2e/bulk-analysis.spec.ts', 'e2e/bulk-presentation.spec.ts', 'e2e/bulk-session-workflows.spec.ts'),
    specialised: specialised('privacy-catalogue', 'browser-timing-plan'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'frontend-brand-impact', area: 'Brand and campaign analyst workflow', priority: 0,
    impactOnly: true,
    matches: (value: string) => value.includes('/brands/')
      || value === 'frontend/src/lib/campaigns.ts'
      || /\/(?:Brand|Campaign|brand-|campaign-)[^/]*\.(?:svelte|ts|mts)$/u.test(value),
    focusedUnit: unit('test/brand-profile-model.test.mts', 'test/campaign-model.test.mts'),
    focusedBrowser: browser('e2e/brand-asset-register.spec.ts', 'e2e/brand-baseline.spec.ts', 'e2e/parent-domain-campaign-scope.spec.ts'),
    specialised: specialised('privacy-catalogue', 'browser-timing-plan'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'frontend-case-impact', area: 'Case analyst workflow', priority: 0,
    impactOnly: true,
    matches: (value: string) => value === 'frontend/src/lib/cases.ts'
      || /\/(?:Case|case-)[^/]*\.(?:svelte|ts|mts)$/u.test(value),
    focusedUnit: unit('test/case-model.test.mts', 'test/case-report.test.mts', 'test/case-response-model.test.mts'),
    focusedBrowser: browser(
      'e2e/cases.spec.ts',
      'e2e/case-evidence-workflows.spec.ts',
      'e2e/case-import-workflows.spec.ts',
      'e2e/case-relationship-workflows.spec.ts',
      'e2e/case-response-lifecycle.spec.ts',
    ),
    specialised: specialised('privacy-catalogue'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'frontend-monitor-impact', area: 'Monitoring analyst workflow', priority: 0,
    impactOnly: true,
    matches: (value: string) => value.includes('/monitor/')
      || value === 'frontend/src/lib/scheduled-monitoring.ts'
      || value === 'frontend/src/lib/watchlists.ts'
      || /\/(?:HostedWatchlist|Monitor|Watchlist|monitor-|watchlist-)[^/]*\.(?:svelte|ts|mts)$/u.test(value),
    focusedUnit: unit('test/watchlist-store.test.mts', 'test/scheduled-monitor-model.test.mts'),
    focusedBrowser: browser('e2e/hosted-monitoring.spec.ts', 'e2e/lookup-case-monitoring.spec.ts', 'e2e/watchlist-storage.spec.ts'),
    specialised: specialised('privacy-catalogue', 'browser-timing-plan'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'frontend-dashboard-impact', area: 'Dashboard analyst workflow', priority: 0,
    impactOnly: true,
    matches: (value: string) => value.includes('/dashboard/') || /\/Dashboard[^/]*\.svelte$/u.test(value),
    focusedUnit: unit('test/analyst-review-inbox.test.mts'),
    focusedBrowser: browser('e2e/analyst-context.spec.ts', 'e2e/dashboard.spec.ts', 'e2e/local-data-platform.spec.ts'),
    specialised: specialised('browser-timing-plan'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'browser-local-data-impact', area: 'browser-local persistence and migration behaviour', priority: 0,
    impactOnly: true,
    matches: (value: string) => /^frontend\/src\/lib\/browser-local-data(?:-[^/]+)?\.ts$/u.test(value),
    focusedUnit: unit(
      'test/browser-local-data-definitions.test.mts',
      'test/browser-local-data-provider.test.mts',
      'test/browser-local-data-service.test.mts',
      'test/workspace-import-failure.test.mts',
      'test/workspace-rollback.test.mts',
    ),
    focusedBrowser: browser('e2e/local-data-platform.spec.ts', 'e2e/watchlist-storage.spec.ts'),
    specialised: specialised('privacy-catalogue', 'schema-inventory'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'frontend-public-reference-impact', area: 'public documentation and reference experience', priority: 0,
    impactOnly: true,
    matches: (value: string) => value.startsWith('frontend/src/routes/(public)/')
      || /\/PublicReference[^/]*\.svelte$/u.test(value),
    focusedUnit: unit('test/public-guide.test.mts', 'test/public-product-catalogue.test.mts'),
    focusedBrowser: browser('e2e/public-guide.spec.ts', 'e2e/public-product-batch3.spec.ts', 'e2e/seo.spec.ts'),
    specialised: specialised('documentation', 'capability-catalogue'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'frontend-deferred-loading-impact', area: 'deferred loading and recovery behaviour', priority: 0,
    impactOnly: true,
    matches: (value: string) => /\/(?:DeferredSurface|deferred-|console-loading)[^/]*\.(?:svelte|ts|mts)$/u.test(value),
    focusedUnit: unit('test/deferred-module.test.mts'),
    focusedBrowser: browser('e2e/console-loading.spec.ts', 'e2e/deferred-interactions.spec.ts', 'e2e/deferred-recovery.spec.ts'),
    specialised: specialised('browser-timing-plan'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'verification-tooling', area: 'maintainer verification tooling', priority: 30,
    matches: (value: string) => value.startsWith('tools/'),
    focusedUnit: unit('test/ci-workflow.test.mts', 'test/verification-architecture.test.mts'),
    focusedBrowser: browser(),
    specialised: specialised('architecture', 'workflow-closure'),
    browserRequired: false,
  }),
  Object.freeze({
    id: 'schema-tooling-impact', area: 'schema inventory and lifecycle verification', priority: 0,
    impactOnly: true,
    matches: (value: string) => /^tools\/schema-(?:compatibility|lifecycle|source)/u.test(value),
    focusedUnit: unit(
      'test/schema-compatibility.test.mts',
      'test/schema-lifecycle-repository.test.mts',
      'test/schema-source-coverage.test.mts',
    ),
    focusedBrowser: browser(),
    specialised: specialised('schema-inventory', 'critical-mutation'),
    browserRequired: false,
  }),
  Object.freeze({
    id: 'privacy-tooling-impact', area: 'privacy catalogue verification', priority: 0,
    impactOnly: true,
    matches: (value: string) => value.startsWith('tools/privacy-data-flow-'),
    focusedUnit: unit('test/privacy-data-flow-catalogue.test.mts', 'test/privacy-contract.test.mts'),
    focusedBrowser: browser('e2e/privacy-data-flow-catalogue.spec.ts'),
    specialised: specialised('privacy-catalogue', 'schema-inventory'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'public-product-tooling-impact', area: 'public product and capability verification', priority: 0,
    impactOnly: true,
    matches: (value: string) => /^tools\/(?:capability|public-product)/u.test(value),
    focusedUnit: unit('test/capability-manifest.test.mts', 'test/public-product-catalogue.test.mts'),
    focusedBrowser: browser('e2e/capabilities.spec.ts', 'e2e/public-product-batch3.spec.ts'),
    specialised: specialised('capability-catalogue', 'documentation'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'browser-build-tooling-impact', area: 'browser build and CI parity verification', priority: 0,
    impactOnly: true,
    matches: (value: string) => value === 'tools/ci-verification.mts'
      || value === 'tools/frontend-build-integrity.mts'
      || value === 'tools/frontend-loading-report.mts'
      || value.startsWith('tools/playwright-')
      || value === 'tools/verification-artifact-status.mts',
    focusedUnit: unit(
      'test/ci-workflow.test.mts',
      'test/frontend-build-integrity.test.mts',
      'test/frontend-loading-report.test.mts',
    ),
    focusedBrowser: browser(),
    specialised: specialised('browser-timing-plan', 'workflow-closure'),
    browserRequired: false,
  }),
  Object.freeze({
    id: 'browser-build-artifact-impact', area: 'production browser build artefact verification', priority: 0,
    impactOnly: true,
    matches: (value: string) => value === 'tools/frontend-build-integrity.mts'
      || value === 'tools/frontend-loading-report.mts',
    focusedUnit: unit('test/frontend-build-integrity.test.mts', 'test/frontend-loading-report.test.mts'),
    focusedBrowser: browser(),
    specialised: specialised('browser-build', 'browser-loading-report'),
    browserRequired: false,
  }),
  Object.freeze({
    id: 'unit-tests', area: 'unit and model verification', priority: 30,
    matches: (value: string) => value.startsWith('test/'),
    focusedUnit: unit(), focusedBrowser: browser(),
    specialised: specialised('architecture'), browserRequired: false,
  }),
  Object.freeze({
    id: 'browser-tests', area: 'browser and analyst-journey verification', priority: 30,
    matches: (value: string) => value.startsWith('e2e/'),
    focusedUnit: unit('test/synthetic-analyst-journeys.test.mts'), focusedBrowser: browser(),
    specialised: specialised('browser-timing-plan', 'analyst-journey-assurance'), browserRequired: true,
  }),
  Object.freeze({
    id: 'privacy-documents', area: 'privacy and data-flow documentation', priority: 45,
    matches: (value: string) => value === 'PRIVACY.md' || value.startsWith('docs/privacy-'),
    focusedUnit: unit('test/privacy-data-flow-catalogue.test.mts', 'test/privacy-contract.test.mts'), focusedBrowser: browser('e2e/privacy-data-flow-catalogue.spec.ts'),
    specialised: specialised('privacy-catalogue', 'schema-inventory', 'documentation'), browserRequired: true,
  }),
  Object.freeze({
    id: 'privacy-contract-impact', area: 'privacy contract and disclosure surfaces', priority: 0,
    impactOnly: true,
    matches: (value: string) => value.includes('privacy-data-flow')
      || value.startsWith('frontend/src/routes/(public)/privacy/'),
    focusedUnit: unit('test/privacy-data-flow-catalogue.test.mts', 'test/privacy-contract.test.mts'),
    focusedBrowser: browser('e2e/privacy-data-flow-catalogue.spec.ts'),
    specialised: specialised('privacy-catalogue', 'schema-inventory', 'documentation'),
    browserRequired: true,
  }),
  Object.freeze({
    id: 'workflow-definitions', area: 'hosted verification workflows', priority: 40,
    matches: (value: string) => value.startsWith('.github/workflows/'),
    focusedUnit: unit('test/ci-workflow.test.mts'), focusedBrowser: browser(),
    specialised: specialised('workflow-closure', 'staged-security'), browserRequired: false,
  }),
  Object.freeze({
    id: 'documentation', area: 'maintained public documentation', priority: 20,
    matches: (value: string) => value === 'README.md' || value === 'SECURITY.md' || value.startsWith('docs/'),
    focusedUnit: unit('test/documentation-links.test.mts'), focusedBrowser: browser('e2e/public-guide.spec.ts'),
    specialised: specialised('documentation'), browserRequired: true,
  }),
  Object.freeze({
    id: 'package-release', area: 'package, dependency, and release metadata', priority: 30,
    matches: (value: string) => ['package.json', 'package-lock.json', 'THIRD_PARTY_NOTICES.md', '.nvmrc', 'playwright.config.ts', 'tsconfig.json'].includes(value),
    focusedUnit: unit(
      'test/release-version-check.test.mts',
      'test/case-portability-lifecycle.test.mts',
      'test/case-supported-contract-baseline.test.mts',
      'test/case-contract-doc.test.mts',
      'test/documentation-contract.test.mts',
      'test/cli-package.test.mts',
      'test/ci-workflow.test.mts',
    ),
    focusedBrowser: browser(),
    specialised: specialised(
      'cli-package',
      'release-contract',
      'schema-inventory',
      'documentation',
      'licences',
      'production-dependency-audit',
      'workflow-closure',
    ),
    browserRequired: false,
  }),
]);

function normaliseChangedPath(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_VERIFICATION_CHANGED_PATH_LENGTH
    || value.startsWith('/') || value.startsWith('-') || value.includes('\\') || value.includes('\0')
    || !SAFE_CHANGED_PATH.test(value)) {
    throw new TypeError('Changed paths must be bounded repository-relative file identities.');
  }
  const normalised = path.posix.normalize(value);
  if (normalised !== value || normalised === '.' || normalised.startsWith('../') || normalised.includes('/../')) {
    throw new TypeError('Changed paths must not traverse or normalise outside their supplied identity.');
  }
  return normalised;
}

function existingTest(value: string): boolean {
  try {
    const stat = lstatSync(path.join(REPOSITORY_ROOT, value));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function assertDeclaredVerificationTest(
  value: unknown,
  lane: 'unit' | 'browser',
): string {
  if (lane !== 'unit' && lane !== 'browser') {
    throw new TypeError('Declared verification checks must select a known test lane.');
  }
  const pattern = lane === 'unit'
    ? /^test\/[^/]+\.test\.mts$/u
    : /^e2e\/[^/]+\.spec\.ts$/u;
  if (typeof value !== 'string' || value.length > MAX_VERIFICATION_CHANGED_PATH_LENGTH || !pattern.test(value)) {
    throw new TypeError(`Declared ${lane} verification check has an invalid test-file identity.`);
  }
  if (!existingTest(value)) {
    throw new TypeError(`Declared ${lane} verification check does not exist: ${value}.`);
  }
  return value;
}

function validateRules(): void {
  if (RULES.length < 1 || RULES.length > MAX_VERIFICATION_RULES || new Set(RULES.map((rule) => rule.id)).size !== RULES.length) {
    throw new TypeError('Verification rules are missing, repeated, or unbounded.');
  }
  for (const rule of RULES) {
    for (const [lane, checks] of [
      ['unit', rule.focusedUnit],
      ['browser', rule.focusedBrowser],
    ] as const) {
      if (new Set(checks).size !== checks.length) {
        throw new TypeError(`Verification rule ${rule.id} repeats a declared ${lane} check.`);
      }
      for (const check of checks) assertDeclaredVerificationTest(check, lane);
    }
  }
}

function exactFocusedChecks(changedPath: string): readonly string[] {
  if (changedPath.startsWith('test/') && changedPath.endsWith('.mts')) return Object.freeze([changedPath]);
  if (changedPath.startsWith('e2e/') && /\.(?:spec|setup)\.ts$/u.test(changedPath)) return Object.freeze([]);
  const basename = path.posix.basename(changedPath).replace(/\.(?:mts|ts|svelte|json|md|yml|yaml)$/u, '');
  return Object.freeze([
    `test/${basename}.test.mts`,
    `test/${basename}-contract.test.mts`,
    `test/${basename}-model.test.mts`,
  ].filter(existingTest));
}

function exactBrowserChecks(changedPath: string): readonly string[] {
  if (changedPath.startsWith('e2e/') && changedPath.endsWith('.spec.ts')) return Object.freeze([changedPath]);
  return Object.freeze([]);
}

function matchingRules(changedPath: string): readonly VerificationRule[] {
  const matches = RULES.filter((rule) => rule.matches(changedPath));
  if (!matches.length) throw new TypeError(`Unknown maintained ownership area for ${changedPath}.`);
  return Object.freeze(matches);
}

function ownershipRule(changedPath: string, matches = matchingRules(changedPath)): VerificationRule {
  const owners = matches.filter((rule) => !rule.impactOnly);
  if (!owners.length) throw new TypeError(`Unknown maintained ownership area for ${changedPath}.`);
  const priority = Math.max(...owners.map((rule) => rule.priority));
  const selected = owners.filter((rule) => rule.priority === priority);
  if (selected.length !== 1) throw new TypeError(`Ambiguous verification ownership for ${changedPath}.`);
  return selected[0]!;
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort() as T[]);
}

export function buildVerificationOwnershipPlan(rawPaths: readonly string[]): VerificationOwnershipPlan {
  validateRules();
  if (!Array.isArray(rawPaths) || rawPaths.length < 1 || rawPaths.length > MAX_VERIFICATION_CHANGED_PATHS) {
    throw new TypeError(`Verification plan requires 1 to ${MAX_VERIFICATION_CHANGED_PATHS} changed paths.`);
  }
  const changedPaths = rawPaths.map(normaliseChangedPath);
  if (new Set(changedPaths).size !== changedPaths.length) throw new TypeError('Verification plan changed paths must not repeat.');
  const assignments = changedPaths.sort().map((changedPath): VerificationOwnershipAssignment => {
    const impacts = matchingRules(changedPath);
    const owner = ownershipRule(changedPath, impacts);
    const focusedUnitChecks = uniqueSorted([
      ...impacts.flatMap((rule) => rule.focusedUnit),
      ...exactFocusedChecks(changedPath),
    ]);
    const focusedBrowserChecks = uniqueSorted([
      ...impacts.flatMap((rule) => rule.focusedBrowser),
      ...exactBrowserChecks(changedPath),
    ]);
    const browserRequired = impacts.some((rule) => rule.browserRequired);
    if (browserRequired && focusedBrowserChecks.length === 0) {
      throw new TypeError(`User-facing ownership for ${changedPath} has no focused browser check.`);
    }
    return Object.freeze({
      changedPath,
      ownershipArea: owner.area,
      impactAreas: uniqueSorted(impacts.map((rule) => rule.area)),
      focusedUnitChecks,
      focusedBrowserChecks,
      mandatorySpecialisedChecks: uniqueSorted(impacts.flatMap((rule) => rule.specialised)),
      userFacingBrowserRequired: browserRequired,
    });
  });
  return Object.freeze({
    mapVersion: VERIFICATION_OWNERSHIP_MAP_VERSION,
    changedPaths: Object.freeze(changedPaths),
    assignments: Object.freeze(assignments),
    ownershipAreas: uniqueSorted(assignments.map((item) => item.ownershipArea)),
    impactAreas: uniqueSorted(assignments.flatMap((item) => item.impactAreas)),
    focusedUnitChecks: uniqueSorted(assignments.flatMap((item) => item.focusedUnitChecks)),
    focusedBrowserChecks: uniqueSorted(assignments.flatMap((item) => item.focusedBrowserChecks)),
    mandatorySpecialisedChecks: uniqueSorted(assignments.flatMap((item) => item.mandatorySpecialisedChecks)),
    userFacingBrowserRequired: assignments.some((item) => item.userFacingBrowserRequired),
    fullBatchReleaseGates: FULL_BATCH_RELEASE_GATES,
    interpretation: Object.freeze([
      'Focused checks support iteration only and do not establish batch or release readiness.',
      'Each path has one highest-priority owner while every matching impact contributes checks.',
      'Every full batch and release gate remains mandatory regardless of this focused plan.',
      'The plan is request-free and contains test and check identities, never executable shell fragments.',
    ]),
  });
}

function maintainedInventory(): readonly string[] {
  const roots = ['packages', 'lib', 'cli', 'bin', 'netlify/functions', 'frontend/src', 'tools', 'test', 'e2e', 'docs', '.github/workflows'];
  const files: string[] = [
    '.nvmrc', 'README.md', 'PRIVACY.md', 'SECURITY.md', 'package-lock.json',
    'package.json', 'playwright.config.ts', 'tsconfig.json',
  ];
  const visit = (relative: string): void => {
    for (const entry of readdirSync(path.join(REPOSITORY_ROOT, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) {
        files.push(child);
        if (files.length > MAX_VERIFICATION_INVENTORY_FILES) throw new TypeError('Maintained ownership inventory exceeds its file bound.');
      }
    }
  };
  for (const root of roots) visit(root);
  return Object.freeze(files.sort());
}

function readDependencyRuleNames(): readonly string[] {
  const filename = path.join(REPOSITORY_ROOT, '.dependency-cruiser.json');
  const bytes = readFileSync(filename);
  if (bytes.length < 1 || bytes.length > 256 * 1024) throw new TypeError('Dependency ownership configuration exceeds its byte bound.');
  const parsed = JSON.parse(bytes.toString('utf8')) as { forbidden?: unknown[] };
  if (!Array.isArray(parsed.forbidden) || parsed.forbidden.length < 1 || parsed.forbidden.length > 128) throw new TypeError('Dependency ownership rules are missing or unbounded.');
  const names = parsed.forbidden.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Dependency ownership rule is malformed.');
    const item = value as Record<string, unknown>;
    if (typeof item.name !== 'string' || !/^[a-z0-9-]{1,100}$/u.test(item.name) || item.severity !== 'error') {
      throw new TypeError('Dependency ownership rules must remain named blocking errors.');
    }
    return item.name;
  });
  if (new Set(names).size !== names.length) throw new TypeError('Dependency ownership rule names must be unique.');
  return Object.freeze(names.sort());
}

export function checkVerificationOwnershipMap() {
  validateRules();
  const inventory = maintainedInventory();
  const assignments = inventory.map((file) => ownershipRule(file));
  for (const rule of RULES.filter((candidate) => candidate.impactOnly)) {
    if (!inventory.some((file) => rule.matches(file))) {
      throw new TypeError(`Verification impact rule ${rule.id} does not match the maintained inventory.`);
    }
  }
  const schemaOwners = SCHEMA_LIFECYCLE_REGISTRY.flatMap((family) => [
    family.owner,
    ...('metadata' in family ? family.metadata.hooks.map((hook) => hook.module) : []),
  ]);
  for (const owner of schemaOwners) ownershipRule(normaliseChangedPath(owner));
  if (CAPABILITY_MANIFEST.capabilities.length < 1 || CAPABILITY_MANIFEST.cliOperations.length < 1
    || new Set(CAPABILITY_MANIFEST.capabilities.map((item) => item.id)).size !== CAPABILITY_MANIFEST.capabilities.length
    || new Set(CAPABILITY_MANIFEST.cliOperations.map((item) => item.command)).size !== CAPABILITY_MANIFEST.cliOperations.length) {
    throw new TypeError('Canonical capability or CLI ownership data is incomplete.');
  }
  const privacyFamilyIds = PRIVACY_DATA_FLOW_CATALOGUE.schemaFamilies.map((item) => item.id).sort();
  const lifecycleFamilyIds = SCHEMA_LIFECYCLE_REGISTRY.map((item) => item.id).sort();
  const privacyCapabilityIds = PRIVACY_DATA_FLOW_CATALOGUE.capabilityFlows.map((item) => item.id).sort();
  const capabilityIds = CAPABILITY_MANIFEST.capabilities.map((item) => item.id).sort();
  const privacyCliCommands = PRIVACY_DATA_FLOW_CATALOGUE.cliOperationFlows.map((item) => item.command).sort();
  const cliCommands = CAPABILITY_MANIFEST.cliOperations.map((item) => item.command).sort();
  if (JSON.stringify(privacyFamilyIds) !== JSON.stringify(lifecycleFamilyIds)
    || JSON.stringify(privacyCapabilityIds) !== JSON.stringify(capabilityIds)
    || JSON.stringify(privacyCliCommands) !== JSON.stringify(cliCommands)) {
    throw new TypeError('Canonical privacy ownership data does not close over schema, capability, and CLI owners.');
  }
  const dependencyRules = readDependencyRuleNames();
  return Object.freeze({
    mapVersion: VERIFICATION_OWNERSHIP_MAP_VERSION,
    maintainedFiles: inventory.length,
    assignedFiles: assignments.length,
    ownershipAreas: new Set(assignments.map((item) => item.area)).size,
    impactAreas: new Set(inventory.flatMap((file) => matchingRules(file).map((rule) => rule.area))).size,
    schemaFamilies: SCHEMA_LIFECYCLE_REGISTRY.length,
    schemaOwnerPaths: new Set(schemaOwners).size,
    capabilities: CAPABILITY_MANIFEST.capabilities.length,
    cliOperations: CAPABILITY_MANIFEST.cliOperations.length,
    privacyProfiles: PRIVACY_DATA_FLOW_CATALOGUE.schemaPrivacyProfiles.length,
    privacyConsumerFlows: PRIVACY_DATA_FLOW_CATALOGUE.schemaConsumerFlows.length,
    blockingDependencyRules: dependencyRules.length,
    fullBatchReleaseGates: FULL_BATCH_RELEASE_GATES.length,
  });
}

export function main(args = process.argv.slice(2)): number {
  try {
    if (args.length === 1 && args[0] === '--check') {
      const result = checkVerificationOwnershipMap();
      process.stdout.write(`Verification ownership map v${result.mapVersion}: ${result.assignedFiles}/${result.maintainedFiles} files assigned across ${result.ownershipAreas} owner and ${result.impactAreas} impact areas; ${result.fullBatchReleaseGates} full gates retained.\n`);
      process.stdout.write(`Canonical closure: ${result.schemaFamilies} schema families, ${result.schemaOwnerPaths} owner paths, ${result.capabilities} capabilities, ${result.cliOperations} CLI operations, ${result.privacyProfiles} privacy profiles, ${result.privacyConsumerFlows} privacy consumer flows, ${result.blockingDependencyRules} blocking dependency rules.\n`);
      return 0;
    }
    const plan = buildVerificationOwnershipPlan(args);
    const serialised = `${JSON.stringify(plan, null, 2)}\n`;
    if (Buffer.byteLength(serialised, 'utf8') > 256 * 1024) throw new TypeError('Verification ownership plan exceeds its output byte bound.');
    process.stdout.write(serialised);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Verification ownership planning failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
