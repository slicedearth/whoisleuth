import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildLookupRequestUrl,
  buildLookupResultSectionLinks,
  buildLookupSectionLinks,
  lookupEvidenceFamilyForHref,
} from '../frontend/src/lib/analysis/lookup-page-actions.ts';

describe('lookup page actions', () => {
  test('keeps fast lookup requests free of deep enrichment flags', () => {
    const url = buildLookupRequestUrl('target.example', {
      mode: 'fast',
      includeExternalIntelligence: true,
      externalIntelligenceSupported: true,
      includeMalwareHostIntelligence: true,
      malwareHostIntelligenceSupported: true,
      includeMalwareIocIntelligence: true,
      malwareIocIntelligenceSupported: true,
      includeSecurityTxt: true,
      securityTxtSupported: true,
      securityTxtEligible: true,
    });

    assert.equal(url, '/api/lookup?q=target.example&fast=1');
  });

  test('enables only selected, supported and eligible deep enrichments', () => {
    const url = buildLookupRequestUrl('target.example', {
      mode: 'deep',
      includeExternalIntelligence: true,
      externalIntelligenceSupported: true,
      includeMalwareHostIntelligence: true,
      malwareHostIntelligenceSupported: false,
      includeMalwareIocIntelligence: false,
      malwareIocIntelligenceSupported: true,
      includeSecurityTxt: true,
      securityTxtSupported: true,
      securityTxtEligible: true,
    });

    assert.equal(
      url,
      '/api/lookup?q=target.example&intelligence=1&security_txt=1',
    );
  });

  test('builds concise section navigation from available evidence', () => {
    assert.deepEqual(
      buildLookupSectionLinks({
        hasWebEvidence: true,
        domainResult: true,
        hasExternalIntelligence: false,
        hasCaseSection: true,
      }),
      [
        { href: '#overview', label: 'Overview' },
        { href: '#registry', label: 'Registration' },
        { href: '#web-evidence', label: 'Web & DNS' },
        { href: '#relationships-history', label: 'Relationships & history' },
        { href: '#source-quality', label: 'Source quality' },
        { href: '#case-response', label: 'Case & response' },
        { href: '#advanced-evidence', label: 'Advanced' },
      ],
    );
  });

  test('exposes task-prioritized section navigation through one route facade', () => {
    assert.deepEqual(
      buildLookupResultSectionLinks({
        hasWebEvidence: true,
        domainResult: true,
        hasExternalIntelligence: true,
        hasCaseSection: true,
        task: 'incident',
      }).map((link) => link.href),
      [
        '#overview',
        '#web-evidence',
        '#relationships-history',
        '#advanced-evidence',
        '#registry',
        '#source-quality',
        '#case-response',
      ],
    );
  });

  test('maps bounded source-map anchors to the evidence family that renders them', () => {
    assert.equal(lookupEvidenceFamilyForHref('#evidence-registry'), 'registry');
    assert.equal(lookupEvidenceFamilyForHref('#evidence-network'), 'registry');
    for (const href of [
      '#evidence-dns',
      '#evidence-reverse-dns',
      '#evidence-http',
      '#evidence-tls',
      '#evidence-page',
      '#evidence-structured-identity',
      '#evidence-security-txt',
      '#evidence-technology',
      '#evidence-posture',
    ]) {
      assert.equal(lookupEvidenceFamilyForHref(href), 'web-evidence');
    }
    assert.equal(lookupEvidenceFamilyForHref('#advanced-evidence'), null);
    assert.equal(lookupEvidenceFamilyForHref('https://outside.invalid/'), null);
  });
});
