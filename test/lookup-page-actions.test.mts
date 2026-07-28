import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildLookupRequestUrl,
  buildLookupSectionLinks,
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
        { href: '#web-evidence', label: 'Web & DNS' },
        { href: '#registry', label: 'Registry' },
        { href: '#case-response', label: 'Case & response' },
        { href: '#raw-data', label: 'Raw data' },
      ],
    );
  });
});
