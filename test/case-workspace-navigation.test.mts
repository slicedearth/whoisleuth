import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { caseWorkspaceHref, caseWorkspaceSection } from '../frontend/src/lib/analysis/case-response-stage.ts';

describe('Case workspace navigation', () => {
  it('opens a summary by default and recognises each distinct working section', () => {
    for (const section of ['summary', 'evidence', 'assessment', 'response', 'history']) {
      assert.equal(caseWorkspaceSection(new URL(`https://example.test/cases?case=record&section=${section}`)), section);
    }
    assert.equal(caseWorkspaceSection(new URL('https://example.test/cases?case=record')), 'summary');
    assert.equal(caseWorkspaceSection(new URL('https://example.test/cases?case=record&section=unknown')), 'summary');
  });
  it('preserves old response and observation deep links without reclassifying evidence', () => {
    for (const suffix of ['&response=1', '#case-response-record', '#case-response-preflight-record']) {
      assert.equal(caseWorkspaceSection(new URL(`https://example.test/cases?case=record${suffix}`)), 'response');
    }
    assert.equal(caseWorkspaceSection(new URL('https://example.test/cases?case=record#case-response-observation-record')), 'evidence');
    assert.equal(caseWorkspaceSection(new URL('https://example.test/cases?case=record#case-response-assessment-record')), 'assessment');
  });
  it('uses stable paths and encodes an identifier without creating another query parameter', () => {
    assert.equal(caseWorkspaceHref('case-1'), '/cases?case=case-1');
    assert.equal(caseWorkspaceHref('case-1', 'history'), '/cases?case=case-1&section=history');
    const url = new URL(caseWorkspaceHref('id&section=response', 'evidence'), 'https://example.test');
    assert.equal(url.searchParams.get('case'), 'id&section=response');
    assert.equal(url.searchParams.get('section'), 'evidence');
  });
});
