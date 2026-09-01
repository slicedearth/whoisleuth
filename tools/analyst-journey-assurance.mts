#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  SYNTHETIC_ANALYST_JOURNEYS,
  SYNTHETIC_ANALYST_JOURNEY_VERSION,
} from '../fixtures/synthetic-analyst-journeys.mts';
import {
  buildBalancedBrowserShardPlan,
  readVerificationTimingProfile,
} from './verification-timing-profile.mts';

export const ANALYST_JOURNEY_ASSURANCE_VERSION = 1;
export const MAX_ANALYST_JOURNEY_SPEC_BYTES = 2 * 1024 * 1024;
export const MAX_ANALYST_JOURNEY_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_ANALYST_JOURNEY_TESTS = 256;

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E2E_ROOT = path.join(REPOSITORY_ROOT, 'e2e');
const RESERVED_TARGET_SUFFIXES = ['.example', '.invalid', '.test'];
const FILE_SUFFIXES = new Set(['json', 'zip', 'png', 'svg', 'css', 'js', 'ts', 'mts', 'html', 'txt', 'csv']);
const CSS_ELEMENT_PREFIXES = new Set([
  'a', 'article', 'button', 'details', 'div', 'footer', 'form', 'g', 'header', 'input',
  'li', 'main', 'nav', 'ol', 'p', 'path', 'section', 'span', 'summary', 'table', 'td',
  'th', 'ul', 'foreignobject',
]);
const REQUIRED_BOUNDARY_SPECS = Object.freeze([
  'e2e/origin-guard.spec.ts',
  'e2e/privacy-data-flow-catalogue.spec.ts',
  'e2e/shortlist-storage.spec.ts',
  'e2e/watchlist-storage.spec.ts',
]);

type JourneyTest = Readonly<{
  file: string;
  title: string;
  tags: readonly string[];
  body: string;
  strings: readonly string[];
  sharedFixture: boolean;
  disabled: boolean;
}>;

function boundedSource(file: string): string {
  const filename = path.join(REPOSITORY_ROOT, file);
  const size = statSync(filename).size;
  if (size < 1 || size > MAX_ANALYST_JOURNEY_SPEC_BYTES) throw new TypeError(`Analyst journey source ${file} exceeds its byte bound.`);
  return readFileSync(filename, 'utf8');
}

function staticString(node: ts.Node | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

function tagsFromOptions(node: ts.Node | undefined): readonly string[] {
  if (!node || !ts.isObjectLiteralExpression(node)) return [];
  const property = node.properties.find((candidate): candidate is ts.PropertyAssignment => (
    ts.isPropertyAssignment(candidate)
    && ((ts.isIdentifier(candidate.name) && candidate.name.text === 'tag') || staticString(candidate.name) === 'tag')
  ));
  if (!property) return [];
  const values = ts.isArrayLiteralExpression(property.initializer) ? property.initializer.elements : [property.initializer];
  return Object.freeze(values.map((value) => staticString(value)).filter((value): value is string => value !== null));
}

function callbackStrings(node: ts.Node): readonly string[] {
  const values: string[] = [];
  const visit = (child: ts.Node): void => {
    const value = staticString(child);
    if (value !== null) values.push(value);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return Object.freeze(values);
}

function disabledByDeclarationOrScope(node: ts.CallExpression, callback: ts.Node): boolean {
  if (/\b(?:test|testInfo)\.(?:skip|fixme)\s*\(/u.test(callback.getText())) return true;
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)
      && ['skip', 'fixme', 'only'].includes(current.expression.name.text)
      && ts.isPropertyAccessExpression(current.expression.expression)
      && ts.isIdentifier(current.expression.expression.expression)
      && current.expression.expression.expression.text === 'test'
      && current.expression.expression.name.text === 'describe') return true;
    current = current.parent;
  }
  return false;
}

