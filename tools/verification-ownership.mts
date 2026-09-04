#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAPABILITY_MANIFEST } from '../packages/contracts/capability-manifest.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { PRIVACY_DATA_FLOW_CATALOGUE } from './privacy-data-flow-catalogue-renderer.mts';

export const VERIFICATION_OWNERSHIP_MAP_VERSION = 1;
export const MAX_VERIFICATION_CHANGED_PATHS = 128;
export const MAX_VERIFICATION_CHANGED_PATH_LENGTH = 320;
export const MAX_VERIFICATION_OWNERSHIP_RULES = 64;
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
  | 'browser-timing-plan'
  | 'analyst-journey-assurance'
  | 'critical-mutation'
  | 'critical-io-coverage';

type OwnershipRule = Readonly<{
  id: string;
  area: string;
  priority: number;
  matches: (changedPath: string) => boolean;
  focusedUnit: readonly string[];
  focusedBrowser: readonly string[];
  specialised: readonly SpecialisedCheck[];
  browserRequired: boolean;
}>;

export type VerificationOwnershipAssignment = Readonly<{
  changedPath: string;
  ownershipArea: string;
  focusedUnitChecks: readonly string[];
  focusedBrowserChecks: readonly string[];
  mandatorySpecialisedChecks: readonly SpecialisedCheck[];
  userFacingBrowserRequired: boolean;
}>;

export type VerificationOwnershipPlan = Readonly<{
  mapVersion: 1;
  changedPaths: readonly string[];
  assignments: readonly VerificationOwnershipAssignment[];
  ownershipAreas: readonly string[];
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

const RULES: readonly OwnershipRule[] = Object.freeze([
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
    focusedUnit: unit('test/netlify-functions.test.mts', 'test/outbound-request-bounds.test.mts'),
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
    focusedBrowser: browser('e2e/design-system.spec.ts', 'e2e/accessibility.spec.ts', 'e2e/mobile-nav.spec.ts'),
    specialised: specialised('architecture', 'privacy-catalogue', 'analyst-journey-assurance'),
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
    matches: (value: string) => value === 'PRIVACY.md' || value.startsWith('docs/privacy-') || value.includes('privacy-data-flow'),
    focusedUnit: unit('test/privacy-data-flow-catalogue.test.mts', 'test/privacy-docs.test.mts'), focusedBrowser: browser('e2e/privacy-data-flow-catalogue.spec.ts'),
    specialised: specialised('privacy-catalogue', 'schema-inventory', 'documentation'), browserRequired: true,
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
  try { return statSync(path.join(REPOSITORY_ROOT, value)).isFile(); } catch { return false; }
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

function matchingRule(changedPath: string): OwnershipRule {
  const matches = RULES.filter((rule) => rule.matches(changedPath));
  if (!matches.length) throw new TypeError(`Unknown maintained ownership area for ${changedPath}.`);
  const priority = Math.max(...matches.map((rule) => rule.priority));
  const selected = matches.filter((rule) => rule.priority === priority);
  if (selected.length !== 1) throw new TypeError(`Ambiguous verification ownership for ${changedPath}.`);
  return selected[0]!;
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort() as T[]);
}

export function buildVerificationOwnershipPlan(rawPaths: readonly string[]): VerificationOwnershipPlan {
  if (!Array.isArray(rawPaths) || rawPaths.length < 1 || rawPaths.length > MAX_VERIFICATION_CHANGED_PATHS) {
    throw new TypeError(`Verification plan requires 1 to ${MAX_VERIFICATION_CHANGED_PATHS} changed paths.`);
  }
  const changedPaths = rawPaths.map(normaliseChangedPath);
  if (new Set(changedPaths).size !== changedPaths.length) throw new TypeError('Verification plan changed paths must not repeat.');
  const assignments = changedPaths.sort().map((changedPath): VerificationOwnershipAssignment => {
    const rule = matchingRule(changedPath);
    const focusedUnitChecks = uniqueSorted([...rule.focusedUnit.filter(existingTest), ...exactFocusedChecks(changedPath)]);
    const focusedBrowserChecks = uniqueSorted([...rule.focusedBrowser.filter(existingTest), ...exactBrowserChecks(changedPath)]);
    if (rule.browserRequired && focusedBrowserChecks.length === 0) {
      throw new TypeError(`User-facing ownership for ${changedPath} has no focused browser check.`);
    }
    return Object.freeze({
      changedPath,
      ownershipArea: rule.area,
      focusedUnitChecks,
      focusedBrowserChecks,
      mandatorySpecialisedChecks: uniqueSorted(rule.specialised),
      userFacingBrowserRequired: rule.browserRequired,
    });
  });
  return Object.freeze({
    mapVersion: VERIFICATION_OWNERSHIP_MAP_VERSION,
    changedPaths: Object.freeze(changedPaths),
    assignments: Object.freeze(assignments),
    ownershipAreas: uniqueSorted(assignments.map((item) => item.ownershipArea)),
    focusedUnitChecks: uniqueSorted(assignments.flatMap((item) => item.focusedUnitChecks)),
    focusedBrowserChecks: uniqueSorted(assignments.flatMap((item) => item.focusedBrowserChecks)),
    mandatorySpecialisedChecks: uniqueSorted(assignments.flatMap((item) => item.mandatorySpecialisedChecks)),
    userFacingBrowserRequired: assignments.some((item) => item.userFacingBrowserRequired),
    fullBatchReleaseGates: FULL_BATCH_RELEASE_GATES,
    interpretation: Object.freeze([
      'Focused checks support iteration only and do not establish batch or release readiness.',
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
  if (RULES.length < 1 || RULES.length > MAX_VERIFICATION_OWNERSHIP_RULES || new Set(RULES.map((rule) => rule.id)).size !== RULES.length) {
    throw new TypeError('Verification ownership rules are missing, repeated, or unbounded.');
  }
  const inventory = maintainedInventory();
  const assignments = inventory.map((file) => matchingRule(file));
  const schemaOwners = SCHEMA_LIFECYCLE_REGISTRY.flatMap((family) => [
    family.owner,
    ...('metadata' in family ? family.metadata.hooks.map((hook) => hook.module) : []),
  ]);
  for (const owner of schemaOwners) matchingRule(normaliseChangedPath(owner));
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
      process.stdout.write(`Verification ownership map v${result.mapVersion}: ${result.assignedFiles}/${result.maintainedFiles} files assigned across ${result.ownershipAreas} areas; ${result.fullBatchReleaseGates} full gates retained.\n`);
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
