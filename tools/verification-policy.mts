import path from 'node:path';
import { isPlaywrightFunctionalSpec } from './playwright-execution-contract.mts';
import { CAPABILITY_DOCUMENT_PATH } from './capability-document-contract.mts';
import { CLI_PACKAGE_SUPPORT_FILES } from './cli-package-contract.mts';
import { isOptionalEditorConfiguration } from './maintainer-tool-helpers.mts';

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
  'capture-package',
  'local-package',
  'release-contract',
  'browser-complete',
  'browser-timing-stress-when-affected',
  'diff-whitespace',
  'staged-security',
] as const);

export type FullGate = (typeof FULL_BATCH_RELEASE_GATES)[number];
export type SpecialisedCheck =
  | 'architecture'
  | 'capability-catalogue'
  | 'privacy-catalogue'
  | 'schema-inventory'
  | 'cli-package'
  | 'capture-package'
  | 'local-package'
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

export type VerificationRule = Readonly<{
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

const unit = (...values: string[]) => Object.freeze(values);
const browser = (...values: string[]) => Object.freeze(values);
const specialised = (...values: SpecialisedCheck[]) => Object.freeze(values);

/** Discover a suite family without registering each new specification. */
export function selectBrowserSpecs(
  prefixes: readonly string[],
  inventory: readonly string[],
): readonly string[] {
  return Object.freeze(
    inventory
      .filter(
        (file) =>
          isPlaywrightFunctionalSpec(file) &&
          prefixes.some(
            (prefix) => file === `e2e/${prefix}.spec.ts` || file.startsWith(`e2e/${prefix}-`),
          ),
      )
      .sort(),
  );
}

const CASE_FORM_COMPONENT = /\/Case[A-Za-z]+Stage\.svelte$/u;

/** Curated workflow obligations, separate from import analysis and execution. */
export function createVerificationRules(
  REPOSITORY_ROOT: string,
  FUNCTIONAL_BROWSER_INVENTORY: readonly string[],
): readonly VerificationRule[] {
  const browserSpecsForPrefixes = (prefixes: readonly string[]) =>
    selectBrowserSpecs(prefixes, FUNCTIONAL_BROWSER_INVENTORY);
  return Object.freeze([
    Object.freeze({
      id: 'frontend-build',
      area: 'frontend build configuration and assets',
      priority: 10,
      matches: (value: string) => value.startsWith('frontend/'),
      focusedUnit: unit(
        'test/frontend-build-integrity.test.mts',
        'test/frontend-loading-report.test.mts',
      ),
      focusedBrowser: FUNCTIONAL_BROWSER_INVENTORY,
      specialised: specialised('architecture', 'browser-build', 'browser-loading-report'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'shared-contracts',
      area: 'shared contracts and lifecycle metadata',
      priority: 40,
      matches: (value: string) => value.startsWith('packages/contracts/'),
      focusedUnit: unit(
        'test/schema-lifecycle-registry.test.mts',
        'test/schema-lifecycle-variants.test.mts',
        'test/schema-lifecycle-repository.test.mts',
        'test/capability-manifest.test.mts',
        'test/privacy-data-flow-catalogue.test.mts',
      ),
      focusedBrowser: browser(),
      specialised: specialised(
        'architecture',
        'schema-inventory',
        'capability-catalogue',
        'privacy-catalogue',
        'critical-mutation',
      ),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'case-domain',
      area: 'Case domain and response lifecycle',
      priority: 40,
      matches: (value: string) => value.startsWith('packages/cases/'),
      focusedUnit: unit(
        'test/case-model.test.mts',
        'test/case-record-ownership.test.mts',
        'test/case-report.test.mts',
        'test/case-response-model.test.mts',
        'test/case-portability-lifecycle.test.mts',
        'test/model-contract-properties.test.mts',
      ),
      focusedBrowser: browserSpecsForPrefixes(['case', 'cases']),
      specialised: specialised(
        'architecture',
        'schema-inventory',
        'privacy-catalogue',
        'critical-mutation',
        'analyst-journey-assurance',
      ),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'case-projection-impact',
      area: 'Case persistence and audience projections',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        [
          'packages/cases/case-record-contracts.mts',
          'packages/cases/case-record-decisions.mts',
          'packages/cases/case-record-projection.mts',
          'packages/cases/case-storage-model.mts',
          'packages/contracts/case-portability.mts',
          'cli/case-pack.mts',
        ].includes(value),
      focusedUnit: unit(
        'test/case-record-ownership.test.mts',
        'test/case-portability-lifecycle.test.mts',
        'test/cli-case-pack.test.mts',
        'test/artifact-verify.test.mts',
      ),
      focusedBrowser: browser('e2e/case-import-workflows.spec.ts', 'e2e/cases.spec.ts'),
      specialised: specialised('schema-inventory', 'privacy-catalogue', 'cli-package'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'workspace-domain',
      area: 'browser-local workspace domain',
      priority: 40,
      matches: (value: string) => value.startsWith('packages/workspace/'),
      focusedUnit: unit(
        'test/shared-domain-facades.test.mts',
        'test/workspace-portability-lifecycle.test.mts',
        'test/workspace-rollback.test.mts',
        'test/model-contract-properties.test.mts',
      ),
      focusedBrowser: browser('e2e/dashboard.spec.ts', 'e2e/local-data-platform.spec.ts'),
      specialised: specialised(
        'architecture',
        'schema-inventory',
        'privacy-catalogue',
        'analyst-journey-assurance',
      ),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'evidence-domain',
      area: 'bounded evidence domain',
      priority: 40,
      matches: (value: string) =>
        value.startsWith('packages/evidence/') || value.startsWith('packages/collectors/'),
      focusedUnit: unit(
        'test/evidence-quality-properties.test.mts',
        'test/model-contract-properties.test.mts',
      ),
      focusedBrowser: browser(),
      specialised: specialised(
        'architecture',
        'privacy-catalogue',
        'staged-security',
        'critical-mutation',
      ),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'anchored-artifact-writer',
      area: 'critical anchored artefact I/O',
      priority: 50,
      matches: (value: string) => value === 'packages/web-capture/anchored-artifact-writer.mts',
      focusedUnit: unit('test/anchored-artifact-writer.test.mts'),
      focusedBrowser: browser(),
      specialised: specialised('architecture', 'critical-io-coverage', 'staged-security'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'portable-domains',
      area: 'portable domain packages',
      priority: 30,
      matches: (value: string) => value.startsWith('packages/'),
      focusedUnit: unit(
        'test/model-contract-properties.test.mts',
        'test/schema-lifecycle-registry.test.mts',
      ),
      focusedBrowser: browser(),
      specialised: specialised('architecture', 'schema-inventory', 'privacy-catalogue'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'capture-package-impact',
      area: 'optional capture package',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value.startsWith('packages/web-capture/') ||
        value.startsWith('tools/capture-package') ||
        value === 'tools/optional-package.mts',
      focusedUnit: unit('test/local-web-capture.test.mts', 'test/capture-package.test.mts'),
      focusedBrowser: browser(),
      specialised: specialised('capture-package'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'local-application-impact',
      area: 'local application and filesystem workspace',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        /(?:^|\/)local-application(?:[/.\-]|$)/u.test(value) ||
        value === 'tools/optional-package.mts' ||
        value === 'frontend/src/lib/components/LocalApplicationWorkspace.svelte',
      focusedUnit: unit(
        'test/local-application-store.test.mts',
        'test/local-application-host.test.mts',
        'test/local-application-package.test.mts',
      ),
      focusedBrowser: browserSpecsForPrefixes(['local-application']),
      specialised: specialised('local-package', 'privacy-catalogue', 'schema-inventory'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'shared-runtime',
      area: 'shared runtime and evidence orchestration',
      priority: 30,
      matches: (value: string) => value.startsWith('lib/'),
      focusedUnit: unit(
        'test/model-contract-properties.test.mts',
        'test/evidence-quality-properties.test.mts',
      ),
      focusedBrowser: browser(),
      specialised: specialised(
        'architecture',
        'privacy-catalogue',
        'staged-security',
        'critical-mutation',
      ),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'cli',
      area: 'CLI command and installed-package surface',
      priority: 35,
      matches: (value: string) => value.startsWith('cli/') || value.startsWith('bin/'),
      focusedUnit: unit(
        'test/cli-command-registry.test.mts',
        'test/cli-process.test.mts',
        'test/cli-investigation-run.test.mts',
      ),
      focusedBrowser: browser(),
      specialised: specialised(
        'architecture',
        'schema-inventory',
        'privacy-catalogue',
        'cli-package',
        'release-contract',
        'staged-security',
      ),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'cli-command-contract-impact',
      area: 'CLI command grammar and generated references',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        [
          'packages/contracts/cli-command-semantics.mts',
          'packages/contracts/cli-command-catalogue.mts',
          'cli/command-reference.mts',
          'cli/command-argument-grammar.mts',
          'cli/arguments.mts',
          'cli/command-catalogue.mts',
          'cli/completion.mts',
          'cli/manual.mts',
        ].includes(value),
      focusedUnit: unit('test/cli-command-registry.test.mts', 'test/cli-process.test.mts'),
      focusedBrowser: browser(),
      specialised: specialised(
        'capability-catalogue',
        'privacy-catalogue',
        'schema-inventory',
        'cli-package',
        'release-contract',
      ),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'hosted-functions',
      area: 'hosted bounded functions',
      priority: 35,
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
      id: 'frontend-model',
      area: 'frontend analysis and controller models',
      priority: 40,
      matches: (value: string) =>
        value.startsWith('frontend/src/lib/analysis/') ||
        value.startsWith('frontend/src/lib/controllers/'),
      focusedUnit: unit(),
      focusedBrowser: browser('e2e/accessibility.spec.ts'),
      specialised: specialised('architecture', 'privacy-catalogue', 'analyst-journey-assurance'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'case-response-form',
      area: 'Case response forms and submitted drafts',
      priority: 45,
      matches: (value: string) => CASE_FORM_COMPONENT.test(value),
      focusedUnit: unit('test/case-response-form-values.test.mts', 'test/submitted-draft.test.mts'),
      focusedBrowser: browser(
        'e2e/accessibility.spec.ts',
        ...browserSpecsForPrefixes(['case-response-stages', 'case-workspace', 'submitted-drafts']),
      ),
      specialised: specialised('architecture'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'frontend-user-interface',
      area: 'frontend user-facing routes and components',
      priority: 30,
      matches: (value: string) => value.startsWith('frontend/src/'),
      focusedUnit: unit(),
      focusedBrowser: browser('e2e/accessibility.spec.ts'),
      specialised: specialised('architecture', 'analyst-journey-assurance'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'frontend-navigation-impact',
      area: 'shared navigation, theme, and layout behaviour',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value === 'frontend/src/app.css' ||
        value === 'frontend/src/lib/workspaces.ts' ||
        /\/console-(?:command-navigation|workflow-state)\.ts$/u.test(value) ||
        /\/\+layout(?:\.svelte|\.ts)$/u.test(value) ||
        /\/(?:CommandPalette|LocalSectionNav|PageHeading|PublicReferenceSidebar|SiteFooter|ThemeSelector)\.svelte$/u.test(
          value,
        ),
      focusedUnit: unit('test/public-product-catalogue.test.mts'),
      focusedBrowser: browserSpecsForPrefixes([
        'console-workflow',
        'console-workspace',
        'design-system',
        'mobile-nav',
        'skip-navigation',
        'theme',
      ]),
      specialised: specialised('browser-timing-plan'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'frontend-lookup-impact',
      area: 'Lookup analyst workflow',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value.startsWith('frontend/src/') &&
        (value.includes('/lookup/') ||
          /\/(?:Lookup|lookup-)[^/]*\.(?:svelte|ts|mts)$/u.test(value)),
      focusedUnit: unit(
        'test/lookup-request-controller.test.mts',
        'test/lookup-route-analysis.test.mts',
      ),
      focusedBrowser: browserSpecsForPrefixes(['lookup']),
      specialised: specialised('privacy-catalogue', 'browser-timing-plan'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'frontend-bulk-impact',
      area: 'Bulk analyst workflow',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value.startsWith('frontend/src/') &&
        (value.includes('/bulk/') || /\/(?:Bulk|bulk-)[^/]*\.(?:svelte|ts|mts)$/u.test(value)),
      focusedUnit: unit('test/bulk-route-model.test.mts', 'test/bulk-session-model.test.mts'),
      focusedBrowser: browserSpecsForPrefixes(['bulk']),
      specialised: specialised('privacy-catalogue', 'browser-timing-plan'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'frontend-brand-impact',
      area: 'Brand and campaign analyst workflow',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value.startsWith('frontend/src/') &&
        (value.includes('/brands/') ||
          value === 'frontend/src/lib/campaigns.ts' ||
          /\/(?:Brand|Campaign|brand-|campaign-)[^/]*\.(?:svelte|ts|mts)$/u.test(value)),
      focusedUnit: unit('test/brand-profile-model.test.mts', 'test/campaign-model.test.mts'),
      focusedBrowser: browser(
        ...FUNCTIONAL_BROWSER_INVENTORY.filter((file) =>
          /(?:^|[-/])(?:brand|campaign)[-.]/u.test(file),
        ),
      ),
      specialised: specialised('privacy-catalogue', 'browser-timing-plan'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'frontend-case-impact',
      area: 'Case analyst workflow',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value.startsWith('frontend/src/') &&
        !CASE_FORM_COMPONENT.test(value) &&
        (value === 'frontend/src/lib/cases.ts' ||
          /\/(?:Case|case-)[^/]*\.(?:svelte|ts|mts)$/u.test(value)),
      focusedUnit: unit(
        'test/case-model.test.mts',
        'test/case-report.test.mts',
        'test/case-response-model.test.mts',
      ),
      focusedBrowser: browserSpecsForPrefixes(['case', 'cases']),
      specialised: specialised('privacy-catalogue'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'frontend-monitor-impact',
      area: 'Monitoring analyst workflow',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value.startsWith('frontend/src/') &&
        (value.includes('/monitor/') ||
          value === 'frontend/src/lib/scheduled-monitoring.ts' ||
          value === 'frontend/src/lib/watchlists.ts' ||
          /\/(?:HostedWatchlist|Monitor|Watchlist|monitor-|watchlist-)[^/]*\.(?:svelte|ts|mts)$/u.test(
            value,
          )),
      focusedUnit: unit('test/watchlist-store.test.mts', 'test/scheduled-monitor-model.test.mts'),
      focusedBrowser: browser(
        'e2e/hosted-monitoring.spec.ts',
        'e2e/lookup-case-monitoring.spec.ts',
        'e2e/watchlist-storage.spec.ts',
      ),
      specialised: specialised('privacy-catalogue', 'browser-timing-plan'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'frontend-dashboard-impact',
      area: 'Dashboard analyst workflow',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value.startsWith('frontend/src/') &&
        (value.includes('/dashboard/') || /\/Dashboard[^/]*\.svelte$/u.test(value)),
      focusedUnit: unit('test/analyst-review-inbox.test.mts'),
      focusedBrowser: browser(
        'e2e/analyst-context.spec.ts',
        'e2e/local-data-platform.spec.ts',
        ...browserSpecsForPrefixes(['dashboard', 'console-workflow']),
      ),
      specialised: specialised('browser-timing-plan'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'browser-local-data-impact',
      area: 'browser-local persistence and migration behaviour',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        /^frontend\/src\/lib\/browser-local-data(?:-[^/]+)?\.ts$/u.test(value),
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
      id: 'frontend-public-reference-impact',
      area: 'public documentation and reference experience',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value.startsWith('frontend/src/routes/(public)/') ||
        /\/PublicReference[^/]*\.svelte$/u.test(value),
      focusedUnit: unit('test/public-guide.test.mts', 'test/public-product-catalogue.test.mts'),
      focusedBrowser: browser(
        'e2e/public-guide.spec.ts',
        'e2e/public-product-batch3.spec.ts',
        'e2e/seo.spec.ts',
      ),
      specialised: specialised('documentation', 'capability-catalogue'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'frontend-deferred-loading-impact',
      area: 'deferred loading and recovery behaviour',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        /\/(?:DeferredSurface|deferred-|console-loading)[^/]*\.(?:svelte|ts|mts)$/u.test(value),
      focusedUnit: unit('test/deferred-module.test.mts'),
      focusedBrowser: browser(
        'e2e/console-loading.spec.ts',
        'e2e/deferred-interactions.spec.ts',
        'e2e/deferred-recovery.spec.ts',
      ),
      specialised: specialised('browser-timing-plan'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'verification-tooling',
      area: 'maintainer verification tooling',
      priority: 30,
      matches: (value: string) => value.startsWith('tools/'),
      focusedUnit: unit('test/ci-workflow.test.mts', 'test/verification-architecture.test.mts'),
      focusedBrowser: browser(),
      specialised: specialised('architecture', 'workflow-closure'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'schema-tooling-impact',
      area: 'schema inventory and lifecycle verification',
      priority: 0,
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
      id: 'privacy-tooling-impact',
      area: 'privacy catalogue verification',
      priority: 0,
      impactOnly: true,
      matches: (value: string) => value.startsWith('tools/privacy-data-flow-'),
      focusedUnit: unit(
        'test/privacy-data-flow-catalogue.test.mts',
        'test/privacy-contract.test.mts',
      ),
      focusedBrowser: browser('e2e/privacy-data-flow-catalogue.spec.ts'),
      specialised: specialised('privacy-catalogue', 'schema-inventory'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'public-product-tooling-impact',
      area: 'public product and capability verification',
      priority: 0,
      impactOnly: true,
      matches: (value: string) => /^tools\/(?:capability|public-product)/u.test(value),
      focusedUnit: unit(
        'test/capability-manifest.test.mts',
        'test/public-product-catalogue.test.mts',
      ),
      focusedBrowser: browser('e2e/capabilities.spec.ts', 'e2e/public-product-batch3.spec.ts'),
      specialised: specialised('capability-catalogue', 'documentation'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'browser-build-tooling-impact',
      area: 'browser build and CI parity verification',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value === 'tools/ci-verification.mts' ||
        value === 'tools/frontend-build-integrity.mts' ||
        value === 'tools/frontend-loading-report.mts' ||
        value.startsWith('tools/playwright-') ||
        value === 'tools/verification-artifact-status.mts',
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
      id: 'browser-build-artifact-impact',
      area: 'production browser build artefact verification',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value === 'tools/frontend-build-integrity.mts' ||
        value === 'tools/frontend-loading-report.mts',
      focusedUnit: unit(
        'test/frontend-build-integrity.test.mts',
        'test/frontend-loading-report.test.mts',
      ),
      focusedBrowser: browser(),
      specialised: specialised('browser-build', 'browser-loading-report'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'browser-test-artifact-impact',
      area: 'browser test artefact hand-off',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        [
          '.github/workflows/ci.yml',
          'tools/ci-verification.mts',
          'tools/frontend-build-integrity.mts',
          'tools/hosted-browser-workspace.mts',
          'tools/playwright-balanced-suite.mts',
          'tools/playwright-balanced-shard.mts',
          'e2e/deferred-recovery.spec.ts',
        ].includes(value),
      focusedUnit: unit(
        'test/frontend-build-integrity.test.mts',
        'test/ci-workflow.test.mts',
        'test/verification-architecture.test.mts',
      ),
      focusedBrowser: browser('e2e/deferred-recovery.spec.ts'),
      specialised: specialised('browser-build', 'browser-timing-plan', 'workflow-closure'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'unit-tests',
      area: 'unit and model verification',
      priority: 30,
      matches: (value: string) => value.startsWith('test/'),
      focusedUnit: unit(),
      focusedBrowser: browser(),
      specialised: specialised('architecture'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'browser-support-impact',
      area: 'shared browser setup and support verification',
      priority: 0,
      impactOnly: true,
      matches: (value: string) => value.startsWith('e2e/') && !value.endsWith('.spec.ts'),
      focusedUnit: unit('test/verification-architecture.test.mts'),
      focusedBrowser: FUNCTIONAL_BROWSER_INVENTORY,
      specialised: specialised('browser-timing-plan', 'analyst-journey-assurance'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'browser-tests',
      area: 'browser and analyst-journey verification',
      priority: 30,
      matches: (value: string) => value.startsWith('e2e/'),
      focusedUnit: unit('test/synthetic-analyst-journeys.test.mts'),
      focusedBrowser: browser(),
      specialised: specialised('browser-timing-plan', 'analyst-journey-assurance'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'privacy-documents',
      area: 'privacy and data-flow documentation',
      priority: 45,
      matches: (value: string) => value === 'PRIVACY.md' || value.startsWith('docs/privacy-'),
      focusedUnit: unit(
        'test/documentation-links.test.mts',
        'test/privacy-data-flow-catalogue.test.mts',
        'test/privacy-contract.test.mts',
      ),
      focusedBrowser: browser(),
      specialised: specialised('privacy-catalogue', 'documentation'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'privacy-contract-impact',
      area: 'privacy contract and disclosure surfaces',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        (!value.endsWith('.md') && value.includes('privacy-data-flow')) ||
        value.startsWith('frontend/src/routes/(public)/privacy/'),
      focusedUnit: unit(
        'test/privacy-data-flow-catalogue.test.mts',
        'test/privacy-contract.test.mts',
      ),
      focusedBrowser: browser('e2e/privacy-data-flow-catalogue.spec.ts'),
      specialised: specialised('privacy-catalogue', 'schema-inventory', 'documentation'),
      browserRequired: true,
    }),
    Object.freeze({
      id: 'workflow-definitions',
      area: 'hosted verification workflows',
      priority: 40,
      matches: (value: string) => value.startsWith('.github/workflows/'),
      focusedUnit: unit('test/ci-workflow.test.mts', 'test/workflow-shells.integration.test.mts'),
      focusedBrowser: browser(),
      specialised: specialised('workflow-closure', 'staged-security'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'documentation',
      area: 'maintained public documentation',
      priority: 42,
      matches: (value: string) =>
        (/^[^/]+\.md$/u.test(value) && value !== 'THIRD_PARTY_NOTICES.md') ||
        value.startsWith('docs/') ||
        ((value.startsWith('packages/') || value.startsWith('.github/')) && value.endsWith('.md')),
      focusedUnit: unit(
        'test/documentation-links.test.mts',
        'test/documentation-contract.test.mts',
      ),
      focusedBrowser: browser(),
      specialised: specialised('documentation'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'generated-capability-document',
      area: 'generated capability reference',
      priority: 45,
      matches: (value: string) =>
        path.resolve(REPOSITORY_ROOT, value) === path.resolve(REPOSITORY_ROOT, CAPABILITY_DOCUMENT_PATH),
      focusedUnit: unit('test/capability-manifest.test.mts', 'test/documentation-links.test.mts'),
      focusedBrowser: browser(),
      specialised: specialised('capability-catalogue', 'documentation'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'cli-documentation-impact',
      area: 'installed CLI documentation',
      priority: 0,
      impactOnly: true,
      matches: (value: string) =>
        value.endsWith('.md') && CLI_PACKAGE_SUPPORT_FILES.some(([source]) => source === value),
      focusedUnit: unit('test/cli-command-registry.test.mts', 'test/cli-package-boundary.test.mts'),
      focusedBrowser: browser(),
      specialised: specialised('documentation'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'editor-configuration',
      area: 'optional editor formatting',
      priority: 30,
      matches: isOptionalEditorConfiguration,
      focusedUnit: unit(),
      focusedBrowser: browser(),
      specialised: specialised('staged-security'),
      browserRequired: false,
    }),
    Object.freeze({
      id: 'package-release',
      area: 'package, dependency, and release metadata',
      priority: 30,
      matches: (value: string) =>
        [
          'package.json',
          'package-lock.json',
          'THIRD_PARTY_NOTICES.md',
          '.nvmrc',
          'playwright.config.ts',
          'tsconfig.json',
        ].includes(value),
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
        'capture-package',
        'local-package',
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
}
