#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAPABILITY_MANIFEST } from '../packages/contracts/capability-manifest.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { isPlaywrightFunctionalSpec } from './playwright-execution-contract.mts';
import { PRIVACY_DATA_FLOW_CATALOGUE } from './privacy-data-flow-catalogue-renderer.mts';
import { readVerificationTestInventory } from './verification-timing-profile.mts';
import { browserRouteReferences, browserTestsForRoutes } from './browser-route-impact.mts';
import type { ICruiseResult, IOptions } from 'dependency-cruiser';
import { createVerificationRules, selectBrowserSpecs, type SpecialisedCheck, type VerificationRule } from './verification-policy.mts';
import { indexRuntimeConsumers, describeRuntimeImportGaps } from './runtime-test-consumers.mts';
export type { SpecialisedCheck } from './verification-policy.mts';

export const VERIFICATION_OWNERSHIP_MAP_VERSION = 3;
export const MAX_VERIFICATION_CHANGED_PATH_LENGTH = 320;
export const MAX_VERIFICATION_INVENTORY_FILES = 8_000;
export const MAX_VERIFICATION_CHANGED_PATHS = MAX_VERIFICATION_INVENTORY_FILES;

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_CHANGED_PATH = /^(?:[a-zA-Z0-9._+()@\[\]-]+\/)*[a-zA-Z0-9._+()@\[\]-]+$/u;

export type VerificationOwnershipAssignment = Readonly<{
  changedPath: string;
  ownershipArea: string;
  impactAreas: readonly string[];
  selectionNotes: readonly string[];
  focusedUnitChecks: readonly string[];
  focusedBrowserChecks: readonly string[];
  mandatorySpecialisedChecks: readonly SpecialisedCheck[];
  userFacingBrowserRequired: boolean;
}>;

export type VerificationOwnershipPlan = Readonly<{
  mapVersion: typeof VERIFICATION_OWNERSHIP_MAP_VERSION;
  changedPaths: readonly string[];
  conservativeFallbackPaths: readonly string[];
  assignments: readonly VerificationOwnershipAssignment[];
  ownershipAreas: readonly string[];
  impactAreas: readonly string[];
  focusedUnitChecks: readonly string[];
  focusedBrowserChecks: readonly string[];
  mandatorySpecialisedChecks: readonly SpecialisedCheck[];
  userFacingBrowserRequired: boolean;
  fullVerificationScript: string;
  interpretation: readonly string[];
}>;

const specialised = (...values: SpecialisedCheck[]) => Object.freeze(values);

function functionalBrowserInventory(): readonly string[] {
  const values = readdirSync(path.join(REPOSITORY_ROOT, 'e2e'), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `e2e/${entry.name}`)
    .filter(isPlaywrightFunctionalSpec)
    .sort();
  if (values.length < 1 || values.length > MAX_VERIFICATION_CHANGED_PATHS) {
    throw new TypeError('Functional browser verification inventory is missing or unbounded.');
  }
  return Object.freeze(values);
}

const FUNCTIONAL_BROWSER_INVENTORY = functionalBrowserInventory();

const RULES = createVerificationRules(REPOSITORY_ROOT, FUNCTIONAL_BROWSER_INVENTORY);
const CONSERVATIVE_FALLBACK: VerificationRule = Object.freeze({
  id: 'unclassified', area: 'unclassified surface: conservative verification', priority: -1,
  matches: () => true,
  focusedUnit: Object.freeze(readVerificationTestInventory().filter(file => file.startsWith('test/'))),
  focusedBrowser: FUNCTIONAL_BROWSER_INVENTORY,
  specialised: Object.freeze([...new Set(RULES.flatMap(rule => rule.specialised))].sort()),
  browserRequired: true,
});
export function browserSpecsForPrefixes(prefixes: readonly string[], inventory = FUNCTIONAL_BROWSER_INVENTORY): readonly string[] {
  return selectBrowserSpecs(prefixes, inventory);
}

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
  if (RULES.length < 1 || new Set(RULES.map((rule) => rule.id)).size !== RULES.length) {
    throw new TypeError('Verification rules are missing or repeated.');
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
  if (/^test\/[^/]+\.test\.mts$/u.test(changedPath) && existingTest(changedPath)) return Object.freeze([changedPath]);
  if (changedPath.startsWith('e2e/') && /\.(?:spec|setup)\.ts$/u.test(changedPath)) return Object.freeze([]);
  const basename = path.posix.basename(changedPath).replace(/\.(?:mts|ts|svelte|json|md|yml|yaml)$/u, '');
  return Object.freeze([
    `test/${basename}.test.mts`,
    `test/${basename}-contract.test.mts`,
    `test/${basename}-model.test.mts`,
  ].filter(existingTest));
}

