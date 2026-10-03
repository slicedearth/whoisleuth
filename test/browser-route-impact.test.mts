import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { browserRouteReferences, browserRouteMatches, browserTestsForRoutes } from '../tools/browser-route-impact.mts';
import { indexRuntimeConsumers } from '../tools/runtime-test-consumers.mts';

test('finds browser destinations without treating comments, remote URLs or imports as routes', () => {
  const source = [
    "// page.goto('/not-executed');",
    "import { helper } from './helper';",
    "page.goto('/resources#topics');",
    "const routes = ['/cli', '/lookup?q=example.test', '/', '//external.example/path'];",
    'page.goto(`/cases?case=${id}`);',
    'page.goto(`/resources/${slug}`);',
    'page.goto(`/uncertain${suffix}`);',
    "page.goto('https://external.example/remote');",
  ].join('\n');
  assert.deepEqual(browserRouteReferences(source), ['/', '/cases', '/cli', '/lookup', '/resources']);
});

test('matches grouped, nested, parameterised and layout consumers without prefix collisions', () => {
  const root = 'frontend/src/routes/';
  assert.equal(browserRouteMatches(`${root}(public)/resources/+page.svelte`, '/resources'), true);
  assert.equal(browserRouteMatches(`${root}(public)/resources/+page.svelte`, '/resources-other'), false);
  assert.equal(browserRouteMatches(`${root}(public)/resources/+page.svelte`, '/resources/article'), false);
  assert.equal(browserRouteMatches(`${root}(public)/resources/[slug]/+page.ts`, '/resources/article'), true);
  assert.equal(browserRouteMatches(`${root}(public)/resources/[[slug]]/+page.svelte`, '/resources'), true);
  assert.equal(browserRouteMatches(`${root}(public)/resources/[...rest]/+page.svelte`, '/resources/a/b'), true);
  assert.equal(browserRouteMatches(`${root}(public)/resources/+layout.svelte`, '/resources/a'), true);
  assert.equal(browserRouteMatches(`${root}(public)/+page.svelte`, '/lookup'), false);
  assert.equal(browserRouteMatches(`${root}+layout.svelte`, '/lookup'), true);
  assert.equal(browserRouteMatches('frontend/src/lib/labels.ts', '/'), false);
});

test('discovers differently named journeys visiting a changed page without another registry', () => {
  const references = new Map([
    ['e2e/new-session.spec.ts', browserRouteReferences("page.goto('/resources');")],
    ['e2e/unrelated.spec.ts', browserRouteReferences("page.goto('/monitor');")],
  ]);
  assert.deepEqual(browserTestsForRoutes(['frontend/src/routes/(public)/resources/+page.svelte'], references), ['e2e/new-session.spec.ts']);
});

test('shared runtime consumers join route destinations without selecting a CLI-only sibling', () => {
  const shared = 'packages/example/rule.mts';
  const adapter = 'frontend/src/lib/example.ts';
  const route = 'frontend/src/routes/(console)/lookup/+page.svelte';
  const cli = 'cli/example.mts';
  const graph = { modules: [
    { source: shared, dependencies: [] },
    { source: adapter, dependencies: [{ module: '../../../packages/example/rule.mts', resolved: shared }] },
    { source: route, dependencies: [{ module: adapter, resolved: adapter }] },
    { source: cli, dependencies: [{ module: shared, resolved: shared }] },
  ] } as Parameters<typeof indexRuntimeConsumers>[0];
  const references = new Map([
    ['e2e/analyst-session.spec.ts', ['/lookup']],
    ['e2e/unrelated.spec.ts', ['/monitor']],
  ]);
  const consumers = indexRuntimeConsumers(graph, 10).select([shared, cli], [route], false).consumers;
  assert.deepEqual(browserTestsForRoutes(consumers.get(shared)!, references), ['e2e/analyst-session.spec.ts']);
  assert.deepEqual(browserTestsForRoutes(consumers.get(cli)!, references), []);
  graph.modules[1]!.dependencies[0]!.couldNotResolve = true;
  const uncertain = indexRuntimeConsumers(graph, 10).select([shared], [route], false);
  assert.deepEqual(browserTestsForRoutes(uncertain.consumers.get(shared)!, references), ['e2e/analyst-session.spec.ts']);
});

test('the Resources page reaches authentication and practice consumers independently of their names', () => {
  const references = new Map(['auth', 'demo', 'documentation-search'].map(name => {
    const file = `e2e/${name}.spec.ts`;
    return [file, browserRouteReferences(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))];
  }));
  const selected = browserTestsForRoutes(['frontend/src/routes/(public)/resources/+page.svelte'], references);
  assert.ok(selected.includes('e2e/auth.spec.ts'));
  assert.ok(selected.includes('e2e/demo.spec.ts'));
  assert.ok(selected.includes('e2e/documentation-search.spec.ts'));
});
