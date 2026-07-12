const test = require('node:test');
const assert = require('node:assert/strict');
const { capabilityReport, isCapabilityStatus } = require('../lib/capabilities');
const { createSessionToken, buildSessionCookie } = require('../lib/auth');
const { handler } = require('../netlify/functions/capabilities');

test('capability report is deterministic, provider-neutral, and honest about execution', () => {
  const report = capabilityReport('netlify');
  assert.equal(report.version, 1);
  assert.equal(report.runtime, 'netlify');
  assert.equal(report.authoritative, true);
  assert.ok(report.features.every((feature) => isCapabilityStatus(feature.status)));
  assert.equal(report.features.find((feature) => feature.id === 'lookup').status, 'supported');
  assert.equal(report.features.find((feature) => feature.id === 'idn_confusables').status, 'local_only');
  assert.equal(report.features.find((feature) => feature.id === 'scheduled_monitoring').status, 'unavailable');
  assert.match(report.limitations[0], /per serverless instance/i);
  assert.deepEqual(capabilityReport('netlify'), report);
});

test('unknown runtimes fail to a bounded generic report without changing features', () => {
  const report = capabilityReport('unexpected');
  assert.equal(report.runtime, 'unknown');
  assert.equal(report.features.length, capabilityReport('express').features.length);
});

test('direct serverless capability path requires authentication', async () => {
  const previousPassword = process.env.SITE_PASSWORD;
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SITE_PASSWORD = 'capability-test-password';
  process.env.SESSION_SECRET = 'capability-test-secret-with-sufficient-length';
  try {
    const denied = await handler({ headers: {} });
    assert.equal(denied.statusCode, 401);
    const cookie = buildSessionCookie(createSessionToken(), { secure: true }).split(';')[0];
    const allowed = await handler({ headers: { cookie } });
    assert.equal(allowed.statusCode, 200);
    const body = JSON.parse(allowed.body);
    assert.equal(body.runtime, 'netlify');
    assert.equal(body.authoritative, true);
  } finally {
    if (previousPassword === undefined) delete process.env.SITE_PASSWORD; else process.env.SITE_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
  }
});