function exactBrowserChecks(changedPath: string): readonly string[] {
  if (changedPath.startsWith('e2e/') && changedPath.endsWith('.spec.ts') && existingTest(changedPath)) return Object.freeze([changedPath]);
  return Object.freeze([]);
}

function matchingRules(changedPath: string): readonly VerificationRule[] {
  const matches = RULES.filter((rule) => rule.matches(changedPath));
  // A test does not change the production owner whose name it happens to share.
  // Shared test helpers still follow their real consumers through the graph.
  if (/^test\/[^/]+\.test\.mts$/u.test(changedPath)) return Object.freeze([ownershipRule(changedPath, matches)]);
  return Object.freeze([ownershipRule(changedPath, matches), ...matches.filter((rule) => rule.impactOnly)]);
}

function ownershipRule(changedPath: string, matches: readonly VerificationRule[] = RULES.filter((rule) => rule.matches(changedPath))): VerificationRule {
  const owners = matches.filter((rule) => !rule.impactOnly);
  if (!owners.length) return CONSERVATIVE_FALLBACK;
  const priority = Math.max(...owners.map((rule) => rule.priority));
  const selected = owners.filter((rule) => rule.priority === priority);
  if (selected.length !== 1) return CONSERVATIVE_FALLBACK;
  return selected[0]!;
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort() as T[]);
}

