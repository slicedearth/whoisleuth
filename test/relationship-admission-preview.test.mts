import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_RELATIONSHIP_ADMISSION_DOMAINS,
  MAX_RELATIONSHIP_ADMISSION_SOURCES,
  buildRelationshipAdmissionPreview,
} from '../packages/relationships/relationship-admission-preview.mts';

describe('relationship admission preview', () => {
  test('discloses exact retained scope, persistence, and a zero-request boundary', () => {
    const preview = buildRelationshipAdmissionPreview({
      type: 'certificate',
      label: 'Shared TLS certificate',
      method: 'Exact leaf-certificate SHA-256',
      value: 'a'.repeat(64),
      domains: ['second.example', 'first.example'],
      description: 'Compare source-qualified retained certificate observations.',
    }, {
      action: 'retain',
      observedAt: '2026-08-23T01:00:00+00:00',
      firstRetainedObservation: '2026-08-22T01:00:00Z',
      lastRetainedObservation: '2026-08-23T01:00:00Z',
      sourceIdentities: ['TLS fixture', 'Case import'],
    });
    assert.equal(preview.connectedCount, 2);
    assert.equal(preview.completeness, 'complete');
    assert.equal(preview.persistence, 'browser_local_relationship_observation');
    assert.equal(preview.networkRequests, 0);
    assert.deepEqual(preview.externalRecipients, []);
    assert.match(preview.observedBasis, /Exact leaf-certificate SHA-256.*a{64}/u);
    assert.match(preview.sharedInfrastructureWarning, /shared hosting|managed platforms/iu);
    assert.match(preview.limitations.join(' '), /does not establish shared ownership/iu);
  });

  test('bounds hostile breadth and keeps unavailable observation time partial', () => {
    const domains = Array.from({ length: MAX_RELATIONSHIP_ADMISSION_DOMAINS + 20 }, (_, index) => `domain-${index}.example`);
    const sources = Array.from({ length: MAX_RELATIONSHIP_ADMISSION_SOURCES + 20 }, (_, index) => `source-${index}`);
    const preview = buildRelationshipAdmissionPreview({ type: 'ip_address', domains }, {
      action: 'expand',
      observedAt: 'not-a-time',
      sourceIdentities: sources,
    });
    assert.equal(preview.connectedCount, MAX_RELATIONSHIP_ADMISSION_DOMAINS);
    assert.equal(preview.sourceIdentities.length, MAX_RELATIONSHIP_ADMISSION_SOURCES);
    assert.equal(preview.truncated, true);
    assert.equal(preview.completeness, 'partial');
    assert.equal(preview.persistence, 'none');
    assert.match(preview.limitations.at(-1) ?? '', /time is unavailable/iu);
  });
});
