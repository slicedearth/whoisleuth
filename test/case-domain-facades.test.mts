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

  test('preserve Node and browser-facade normalisation, ordering, migration, and refusal semantics', async () => {
    const historical = await fixture('browser-case-v12');
    assert.deepEqual(browserCase.normalizeCaseStore(historical), sharedCase.normalizeCaseStore(historical));

    const portable = await fixture('case-export-v12');
    assert.deepEqual(browserCase.mergeCases([], portable), sharedCase.mergeCases([], portable));
    assert.equal(sharedResponse.isLegalCaseActionTransition('drafting', 'ready_for_review', 'analyst'), true);
    assert.equal(sharedResponse.isLegalCaseActionTransition('acknowledged', 'submitted', 'analyst'), false);

    assert.deepEqual(
      browserCase.normalizeCaseStore({ version: 15, cases: [] }),
      sharedCase.normalizeCaseStore({ version: 15, cases: [] }),
    );
    assert.equal(sharedCase.parseStoreVersion({ version: 15 }), 15);
    assert.throws(
      () => sharedCase.mergeCases([], { version: 15, cases: [] }),
      /newer version/iu,
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
    ), '2026-08-22T00:00:00.000Z', { sourceVersion: 13 });
    assert.equal(oversized.length, sharedResponse.MAX_CASE_ACTIONS);

    const packet = await fixture<Record<string, unknown>>('case-response-packet-v7');
    assert.equal(await sharedPacket.verifyCaseResponsePacketIntegrity(packet as never), true);
    assert.equal(await browserPacket.verifyCaseResponsePacketIntegrity(packet as never), true);

    const archive = await fixture<{ sections: { cases: unknown } }>('workspace-archive-v5-current');
    const currentCase = sharedCase.normalizeCaseStore(archive.sections.cases).cases[0];
    assert.ok(currentCase);
    assert.deepEqual(
      browserReport.buildCaseReport(currentCase, { generatedAt: '2026-08-22T00:00:00.000Z' }),
      sharedReport.buildCaseReport(currentCase, { generatedAt: '2026-08-22T00:00:00.000Z' }),
    );
  });
});