export function buildVerificationOwnershipPlan(
  rawPaths: readonly string[],
  importedTests: ReadonlyMap<string, readonly string[]> = new Map(),
  importedBrowserTests: ReadonlyMap<string, readonly string[]> = new Map(),
  routeConsumers: ReadonlyMap<string, readonly string[]> = new Map(),
  componentContracts: ReadonlyMap<string, readonly string[]> = new Map(),
): VerificationOwnershipPlan {
  validateRules();
  if (!Array.isArray(rawPaths) || rawPaths.length < 1 || rawPaths.length > MAX_VERIFICATION_CHANGED_PATHS) {
    throw new TypeError(`Verification plan requires 1 to ${MAX_VERIFICATION_CHANGED_PATHS} changed paths.`);
  }
  const changedPaths = rawPaths.map(normaliseChangedPath);
  if (new Set(changedPaths).size !== changedPaths.length) throw new TypeError('Verification plan changed paths must not repeat.');
  const assignments = changedPaths.sort().map((changedPath): VerificationOwnershipAssignment => {
    const directImpacts = matchingRules(changedPath);
    const owner = ownershipRule(changedPath, directImpacts);
    const componentChecks = componentContracts.get(changedPath) ?? [];
    const discoverRouteCoverage = !componentChecks.length && ['frontend-user-interface', 'frontend-model'].includes(owner.id)
      && directImpacts.length === 1;
    const consumers = routeConsumers.get(changedPath) ?? [];
    const routes = discoverRouteCoverage ? consumers.filter(file => file.startsWith('frontend/src/routes/')) : [];
    const routeImpacts = routes.flatMap(matchingRules);
    // A helper extracted from a storage or loading owner inherits that owner's
    // cross-cutting checks through real imports, not a new filename exception.
    const inheritedImpacts = (componentChecks.length ? [] : consumers).filter(file => !file.startsWith('frontend/src/routes/'))
      .flatMap(matchingRules).filter(rule => rule.impactOnly);
    const impacts = [...new Map([...directImpacts, ...routeImpacts, ...inheritedImpacts].map(rule => [rule.id, rule])).values()];
    const focusedUnitChecks = uniqueSorted([
      ...impacts.flatMap((rule) => rule.focusedUnit),
      ...exactFocusedChecks(changedPath),
      ...(importedTests.get(changedPath) ?? []),
    ]);
    // Existing route owners explain components and their controller/model
    // dependencies. A new helper does not need a separate workflow declaration.
    const unclassifiedRoutes = routes.filter(route => matchingRules(route).length === 1);
    const unexplainedInterface = discoverRouteCoverage
      && (!routes.length || unclassifiedRoutes.length > 0);
    const focusedBrowserChecks = uniqueSorted([
      ...(componentChecks.length ? componentChecks : impacts.flatMap((rule) => rule.focusedBrowser)),
      ...[changedPath, ...routes].flatMap(file => {
        const route = /^frontend\/src\/routes\/\([^/]+\)\/([^/]+)\/\+page\.(?:svelte|ts)$/u.exec(file)?.[1];
        return route ? browserSpecsForPrefixes([route]) : [];
      }),
      ...exactBrowserChecks(changedPath),
      ...(importedBrowserTests.get(changedPath) ?? []),
      ...(unexplainedInterface ? FUNCTIONAL_BROWSER_INVENTORY : []),
    ]);
    const browserRequired = impacts.some((rule) => rule.browserRequired)
      || (importedBrowserTests.get(changedPath)?.length ?? 0) > 0;
    if (browserRequired && focusedBrowserChecks.length === 0) {
      throw new TypeError(`User-facing ownership for ${changedPath} has no focused browser check.`);
    }
    return Object.freeze({
      changedPath,
      ownershipArea: owner.area,
      impactAreas: uniqueSorted(impacts.map((rule) => rule.area)),
      selectionNotes: Object.freeze(owner === CONSERVATIVE_FALLBACK
        ? ['No unique classified owner: select complete unit and functional browser inventories, compiler checks and all specialised checks.']
        : unexplainedInterface
        ? [unclassifiedRoutes.length
          ? `Full browser coverage: no classified route owner for ${unclassifiedRoutes.join(', ')}.`
          : 'Full browser coverage: no consuming route could be established for this interface.']
        : []),
      focusedUnitChecks,
      focusedBrowserChecks,
      mandatorySpecialisedChecks: /^test\/[^/]+\.test\.mts$/u.test(changedPath) ? specialised()
        : componentChecks.length ? specialised('architecture') : uniqueSorted(impacts.flatMap((rule) => rule.specialised)),
      userFacingBrowserRequired: browserRequired,
    });
  });
  return Object.freeze({
    mapVersion: VERIFICATION_OWNERSHIP_MAP_VERSION,
    changedPaths: Object.freeze(changedPaths),
    conservativeFallbackPaths: Object.freeze(changedPaths.filter(file => ownershipRule(file) === CONSERVATIVE_FALLBACK)),
    assignments: Object.freeze(assignments),
    ownershipAreas: uniqueSorted(assignments.map((item) => item.ownershipArea)),
    impactAreas: uniqueSorted(assignments.flatMap((item) => item.impactAreas)),
    focusedUnitChecks: uniqueSorted(assignments.flatMap((item) => item.focusedUnitChecks)),
    focusedBrowserChecks: uniqueSorted(assignments.flatMap((item) => item.focusedBrowserChecks)),
    mandatorySpecialisedChecks: uniqueSorted(assignments.flatMap((item) => item.mandatorySpecialisedChecks)),
    userFacingBrowserRequired: assignments.some((item) => item.userFacingBrowserRequired),
    fullVerificationScript: 'verification:ci',
    interpretation: Object.freeze([
      'Focused checks support iteration only and do not establish batch or release readiness.',
      'Each path selects its most specific owner plus explicit cross-cutting impacts, not every ancestor owner.',
      'Every full batch and release gate remains mandatory regardless of this focused plan.',
      'Timing-sensitive changes also require test:e2e:stress; release-only checks, including the production dependency audit, follow docs/releasing.md.',
      'The plan is request-free and contains test and check identities, never executable shell fragments.',
      'Known browser families discover their current specifications; components and frontend models inherit resolved route owners, while unexplained interfaces select the complete functional inventory.',
    ]),
  });
}

