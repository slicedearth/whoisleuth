import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appendUnavailableCollectionStatus,
  buildMonitorNavigationUrl,
  createMonitorCollectionLoader,
  monitorRouteKey,
  monitorRouteTarget,
  monitorViewCollections,
  monitorViewFromUrl,
  monitorWorkflowForView,
} from '../frontend/src/lib/controllers/monitor-route-controller.ts';

describe('Monitor route controller', () => {
  it('normalizes views, workflow ownership and collection requirements', () => {
    assert.equal(monitorViewFromUrl(new URL('https://example.test/monitor')), 'inbox');
    assert.equal(
      monitorViewFromUrl(new URL('https://example.test/monitor?view=rules')),
      'rules',
    );
    assert.equal(
      monitorViewFromUrl(new URL('https://example.test/monitor?view=rules&case=case-1')),
      'cases',
    );
    assert.equal(
      monitorWorkflowForView('campaigns').eyebrow,
      'Respond',
    );
    assert.equal(
      monitorWorkflowForView('certificates').eyebrow,
      'Assure',
    );
    assert.deepEqual(
      monitorViewCollections('timeline'),
      ['cases', 'watchlists', 'bulk-sessions', 'relationships', 'website-snapshots'],
    );
  });

  it('builds one canonical navigation URL and clears stale focus state', () => {
    const current = new URL(
      'https://example.test/monitor?view=cases&case=case-1&investigation=1&domain=old.example#case-response-case-1',
    );
    assert.equal(
      buildMonitorNavigationUrl(current, 'watchlists'),
      '/monitor?view=watchlists',
    );
    assert.equal(
      buildMonitorNavigationUrl(current, 'cases', {
        parameter: 'case',
        value: 'case-2',
      }),
      '/monitor?view=cases&investigation=1&domain=old.example&case=case-2',
    );
  });

  it('parses bounded case, watchlist and investigation targets', () => {
    const caseUrl = new URL(
      'https://example.test/monitor?case=case-1#case-response-case-1',
    );
    assert.deepEqual(monitorRouteTarget(caseUrl), {
      kind: 'case',
      id: 'case-1',
      responseHash: true,
    });
    assert.deepEqual(
      monitorRouteTarget(new URL('https://example.test/monitor?watchlist=Daily')),
      { kind: 'watchlist', name: 'Daily' },
    );
    assert.deepEqual(
      monitorRouteTarget(new URL(
        'https://example.test/monitor?investigation=1&domain=Portal.Example.Test#case-review-queue',
      )),
      {
        kind: 'investigation',
        domain: 'Portal.Example.Test',
        restoreQueue: true,
      },
    );
    assert.equal(monitorRouteKey(caseUrl), '/monitor?case=case-1#case-response-case-1');
  });

  it('deduplicates collection loads and unavailable labels', async () => {
    const controller = createMonitorCollectionLoader();
    let calls = 0;
    const first = controller.load('cases', async () => {
      calls += 1;
    });
    const second = controller.load('cases', async () => {
      calls += 1;
    });
    assert.equal(first, second);
    await Promise.all([first, second]);
    assert.equal(calls, 1);

    const firstStatus = appendUnavailableCollectionStatus('', 'cases');
    assert.equal(
      appendUnavailableCollectionStatus(firstStatus, 'cases'),
      firstStatus,
    );
    assert.match(
      appendUnavailableCollectionStatus(firstStatus, 'watchlists'),
      /cases, watchlists/u,
    );
  });
});
