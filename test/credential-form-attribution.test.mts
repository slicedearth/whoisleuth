import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeCredentialSurfaceProfile } from '../lib/credential-surface-profile.mts';
import { extractHtmlSignals } from '../lib/html-signals.mts';
import { externalPasswordFormObservation, validCredentialFormAttribution } from '../packages/evidence/credential-form-attribution.mts';
import { explainRiskScore, explainRiskScoreV8 } from '../packages/analysis/risk-scoring.mts';
import { analyzeStaticHtml } from '../lib/static-html-analysis.mts';
import { attributeCredentialForms } from '../lib/credential-form-attribution.mts';
import { credentialSurfaceContractState, sanitizeLookupChildProfiles } from '../lib/lookup-child-profile-contract.mts';

const baseUrl = 'https://portal.example/start';
const profile = (html: string, sourceTruncated = false) => analyzeCredentialSurfaceProfile({ html, baseUrl, sourceTruncated, observedAt: '2026-10-03T00:00:00.000Z' });
const external = (html: string, partial = false) => externalPasswordFormObservation(profile(html, partial).formAttribution);

test('unrelated external search form cannot supply a password form destination', async () => {
  const result = await extractHtmlSignals('<form action="/login"><input type=password></form><form action="https://search.example/"><input type=search></form>', 'portal.example', { baseUrl });
  assert.equal(result.hasPasswordField, true);
  assert.equal(result.hasExternalFormAction, true);
  assert.equal(result.hasExternalPasswordForm, false);
  const input = { availability: 'registered', ...result };
  assert.ok(explainRiskScoreV8(input)!.factors.some(factor => factor.delta === 10 && /Password form/.test(factor.label)));
  assert.equal(explainRiskScore(input)!.modelVersion, 9);
  assert.ok(explainRiskScore(input)!.factors.some(factor => factor.delta === 5 && /Login\/password/.test(factor.label)));
  assert.ok(!explainRiskScore(input)!.factors.some(factor => /external destination/.test(factor.label)));
});