/** Convenience entry point for a standalone dependency selection. Full plans
 * share one index across unit, browser and route consumers below. */
export function importedTestConsumers(
  changedPaths: readonly string[], graph: Pick<ICruiseResult, 'modules'>,
  inventory: readonly string[], fallbackWhenUnused = true,
): ReadonlyMap<string, readonly string[]> {
  return indexRuntimeConsumers(graph, MAX_VERIFICATION_INVENTORY_FILES)
    .select(changedPaths, inventory, fallbackWhenUnused).consumers;
}

/** A leaf UI contract is co-located by name, never a second source/test registry.
 * Local dependencies or an explicit cross-cutting owner retain workflow coverage.
 * Complete browser coverage remains mandatory at the integration boundary. */
export function leafComponentContracts(
  files: readonly string[], graph: Pick<ICruiseResult, 'modules'>, inventory: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  return new Map(files.flatMap(file => {
    const name = /^frontend\/src\/lib\/components\/([A-Z][A-Za-z0-9]*)\.svelte$/u.exec(file)?.[1];
    if (!name || matchingRules(file).length !== 1) return [];
    const module = graph.modules.find(module => module.source === file);
    if (!module || module.dependencies.some(dependency => dependency.couldNotResolve
      || !(dependency.module === 'svelte' || dependency.module.startsWith('svelte/')))) return [];
    const spec = `e2e/${name.replace(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase()}.component.spec.ts`;
    return inventory.includes(spec) ? [[file, Object.freeze([spec])] as const] : [];
  }));
}

/** Report the failed operation and an allowlisted category, never source paths
 * or arbitrary parser/transport text from a thrown error. */
