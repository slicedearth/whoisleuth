import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BrandProfileEditorController,
  type BrandEditorSubmission,
} from '../frontend/src/lib/controllers/brand-profile-editor.ts';
import { normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';
import type { PageBaseline } from '../packages/workspace/page-baseline.mts';
import { requiredValue } from './value-assertions.mts';

const profile = () =>
  requiredValue(
    normalizeBrandProfile({
      id: 'profile-1',
      name: 'Example profile',
      officialDomains: ['example.test'],
      productNames: ['Example product'],
      tlds: ['test'],
      approvedPartnerDomains: [],
      dkimSelectors: ['current'],
      retiredDkimSelectors: ['previous'],
      mailProtectionProfile: 'standard',
      trademarkOwner: 'Example owner',
      trademarkRegistration: 'Example registration',
      officialChannels: [],
      rightsReferences: [],
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z',
    }),
  );

function harness() {
  let message = '';
  let publications = 0;
  let id = 0;
  const editor = new BrandProfileEditorController({
    publish: () => {
      publications++;
    },
    message: (value) => {
      message = value;
    },
    clearMessage: (expected) => {
      if (message === expected) message = '';
    },
    createId: () => `draft-${++id}`,
  });
  return {
    editor,
    get message() {
      return message;
    },
    get publications() {
      return publications;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

// The collection adapter admits this current, bounded shape before the editor receives it.
function baseline(domain = 'example.test'): PageBaseline {
  return {
    baselineVersion: 1,
    domain,
    lookupDomain: domain,
    observedAt: '2026-09-20T00:00:00.000Z',
    pageIdentityVersion: 3,
    fingerprintVersion: 1,
    pageTitle: 'Example',
    canonicalHost: domain,
    faviconHash: 'a'.repeat(64),
    faviconPHash: '0123456789abcdef',
    normalizedHtml: { algorithm: 'sha256', value: 'b'.repeat(64), tokenCount: 1, truncated: false },
    visibleText: null,
    domStructure: {
      algorithm: 'sha256',
      value: 'c'.repeat(64),
      nodeCount: 1,
      parser: 'static-tag-sequence-v1',
      truncated: false,
    },
    formStructure: null,
    resourceHosts: { algorithm: 'set-sha256', value: 'd'.repeat(64), values: [], truncated: false },
    trackingIdentifiers: {
      algorithm: 'set-sha256',
      value: 'e'.repeat(64),
      values: [],
      truncated: false,
    },
    complete: true,
    truncated: false,
  };
}

test('Brand editor starts, loads and resets a detached draft through one values owner', () => {
  const { editor } = harness();
  assert.equal(editor.state.visible, false);
  editor.create('new.example.test');
  assert.equal(editor.state.identity, 'draft-1');
  assert.equal(editor.state.values.official, 'new.example.test');
  assert.equal(editor.state.values.tlds, 'com, net, org');
  const original = profile();
  editor.edit(original);
  original.name = 'Changed outside';
  assert.equal(editor.state.values.name, 'Example profile');
  assert.equal(editor.state.expected?.name, 'Example profile');
  assert.equal(editor.state.values.retiredSelectors, 'previous');
  editor.create();
  assert.equal(editor.state.identity, 'draft-2');
  assert.equal(editor.state.editingId, '');
  assert.equal(editor.state.expected, null);
  assert.equal(editor.state.values.name, '');
  assert.deepEqual(editor.state.officialChannels, []);
});

test('Brand submission preserves field semantics and writes only through the supplied coordinator', async () => {
  const { editor } = harness();
  editor.edit(profile());
  editor.setValue('official', 'EXAMPLE.TEST\nsecond.example.test');
  editor.setValue('products', 'Example Product, Another Product');
  editor.setValue('selectors', 'CURRENT, EXTRA');
  let submitted: BrandEditorSubmission | undefined;
  await editor.save(async (value) => {
    submitted = value;
    return { profile: profile(), issue: null };
  });
  const value = requiredValue(submitted);
  assert.equal(value.editingId, 'profile-1');
  assert.equal(value.expected?.name, 'Example profile');
  assert.deepEqual(value.profile.officialDomains, ['example.test', 'second.example.test']);
  assert.deepEqual(value.profile.productNames, ['Example Product', 'Another Product']);
  assert.deepEqual(value.profile.dkimSelectors, ['current', 'extra']);
  assert.deepEqual(value.profile.retiredDkimSelectors, ['previous']);
  assert.equal(value.profile.trademarkOwner, 'Example owner');
  assert.equal(editor.state.visible, false);
  assert.equal(editor.state.saving, false);
});

test('failed writes preserve the draft and expected record for a deliberate retry', async () => {
  const { editor } = harness();
  editor.edit(profile());
  editor.setValue('name', 'Unsaved draft');
  await assert.rejects(
    editor.save(async () => {
      throw new Error('Write refused');
    }),
    /Write refused/,
  );
  assert.equal(editor.state.visible, true);
  assert.equal(editor.state.saving, false);
  assert.equal(editor.state.values.name, 'Unsaved draft');
  assert.equal(editor.state.expected?.name, 'Example profile');
  await editor.save(async () => ({
    profile: { ...profile(), name: 'Unsaved draft' },
    issue: null,
  }));
  assert.equal(editor.state.visible, false);
});

test('a committed save with failed reconciliation remains open and advances its expected snapshot', async () => {
  for (const issue of ['active-preference', 'reread'] as const) {
    const { editor } = harness();
    editor.edit(profile());
    editor.setValue('name', 'Committed change');
    const result = await editor.save(async () => ({
      profile: { ...profile(), name: 'Committed change' },
      issue,
    }));
    assert.equal(result?.issue, issue);
    assert.equal(editor.state.visible, true);
    assert.equal(editor.state.expected?.name, 'Committed change');
  }
});

test('later typing survives a save and simultaneous submissions cannot duplicate the write', async () => {
  const { editor } = harness();
  editor.edit(profile());
  const held = deferred<{ profile: ReturnType<typeof profile>; issue: null }>();
  const saving = editor.save(() => held.promise);
  assert.equal(editor.state.saving, true);
  editor.close();
  assert.equal(editor.state.visible, true);
  assert.equal(
    await editor.save(async () => {
      throw new Error('Must not write');
    }),
    null,
  );
  editor.setValue('name', 'Later edit');
  held.resolve({ profile: profile(), issue: null });
  await saving;
  assert.equal(editor.state.visible, true);
  assert.equal(editor.state.values.name, 'Later edit');
  assert.equal(editor.state.expected?.name, 'Example profile');
});

test('another record draft is not replaced by a completed save; deletion respects later edits', async () => {
  const { editor } = harness();
  editor.edit(profile());
  const held = deferred<{ profile: ReturnType<typeof profile>; issue: null }>();
  const saving = editor.save(() => held.promise);
  editor.create('other.test');
  held.resolve({ profile: profile(), issue: null });
  await saving;
  assert.equal(editor.state.editingId, '');
  assert.equal(editor.state.values.official, 'other.test');
  editor.edit(profile());
  const unchanged = editor.unchanged();
  editor.setValue('name', 'Keep me');
  editor.removed('profile-1', unchanged);
  assert.equal(editor.state.visible, true);
  editor.saveAsNew();
  assert.equal(editor.state.editingId, '');
  assert.equal(editor.state.expected, null);
  assert.equal(editor.state.values.name, 'Keep me');
  editor.edit(profile());
  editor.removed('profile-1', editor.unchanged());
  assert.equal(editor.state.visible, false);
});

test('a capture stays in the form until save, and an inconclusive recapture preserves it', async () => {
  const h = harness();
  h.editor.create('example.test');
  await h.editor.capture(async (domain) => {
    assert.equal(domain, 'example.test');
    return baseline();
  });
  assert.equal(h.editor.state.baseline?.domain, 'example.test');
  assert.equal(h.editor.state.values.faviconHash, 'a'.repeat(64));
  assert.match(h.message, /Save the profile to retain it/);
  await h.editor.capture(async () => null);
  assert.equal(h.editor.state.baseline?.domain, 'example.test');
  assert.match(h.message, /existing baseline is unchanged/);
  h.editor.setValue('official', 'other.test');
  assert.equal(h.editor.state.baseline, null);
  assert.equal(h.editor.state.values.faviconHash, '');
  assert.equal(h.editor.state.faviconPHash, '');
});

test('changed domain, another draft, closure and disposal abort and reject late capture publication', async () => {
  for (const action of ['domain', 'draft', 'close', 'dispose'] as const) {
    const h = harness();
    h.editor.create('example.test');
    const held = deferred<PageBaseline>();
    let signal: AbortSignal | undefined;
    const capturing = h.editor.capture(async (_domain, currentSignal) => {
      signal = currentSignal;
      return held.promise;
    });
    if (action === 'domain') h.editor.setValue('official', 'other.test');
    else if (action === 'draft') h.editor.create('example.test');
    else h.editor[action]();
    assert.equal(signal?.aborted, true, action);
    const count = h.publications;
    held.resolve(baseline());
    await capturing;
    assert.equal(h.editor.state.baseline, null, action);
    assert.equal(h.editor.state.capturing, false, action);
    assert.equal(h.publications, count, action);
  }
});

test('capture errors are reported only for the current request and missing domains never collect', async () => {
  const h = harness();
  h.editor.create();
  await h.editor.capture(async () => {
    throw new Error('Must not collect');
  });
  assert.equal(h.message, 'Enter an official domain first.');
  h.editor.setValue('official', 'example.test');
  await h.editor.capture(async () => {
    throw new Error('Capture refused');
  });
  assert.equal(h.message, 'Capture refused');
  assert.equal(h.editor.state.capturing, false);
});