test('attributes password fields to ancestor forms without retaining private controls or URL details', () => {
  const result = profile('<form id=private-form action="https://collector.example/private?token=secret#fragment"><input type=password name=private-field value=private-value></form>');
  assert.equal(externalPasswordFormObservation(result.formAttribution), true);
  assert.deepEqual(result.formAttribution.forms[0]?.destinations, [{ relationship: 'external', origin: 'https://collector.example' }]);
  assert.doesNotMatch(JSON.stringify(result), /private-form|private-field|private-value|token=secret|\/private|#fragment/u);
  assert.equal(validCredentialFormAttribution(result.formAttribution), true);
});

test('explicit form association overrides ancestry and works with forward declarations', () => {
  assert.equal(external('<form action="https://collector.example"><input type=password form=local></form><form id=local></form>'), false);
  assert.equal(external('<input type=password form=remote><form id=remote action="https://collector.example"></form>'), true);
  assert.equal(external('<form id=remote action="https://collector.example"><input type=password form=missing></form>'), null);
});

test('first ID in tree order controls explicit association, including a non-form duplicate', () => {
  assert.equal(external('<div id=remote></div><form id=remote action="https://collector.example"></form><input form=remote type=password>'), null);
  assert.equal(external('<form id=remote></form><form id=remote action="https://collector.example"></form><input form=remote type=password>'), false);
});

test('empty actions use the document URL while relative actions use the declared base', () => {
  assert.equal(external('<base href="https://collector.example/"><form><input type=password></form>'), false);
  assert.equal(external('<base href="https://collector.example/"><form action=""><input type=password></form>'), false);
  assert.equal(external('<base href="https://collector.example/"><form action=submit><input type=password></form>'), true);
});

test('only enabled submitters supply alternate declared destinations', () => {
  assert.equal(external('<form><input type=password><button formaction="https://collector.example">Continue</button></form>'), true);
  assert.equal(external('<form><input type=password><button type=button formaction="https://collector.example">Other</button></form>'), false);
  assert.equal(external('<form><input type=password><button disabled formaction="https://collector.example">Other</button></form>'), false);
  assert.equal(external('<form><input type=password><input type=submit formaction="https://collector.example"></form>'), true);
});

test('dialog forms do not imply a submission, but an explicit submitter method can override them', () => {
  assert.equal(external('<form method=dialog action="https://collector.example"><input type=password></form>'), false);
  assert.equal(external('<form method=dialog action="https://collector.example"><input type=password><button formmethod=post>Send</button></form>'), true);
});

test('disabled fieldsets exclude controls except controls in the first legend', () => {
  assert.equal(external('<form action="https://collector.example"><fieldset disabled><input type=password></fieldset></form>'), false);
  assert.equal(external('<form action="https://collector.example"><fieldset disabled><legend><input type=password></legend></fieldset></form>'), true);
});

test('page-wide and per-form input evidence share disabled-fieldset semantics', async () => {
  const result = await extractHtmlSignals('<form action="https://collector.example"><fieldset disabled><input type=password></fieldset></form>', 'portal.example', { baseUrl });
  assert.equal(result.hasPasswordField, false);
  assert.equal(result.hasExternalPasswordForm, false);
  assert.equal(profile('<form><fieldset disabled><input type=password></fieldset></form>').inputs.classifiedCount, 0);
  const legend = await extractHtmlSignals('<form><fieldset disabled><legend><input type=password></legend><input autocomplete=username></fieldset></form>', 'portal.example', { baseUrl });
  assert.equal(legend.hasPasswordField, true);
});

test('malformed actions and incomplete input remain unknown rather than a negative finding', () => {
  assert.equal(external('<form action="javascript:privateFunction()"><input type=password></form>'), null);
  assert.equal(external('<input type=password>'), null);
  assert.equal(external('<form><input type=password></form>', true), null);
  assert.equal(external('<form action="https://collector.example"><input type=password></form>', true), true);
});

test('recognises password autocomplete, ignores hidden controls and inert templates', () => {
  assert.equal(external('<form action="https://collector.example"><input autocomplete=current-password></form>'), true);
  assert.equal(external('<form action="https://collector.example"><input type=hidden autocomplete=current-password></form>'), false);
  assert.equal(external('<template><form action="https://collector.example"><input type=password></form></template>'), false);
});

test('attribution validator rejects hostile rows, hidden keys and inconsistent completeness', () => {
  const value = profile('<form><input type=password></form>').formAttribution;
  assert.equal(validCredentialFormAttribution({ ...value, unassociatedInputs: 1 }), false);
  assert.equal(validCredentialFormAttribution({ ...value, privateMarker: 'excluded sentinel' }), false);
  assert.equal(validCredentialFormAttribution({ ...value, forms: [{ ...value.forms[0], index: 2 }] }), false);
  assert.equal(validCredentialFormAttribution({ ...value, forms: [{ ...value.forms[0], destinations: [{ relationship: 'external', origin: 'https://collector.example/private' }] }] }), false);
  assert.equal(externalPasswordFormObservation({ ...value, complete: 'true' }), null);
});

test('historical page-wide booleans cannot acquire new-model attribution', () => {
  const result = explainRiskScore({ availability: 'registered', hasPasswordField: true, hasExternalFormAction: true });
  assert.ok(result);
  assert.ok(!result.factors.some(factor => /external destination|submits/.test(factor.label)));
});

test('the response boundary withholds conflicting, malformed and historical attribution without inventing a negative', () => {
  const credentialSurfaceProfile = profile('<form action="https://collector.example"><input type=password></form>');
  assert.equal(credentialSurfaceContractState(credentialSurfaceProfile), 'supported');
  const base = { availability: { credentialSurfaceProfile, hasExternalPasswordForm: true } };
  assert.equal(sanitizeLookupChildProfiles(base).availability.hasExternalPasswordForm, true);
  assert.equal(sanitizeLookupChildProfiles({ availability: { ...base.availability, hasExternalPasswordForm: false } }).availability.hasExternalPasswordForm, null);
  const malformed = structuredClone(credentialSurfaceProfile);
  malformed.formAttribution.forms[0]!.categories.password = 2;
  assert.equal(credentialSurfaceContractState(malformed), 'invalid');
  assert.equal(sanitizeLookupChildProfiles({ availability: { ...base.availability, credentialSurfaceProfile: malformed } }).availability.hasExternalPasswordForm, null);
  const { formAttribution: _attribution, ...historical } = credentialSurfaceProfile;
  assert.equal(credentialSurfaceContractState({ ...historical, credentialSurfaceVersion: 1 }), 'supported');
  assert.equal(sanitizeLookupChildProfiles({ availability: { ...base.availability, credentialSurfaceProfile: { ...historical, credentialSurfaceVersion: 1 } } }).availability.hasExternalPasswordForm, null);
});

test('clipped ownership attributes cannot create positive attribution', () => {
  const analysis = analyzeStaticHtml('<div></div><form id=remote action="https://collector.example"></form><input form=remote type=password>', { baseUrl });
  const uncertain = analysis.elements.find(element => element.name === 'div')!;
  uncertain.attributesTruncated = true;
  const result = attributeCredentialForms(analysis, baseUrl);
  assert.equal(result.complete, false);
  assert.equal(result.unassociatedInputs, 1);
  assert.equal(externalPasswordFormObservation(result), null);
});

test('clipped disabled-state ancestry cannot attribute a potentially disabled field', () => {
  const analysis = analyzeStaticHtml('<form action="https://collector.example"><fieldset><input type=password></fieldset></form>', { baseUrl });
  analysis.elements.find(element => element.name === 'fieldset')!.attributesTruncated = true;
  assert.equal(externalPasswordFormObservation(attributeCredentialForms(analysis, baseUrl)), null);
});