export function dependencyAnalysisFailure(stage: string, error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const category = typeof code === 'string' && ['ENOENT', 'EACCES', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(code)
    ? code : error instanceof SyntaxError ? 'invalid syntax' : error instanceof TypeError ? 'invalid analysis data' : 'analysis error';
  return `Dependency analysis failed while ${stage} (${category}): the focused plan falls back to the complete unit and functional browser inventories.`;
}

export async function createVerificationOwnershipPlan(rawPaths: readonly string[]): Promise<VerificationOwnershipPlan> {
  const initial = buildVerificationOwnershipPlan(rawPaths);
  const importedPaths = initial.changedPaths.filter((file) => /\.(?:[cm]?[jt]s|json|svelte)$/u.test(file)
    && !['editor-configuration', CONSERVATIVE_FALLBACK.id].includes(ownershipRule(file).id)
    && !file.startsWith('e2e/') && !/^test\/[^/]+\.test\.mts$/u.test(file));
  if (!importedPaths.length) return initial;
  const inventory = readVerificationTestInventory().filter((file) => file.startsWith('test/'));
  const browserInventory = functionalBrowserInventory();
  let selection: ReadonlyMap<string, readonly string[]>;
  let browserSelection: ReadonlyMap<string, readonly string[]>;
  let routeConsumers: ReadonlyMap<string, readonly string[]> = new Map();
  let componentContracts: ReadonlyMap<string, readonly string[]> = new Map();
  let explanation: string;
  let stage = 'loading the dependency analyser';
  try {
    const { cruise } = await import('dependency-cruiser');
    stage = 'reading dependency configuration';
    const config = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, '.dependency-cruiser.json'), 'utf8')) as { options: IOptions };
    const components = importedPaths.filter(file => file.endsWith('.svelte'));
    const frontendPaths = importedPaths.filter(file => file.startsWith('frontend/src/'));
    const routeEntriesOnly = importedPaths.every(file => /^frontend\/src\/routes\/.*\+(?:page|layout)\.svelte$/u.test(file));
    // Node unit tests cannot import Svelte components directly. Their explicit
    // source-contract checks remain selected by owner/name; do not load every
    // server and CLI test merely to resolve a presentation component's routes.
    const unitEntries = importedPaths.some(file => !file.endsWith('.svelte')) ? inventory : [];
    const entries = routeEntriesOnly ? [...browserInventory]
      : [...unitEntries, ...browserInventory, ...(frontendPaths.length ? ['frontend/src/routes'] : [])];
    stage = 'resolving the source import graph';
    const { output } = await cruise(entries, {
      ...config.options, baseDir: REPOSITORY_ROOT, outputType: 'json', tsPreCompilationDeps: 'specify', validate: false,
      tsConfig: { fileName: path.join(REPOSITORY_ROOT, 'tsconfig.dependency-cruiser.json') },
      // Framework entry pages have no reverse application import tree. Their
      // browser consumers are destinations, including imported test helpers.
      ...(routeEntriesOnly ? { doNotFollow: { path: '^(?!e2e/)' } } : {}),
    });
    stage = 'mapping source dependents';
    const graph = typeof output === 'string' ? JSON.parse(output) as ICruiseResult : output;
    const index = indexRuntimeConsumers(graph, MAX_VERIFICATION_INVENTORY_FILES);
    const units = index.select(importedPaths.filter(file => !file.endsWith('.svelte')), inventory);
    selection = new Map([
      ...units.consumers,
      ...(unitEntries.length ? index.select(components, inventory, false).consumers : []),
    ]);
    const routes = graph.modules.map(module => module.source).filter(file => file.startsWith('frontend/src/routes/')
      || file.startsWith('frontend/src/') && RULES.some(rule => rule.impactOnly && rule.matches(file)));
    routeConsumers = index.select(frontendPaths, routes, false).consumers;
    componentContracts = leafComponentContracts(components, graph, browserInventory);
    // Known owners retain their conservative browser coverage. Positive import
    // evidence additionally follows shared support into its browser consumers;
    // a complete graph with no browser consumer does not turn CLI-only helpers
    // into application changes. Unknown edges retain all reachable consumers.
    browserSelection = index.select(importedPaths, browserInventory, false).consumers;
    if (frontendPaths.length) {
      stage = 'reading browser route references';
      // A browser journey can visit a page without importing it or sharing its
      // filename. Include those consumers before iteration reaches a full run.
      // Test helpers inherit their route references through the same graph.
      const sources = graph.modules.map(module => module.source)
        .filter(file => file.startsWith('e2e/') && /\.[cm]?[jt]s$/u.test(file));
      const consumers = index.select(sources, browserInventory, false).consumers;
      const references = new Map<string, readonly string[]>();
      for (const file of sources) {
        const destinations = browserRouteReferences(readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8'));
        for (const consumer of consumers.get(file) ?? []) {
          references.set(consumer, uniqueSorted([...(references.get(consumer) ?? []), ...destinations]));
        }
      }
      browserSelection = new Map(importedPaths.map(file => {
        const routeTests = componentContracts.has(file) ? [] : browserTestsForRoutes([file, ...(routeConsumers.get(file) ?? [])], references);
        return [file, uniqueSorted([
          ...(browserSelection.get(file) ?? []),
          ...routeTests,
          ...(routeEntriesOnly && !routeTests.length ? browserInventory : []),
        ])];
      }));
    }
    explanation = [
      units.fallbackPaths.length
        ? `Complete unit fallback: no resolved runtime test consumer for ${units.fallbackPaths.join(', ')}.`
        : 'Runtime dependents and browser route references are discovered from current sources, including transitive helpers and newly added tests; compiler checks protect type-only contracts.',
      describeRuntimeImportGaps(index.unresolved),
    ].filter(Boolean).join(' ');
  } catch (error) {
    selection = new Map(importedPaths.map((file) => [file, inventory]));
    browserSelection = new Map(importedPaths.map((file) => [file, browserInventory]));
    explanation = dependencyAnalysisFailure(stage, error);
  }
  const plan = buildVerificationOwnershipPlan(rawPaths, selection, browserSelection, routeConsumers, componentContracts);
  return Object.freeze({ ...plan, interpretation: Object.freeze([...plan.interpretation, explanation]) });
}

/** Include every tracked identity, even deleted files, plus unignored additions.
 * Ignored build output and private local files are never source inputs. */