export function parseAnalystJourneySource(file: string, source: string): readonly JourneyTest[] {
  if (!/^e2e\/[a-zA-Z0-9._-]+\.spec\.ts$/u.test(file)
    || Buffer.byteLength(source, 'utf8') < 1
    || Buffer.byteLength(source, 'utf8') > MAX_ANALYST_JOURNEY_SPEC_BYTES) {
    throw new TypeError('Analyst journey source identity or byte count is invalid.');
  }
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (parsed as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length) throw new TypeError(`Analyst journey source ${file} must parse without errors.`);
  const sharedFixture = parsed.statements.some((statement) => ts.isImportDeclaration(statement)
    && staticString(statement.moduleSpecifier) === './fixtures'
    && statement.importClause?.namedBindings
    && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some((item) => item.name.text === 'test'));
  const tests: JourneyTest[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const identifierCall = ts.isIdentifier(node.expression) && node.expression.text === 'test';
      const memberCall = ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'test'
        && ['skip', 'fixme', 'only'].includes(node.expression.name.text);
      if (identifierCall || memberCall) {
        const title = staticString(node.arguments[0]);
        const options = node.arguments.length >= 3 ? node.arguments[1] : undefined;
        const callback = node.arguments.at(-1);
        const tags = tagsFromOptions(options);
        if (tags.includes('@analyst-journey')) {
          if (!title || !callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
            throw new TypeError(`Analyst journey in ${file} must be a statically named real Playwright test.`);
          }
          tests.push(Object.freeze({
            file,
            title,
            tags,
            body: callback.getText(parsed),
            strings: callbackStrings(callback),
            sharedFixture,
            disabled: memberCall || disabledByDeclarationOrScope(node, callback),
          }));
          if (tests.length > MAX_ANALYST_JOURNEY_TESTS) throw new TypeError('Analyst journey test inventory exceeds its bound.');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return Object.freeze(tests);
}

function assertReservedTargets(test: JourneyTest): void {
  for (const value of test.strings) {
    if (value.startsWith('whoisleuth.')) continue;
    if (!value.includes('://') && /^[.#[:]/u.test(value.trimStart())) continue;
    for (const match of value.toLowerCase().matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gu)) {
      const candidate = match[0];
      const suffix = candidate.split('.').at(-1) ?? '';
      if (FILE_SUFFIXES.has(suffix)) continue;
      if (CSS_ELEMENT_PREFIXES.has(candidate.split('.')[0] ?? '') && !value.includes('://')) continue;
      if (!RESERVED_TARGET_SUFFIXES.some((reserved) => candidate.endsWith(reserved))) {
        throw new TypeError(`Analyst journey ${test.file} contains a non-reserved target literal.`);
      }
    }
  }
}

function assignedShard(file: string, plan: ReturnType<typeof buildBalancedBrowserShardPlan>): number {
  const shards = plan.shards.filter((item) => item.files.includes(file));
  if (shards.length !== 1) throw new TypeError(`Analyst journey specification ${file} must be assigned to exactly one balanced shard.`);
  return shards[0]!.shard;
}

export function buildAnalystJourneyAssurance() {
  const specNames = readdirSync(E2E_ROOT).filter((name) => name.endsWith('.spec.ts')).sort();
  let totalBytes = 0;
  const tests = specNames.flatMap((name) => {
    const file = `e2e/${name}`;
    const source = boundedSource(file);
    totalBytes += Buffer.byteLength(source, 'utf8');
    if (totalBytes > MAX_ANALYST_JOURNEY_TOTAL_BYTES) throw new TypeError('Analyst journey sources exceed their aggregate byte bound.');
    return parseAnalystJourneySource(file, source);
  });
  if (!tests.length || tests.length > MAX_ANALYST_JOURNEY_TESTS || tests.some((item) => item.disabled || !item.sharedFixture)) {
    throw new TypeError('Analyst journeys must use enabled real tests and the automatic network/privacy fixture.');
  }
  const testKeys = tests.map((item) => `${item.file}\0${item.title}`);
  if (new Set(testKeys).size !== testKeys.length) throw new TypeError('Analyst journey Playwright test identities must be unique.');
  for (const test of tests) assertReservedTargets(test);

  const plan = buildBalancedBrowserShardPlan(readVerificationTimingProfile());
  for (const required of REQUIRED_BOUNDARY_SPECS) assignedShard(required, plan);
  const config = boundedSource('playwright.config.ts');
  const fixture = boundedSource('e2e/fixtures.ts');
  if (!/failOnFlakyTests:\s*true/u.test(config)
    || !/auto:\s*true/u.test(fixture)
    || !/context\.route\('\*\*\/\*'/u.test(fixture)
    || !/requests must stay within the local test server origin/u.test(fixture)) {
    throw new TypeError('Analyst journeys require fail-on-flaky configuration and the automatic same-origin request guard.');
  }

  const journeys = SYNTHETIC_ANALYST_JOURNEYS.map((journey) => {
    const tag = `@journey-${journey.id}`;
    const mapped = tests.filter((item) => item.tags.includes(tag));
    if (!mapped.length) throw new TypeError(`Declared analyst journey ${journey.id} has no real Playwright test.`);
    const bodies = mapped.map((item) => item.body).join('\n');
    if (!/setViewportSize\s*\(/u.test(bodies)) throw new TypeError(`Declared analyst journey ${journey.id} has no explicit mobile browser outcome.`);
    if (!/(?:getByRole|getByLabel|toBeFocused|aria-)/u.test(bodies)) throw new TypeError(`Declared analyst journey ${journey.id} has no explicit accessibility browser outcome.`);
    const shardAssignments = [...new Set(mapped.map((item) => assignedShard(item.file, plan)))].sort();
    return Object.freeze({
      id: journey.id,
      tests: mapped.length,
      specifications: Object.freeze([...new Set(mapped.map((item) => item.file))].sort()),
      shards: Object.freeze(shardAssignments),
      mobileOutcome: true,
      accessibilityOutcome: true,
    });
  });
  const declaredTags = new Set(SYNTHETIC_ANALYST_JOURNEYS.map((journey) => `@journey-${journey.id}`));
  const unknownTags = tests.flatMap((item) => item.tags.filter((tag) => tag.startsWith('@journey-') && !declaredTags.has(tag)));
  if (unknownTags.length) throw new TypeError('Analyst journey tests contain undeclared journey tags.');

  const jobs = Object.freeze({
    Investigate: Object.freeze(SYNTHETIC_ANALYST_JOURNEYS.filter((journey) => journey.taskIds.some((task) => task !== 'case-decision-packet' && task !== 'archive-export-verify')).map((journey) => journey.id)),
    Respond: Object.freeze(SYNTHETIC_ANALYST_JOURNEYS.filter((journey) => journey.taskIds.includes('case-decision-packet')).map((journey) => journey.id)),
    Assure: Object.freeze(SYNTHETIC_ANALYST_JOURNEYS.filter((journey) => journey.taskIds.includes('archive-export-verify')).map((journey) => journey.id)),
  });
  if (!jobs.Investigate.length || !jobs.Respond.length || !jobs.Assure.length) {
    throw new TypeError('Investigate, Respond, and Assure must each map to an explicit analyst journey.');
  }
  return Object.freeze({
    assuranceVersion: ANALYST_JOURNEY_ASSURANCE_VERSION,
    journeyContractVersion: SYNTHETIC_ANALYST_JOURNEY_VERSION,
    declaredJourneys: SYNTHETIC_ANALYST_JOURNEYS.length,
    mappedJourneys: journeys.length,
    playwrightTests: tests.length,
    journeyMappings: Object.freeze(journeys),
    jobs,
    balancedShardSpecifications: plan.shards.reduce((sum, shard) => sum + shard.files.length, 0),
    boundarySpecifications: REQUIRED_BOUNDARY_SPECS.length,
    skippedJourneys: 0,
    retryAcceptance: false,
    privacy: Object.freeze({
      sharedSameOriginGuard: true,
      reservedTargets: true,
      fixtureContractRetainsTargets: false,
      resultContractRetainsQueries: false,
      localStorageBoundarySpecifications: 3,
    }),
  });
}

export function main(args = process.argv.slice(2)): number {
  try {
    if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) throw new TypeError('Usage: node tools/analyst-journey-assurance.mts [--json]');
    const result = buildAnalystJourneyAssurance();
    if (args[0] === '--json') process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(
      `Analyst journey assurance v${result.assuranceVersion}: ${result.mappedJourneys}/${result.declaredJourneys} journeys, `
      + `${result.playwrightTests} real tests, ${result.balancedShardSpecifications} balanced-shard specs, `
      + `${result.skippedJourneys} skipped, retry acceptance ${result.retryAcceptance ? 'enabled' : 'disabled'}.\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Analyst journey assurance failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
