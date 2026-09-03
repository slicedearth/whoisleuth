import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import * as sharedCase from '../packages/cases/case-model.mts';
import * as sharedReport from '../packages/cases/case-report.mts';
import * as sharedResponse from '../packages/cases/case-response-model.mts';
import * as sharedPacket from '../packages/cases/case-response-packet.mts';
import * as browserCase from '../frontend/src/lib/analysis/case-model.ts';
import * as browserReport from '../frontend/src/lib/analysis/case-report.ts';
import * as browserResponse from '../frontend/src/lib/analysis/case-response-model.ts';
import * as browserPacket from '../frontend/src/lib/analysis/case-response-packet.ts';

const FIXTURE_ROOT = new URL('./fixtures/case-lifecycle/', import.meta.url);

async function fixture<T = unknown>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(`${name}.json`, FIXTURE_ROOT), 'utf8')) as T;
}

function assertExactFacade(
  facade: Record<string, unknown>,
  owner: Record<string, unknown>,
): void {
  assert.deepEqual(Object.keys(facade).sort(), Object.keys(owner).sort());
  for (const name of Object.keys(owner)) {
    assert.equal(facade[name], owner[name], name);
  }
}

describe('shared Case domain facades', () => {
  test('re-export every canonical value and function with exact runtime identity', () => {
    assertExactFacade(browserCase, sharedCase);
    assertExactFacade(browserReport, sharedReport);
    assertExactFacade(browserResponse, sharedResponse);
    assertExactFacade(browserPacket, sharedPacket);
  });

  test('preserve exact-current Node and browser-facade normalisation, ordering, and refusal semantics', async () => {
    const current = await fixture('browser-case-v14');
    assert.deepEqual(browserCase.normalizeCaseStore(current), sharedCase.normalizeCaseStore(current));

    const portable = await fixture('case-export-v14');
    assert.deepEqual(browserCase.mergeCases([], portable), sharedCase.mergeCases([], portable));
    assert.equal(sharedResponse.isLegalCaseActionTransition('drafting', 'ready_for_review', 'analyst'), true);
    assert.equal(sharedResponse.isLegalCaseActionTransition('acknowledged', 'submitted', 'analyst'), false);

    for (const owner of [browserCase, sharedCase]) {
      assert.throws(() => owner.normalizeCaseStore({ version: 11, cases: [] }), /schema 11 is not part of the supported compatibility boundary/iu);
      assert.throws(() => owner.normalizeCaseStore({ version: 15, cases: [] }), /newer than the supported schema 14/iu);
    }
    assert.equal(sharedCase.parseStoreVersion({ version: 15 }), 15);
    assert.throws(
      () => sharedCase.mergeCases([], { version: 15, cases: [] }),
      /newer than the supported schema 14/iu,
    );
  });

  test('preserve response omissions, packet digests, and report projections across facades', async () => {
    const seed = sharedResponse.appendCaseAction(
      [],
      { recipient: 'Reserved fixture review desk' },
      '2026-08-22T00:00:00.000Z',
    )[0];
    assert.ok(seed);
    const oversized = sharedResponse.normalizeCaseActions(Array.from(
      { length: sharedResponse.MAX_CASE_ACTIONS + 3 },
      (_, index) => ({ ...seed,
        id: `action-${index}`,
      }),
    ), '2026-08-22T00:00:00.000Z', { sourceVersion: 14 });
    assert.equal(oversized.length, sharedResponse.MAX_CASE_ACTIONS);

    const packet = await fixture<Record<string, unknown>>('case-response-packet-v8');
    assert.equal(await sharedPacket.verifyCaseResponsePacketIntegrity(packet as never), true);
    assert.equal(await browserPacket.verifyCaseResponsePacketIntegrity(packet as never), true);

    const currentStore = await fixture('browser-case-v14');
    const currentCase = sharedCase.normalizeCaseStore(currentStore).cases[0];
    assert.ok(currentCase);
    assert.deepEqual(
      browserReport.buildCaseReport(currentCase, { generatedAt: '2026-08-22T00:00:00.000Z' }),
      sharedReport.buildCaseReport(currentCase, { generatedAt: '2026-08-22T00:00:00.000Z' }),
    );
  });
});