export function readVerificationSourceInventory(repositoryRoot = REPOSITORY_ROOT): readonly string[] {
  const bytes = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--'], {
    cwd: repositoryRoot, timeout: 10_000,
    maxBuffer: MAX_VERIFICATION_INVENTORY_FILES * (MAX_VERIFICATION_CHANGED_PATH_LENGTH + 1),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text.endsWith('\0')) throw new TypeError('Verification source inventory is empty or incomplete.');
  const files = [...new Set(text.slice(0, -1).split('\0'))];
  if (files.length > MAX_VERIFICATION_INVENTORY_FILES) throw new TypeError('Verification source inventory exceeds its file bound.');
  return Object.freeze(files.map(normaliseChangedPath).sort());
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
  const inventory = readVerificationSourceInventory();
  const assignments = inventory.map((file) => ownershipRule(file));
  const fallbackPaths = inventory.filter((file, index) => assignments[index] === CONSERVATIVE_FALLBACK);
  for (const rule of RULES.filter((candidate) => candidate.impactOnly)) {
    if (!inventory.some((file) => rule.matches(file))) {
      throw new TypeError(`Verification impact rule ${rule.id} does not match the maintained inventory.`);
    }
  }
  const browserRequiredSupportPaths = inventory.filter((file) => (
    file.startsWith('e2e/')
    && !file.endsWith('.spec.ts')
    && matchingRules(file).some((rule) => rule.browserRequired)
  ));
  for (const supportPath of browserRequiredSupportPaths) {
    const assignment = buildVerificationOwnershipPlan([supportPath]).assignments[0];
    if (!assignment || assignment.focusedBrowserChecks.length !== FUNCTIONAL_BROWSER_INVENTORY.length
      || assignment.focusedBrowserChecks.some((file) => !isPlaywrightFunctionalSpec(file))) {
      throw new TypeError(`Browser-required support path ${supportPath} is not plannable against the functional inventory.`);
    }
  }
  const schemaOwners = SCHEMA_LIFECYCLE_REGISTRY.flatMap((family) => [
    family.owner,
    ...('metadata' in family ? family.metadata.hooks.map((hook) => hook.module) : []),
  ]);
  for (const owner of schemaOwners) {
    if (!inventory.includes(normaliseChangedPath(owner)) || ownershipRule(owner) === CONSERVATIVE_FALLBACK) {
      throw new TypeError(`Schema owner ${owner} must have a present, classified source path.`);
    }
  }
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
    assignedFiles: assignments.length - fallbackPaths.length,
    conservativeFallbackPaths: Object.freeze(fallbackPaths),
    ownershipAreas: new Set(assignments.map((item) => item.area)).size,
    impactAreas: new Set(inventory.flatMap((file) => matchingRules(file).map((rule) => rule.area))).size,
    schemaFamilies: SCHEMA_LIFECYCLE_REGISTRY.length,
    schemaOwnerPaths: new Set(schemaOwners).size,
    capabilities: CAPABILITY_MANIFEST.capabilities.length,
    cliOperations: CAPABILITY_MANIFEST.cliOperations.length,
    privacyProfiles: PRIVACY_DATA_FLOW_CATALOGUE.schemaPrivacyProfiles.length,
    privacyConsumerFlows: PRIVACY_DATA_FLOW_CATALOGUE.schemaConsumerFlows.length,
    blockingDependencyRules: dependencyRules.length,
    browserRequiredSupportPaths: browserRequiredSupportPaths.length,
  });
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    if (args.length === 1 && args[0] === '--check') {
      const result = checkVerificationOwnershipMap();
      process.stdout.write(`Verification ownership map v${result.mapVersion}: ${result.maintainedFiles} Git-visible files; ${result.assignedFiles} classified, ${result.conservativeFallbackPaths.length} explicitly covered by conservative fallback, across ${result.ownershipAreas} owner and ${result.impactAreas} impact areas.\n`);
      process.stdout.write(`Canonical closure: ${result.schemaFamilies} schema families, ${result.schemaOwnerPaths} owner paths, ${result.capabilities} capabilities, ${result.cliOperations} CLI operations, ${result.privacyProfiles} privacy profiles, ${result.privacyConsumerFlows} privacy consumer flows, ${result.blockingDependencyRules} blocking dependency rules.\n`);
      return 0;
    }
    const plan = await createVerificationOwnershipPlan(args);
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
  process.exitCode = await main();
}
