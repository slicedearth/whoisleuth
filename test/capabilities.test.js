const test = require('node:test');
const assert = require('node:assert/strict');
const { capabilityReport, isCapabilityStatus } = require('../lib/capabilities');
const { OPERATION_CLASSES } = require('../lib/operation-budget');
const { createSessionToken, buildSessionCookie } = require('../lib/auth');
const { handler } = require('../netlify/functions/capabilities.mts');

test('capability report is deterministic, provider-neutral, and honest about execution', () => {
  const report = capabilityReport('netlify');
  assert.equal(report.version, 1);
  assert.equal(report.runtime, 'netlify');
  assert.equal(report.authoritative, true);
  assert.ok(report.features.every((feature) => isCapabilityStatus(feature.status)));
  assert.equal(report.features.find((feature) => feature.id === 'lookup').status, 'supported');
  assert.equal(report.features.find((feature) => feature.id === 'tls_intelligence').status, 'supported');
  assert.equal(report.features.find((feature) => feature.id === 'idn_confusables').status, 'local_only');
  assert.equal(report.features.find((feature) => feature.id === 'scheduled_monitoring').status, 'unavailable');
  assert.equal(report.controls.concurrency.mode, 'in_memory');
  assert.equal(report.controls.concurrency.scope, 'serverless_instance');
  assert.equal(report.controls.concurrency.distributed, false);
  assert.equal(report.controls.concurrency.usage.mode, 'disabled');
  assert.ok(report.controls.concurrency.classes.every((entry) => entry.runtimeLimit >= entry.sessionLimit));
  assert.match(report.limitations[0], /per serverless instance/i);
  assert.deepEqual(capabilityReport('netlify'), report);
});

test('unknown runtimes fail to a bounded generic report without changing features', () => {
  const report = capabilityReport('unexpected');
  assert.equal(report.runtime, 'unknown');
  assert.equal(report.features.length, capabilityReport('express').features.length);
  assert.match(report.limitations[0], /runtime instance/i);
});

test('capability reports distinguish configured distributed and unavailable budgets', () => {
  const distributed = {
    mode: 'redis_rest',
    distributed: true,
    limits: { [OPERATION_CLASSES.REGISTRY_LIGHT]: { session: 2, runtime: 3 } },
    usageLimits: {
      daily: 100,
      monthly: 1000,
      features: { lookup_fast: { daily: 50, monthly: 500 } },
    },
    acquire() {},
    status() {},
  };
  const enabled = capabilityReport('netlify', {}, distributed);
  assert.equal(enabled.controls.concurrency.mode, 'redis_rest');
  assert.equal(enabled.controls.concurrency.scope, 'deployment');
  assert.equal(enabled.controls.concurrency.distributed, true);
  assert.equal(enabled.controls.concurrency.usage.mode, 'distributed_fixed_windows');
  assert.equal(enabled.controls.concurrency.usage.dailyLimit, 100);
  assert.deepEqual(enabled.controls.concurrency.usage.features, [
    { id: 'lookup_fast', dailyLimit: 50, thirtyDayLimit: 500 },
  ]);
  assert.equal(enabled.features.find((feature) => feature.id === 'distributed_budgets').status, 'supported');
  assert.match(enabled.limitations[0], /concurrency.*usage allowances.*deployment-wide/i);

  const unavailable = {
    mode: 'unavailable',
    distributed: false,
    limits: { [OPERATION_CLASSES.REGISTRY_LIGHT]: { session: 2, runtime: 3 } },
    acquire() {},
    status() {},
  };
  const disabled = capabilityReport('netlify', {}, unavailable);
  assert.equal(disabled.features.find((feature) => feature.id === 'distributed_budgets').status, 'unavailable');
  assert.equal(disabled.controls.concurrency.usage.mode, 'unavailable');
  assert.match(disabled.limitations[0], /fail closed/i);
});

test('emergency switches are reflected by the server-authoritative feature report', () => {
  const report = capabilityReport('express', {
    WHOISLEUTH_DISABLE_RDAP: '1',
    WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: 'true',
    WHOISLEUTH_DISABLE_TLS_INTELLIGENCE: 'yes',
  });
  const rdap = report.features.find((feature) => feature.id === 'rdap');
  const dns = report.features.find((feature) => feature.id === 'dns_intelligence');
  const posture = report.features.find((feature) => feature.id === 'domain_posture');
  const tls = report.features.find((feature) => feature.id === 'tls_intelligence');
  assert.equal(rdap.status, 'disabled');
  assert.equal(dns.status, 'disabled');
  assert.equal(posture.status, 'disabled');
  assert.equal(tls.status, 'disabled');
  assert.match(posture.reason, /DNS intelligence is disabled/i);
  assert.equal(report.features.find((feature) => feature.id === 'lookup').status, 'supported');
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
