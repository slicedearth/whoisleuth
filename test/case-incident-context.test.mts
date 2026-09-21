import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as context from '../packages/cases/case-incident-context.mts';
import * as operations from '../packages/cases/case-record-operations.mts';

describe('Case incident context owner', () => {
  test('preserves the established operation exports without duplicate implementations', () => {
    for (const name of Object.keys(context) as (keyof typeof context)[]) {
      assert.strictEqual(operations[name], context[name], name);
    }
  });

  test('keeps an origin-only assertion free of private path, query and fragment values', () => {
    const assertion = context.caseInvestigationContextAssertion({
      objective: 'Review the reported page',
      incidentUrl: 'https://login.example.test/private-path?token=private-token#private-fragment',
      retainExactUrl: false,
    });
    assert.equal(assertion.retainedUrl, 'https://login.example.test');
    assert.equal(assertion.retention, 'origin_only');
    assert.doesNotMatch(JSON.stringify(assertion), /private-(?:path|token|fragment)/u);
  });

  test('retains the exact incident URL only after explicit selection', () => {
    const url = 'https://login.example.test/reported?reference=example#section';
    const assertion = context.caseInvestigationContextAssertion({
      objective: 'Review the reported page', incidentUrl: url, retainExactUrl: true,
    });
    assert.equal(assertion.retainedUrl, url);
    assert.equal(assertion.retention, 'exact');
    assert.equal(context.parseIncidentUrlContext(url)?.registrableDomain, 'example.test');
  });

  test('rejects credential-bearing, unsupported and missing incident inputs', () => {
    for (const incidentUrl of ['https://user:secret@example.test/', 'file:///example', '', undefined]) {
      assert.equal(context.parseIncidentUrlContext(incidentUrl), null);
      assert.throws(() => context.caseInvestigationContextAssertion({
        objective: 'Review evidence', incidentUrl, retainExactUrl: false,
      }), /absolute HTTP\(S\)/u);
    }
    assert.throws(() => context.caseInvestigationContextAssertion({
      objective: '  ', incidentUrl: 'https://example.test/', retainExactUrl: false,
    }), /investigation objective/u);
  });
});
