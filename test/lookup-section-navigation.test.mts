import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LookupSectionNavigation } from '../frontend/src/lib/controllers/lookup-section-navigation.ts';

function harness() {
  let expanded: string[] = [],
    hash = '',
    attached = true;
  const events: unknown[] = [];
  const anchor = {
    begin: (href: string, fallback: string) => {
      events.push(['begin', href, fallback]);
      return true;
    },
    align: () => {
      events.push('align');
      return true;
    },
    contentReady: () => {
      events.push('ready');
    },
  };
  const navigation = new LookupSectionNavigation({
    expanded: () => expanded,
    publish: (sections) => {
      expanded = sections;
      events.push(['expanded', ...sections]);
    },
    sections: () => ['overview', 'registry', 'web-evidence'].map((id) => ({ href: `#${id}` })),
    preload: (section) => {
      events.push(['preload', section]);
    },
    anchor: () => (attached ? anchor : null),
    hash: () => hash,
    replaceHash: (href) => {
      hash = href;
      events.push(['hash', href]);
    },
    rendered: async () => {
      events.push('rendered');
    },
  });
  return {
    navigation,
    events,
    get expanded() {
      return expanded;
    },
    hash(value: string) {
      hash = value;
    },
    detach() {
      attached = false;
    },
  };
}

test('section and deep evidence links establish scroll ownership before opening and rendering', async () => {
  const h = harness();
  await h.navigation.navigate('#evidence-page-identity');
  assert.deepEqual(h.events, [
    ['hash', '#evidence-page'],
    ['begin', '#evidence-page', '#web-evidence'],
    ['preload', 'web-evidence'],
    ['expanded', 'web-evidence'],
    'rendered',
    'align',
  ]);
  await h.navigation.navigate('#registry');
  assert.deepEqual(h.expanded, ['web-evidence', 'registry']);
  await h.navigation.navigate('#registry');
  assert.deepEqual(h.expanded, ['web-evidence', 'registry']);
  assert.equal(h.navigation.allVisible(), true);
});

test('closing a section aligns its heading without preloading it or collapsing its siblings', async () => {
  const h = harness();
  await h.navigation.setAll(true);
  h.events.length = 0;
  await h.navigation.navigate('#registry', false);
  assert.deepEqual(h.events, [
    ['hash', '#registry'],
    ['begin', '#registry', '#registry'],
    ['expanded', 'web-evidence'],
    'rendered',
    'align',
  ]);
  assert.equal(h.navigation.visible('registry'), false);
  assert.equal(h.navigation.anyVisible(), true);
  assert.equal(h.navigation.allVisible(), false);
  await h.navigation.navigate('#overview');
  assert.deepEqual(h.expanded, ['web-evidence']);
});

test('expand/collapse all preserve an active evidence target and use only the current section inventory', async () => {
  const h = harness();
  h.hash('#evidence-dns');
  await h.navigation.setAll(true);
  assert.deepEqual(h.events, [
    ['begin', '#evidence-dns', '#web-evidence'],
    ['preload', 'registry'],
    ['preload', 'web-evidence'],
    ['expanded', 'registry', 'web-evidence'],
    'rendered',
    'align',
  ]);
  h.events.length = 0;
  await h.navigation.setAll(false);
  assert.deepEqual(h.events, [
    ['begin', '#evidence-dns', '#web-evidence'],
    ['expanded'],
    'rendered',
    'align',
  ]);
  assert.equal(h.navigation.anyVisible(), false);
});

test('unrelated links do nothing and detached routes do not perform late DOM alignment', async () => {
  const h = harness();
  await h.navigation.navigate('/cases');
  await h.navigation.navigate('#unknown');
  assert.equal(h.events.length, 0);
  const navigating = h.navigation.navigate('#web-evidence');
  h.detach();
  await navigating;
  assert.equal(h.events.includes('align'), false);
  h.events.length = 0;
  await h.navigation.contentReady();
  assert.deepEqual(h.events, ['rendered']);
  const active = harness();
  await active.navigation.contentReady();
  assert.deepEqual(active.events, ['rendered', 'ready']);
});
