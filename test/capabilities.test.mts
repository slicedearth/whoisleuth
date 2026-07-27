import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityReport, isCapabilityStatus } from '../lib/capabilities.mts';
import { OPERATION_CLASSES, OPERATION_USAGE_MODEL_VERSION } from '../lib/operation-budget.mts';
import { buildSessionCookie, createSessionToken } from '../lib/auth.mts';
import { handler } from '../netlify/functions/capabilities.mts';
import { requiredValue, stringValue } from './value-assertions.mts';

type CapabilityReport = ReturnType<typeof capabilityReport>;
type OperationBudgetProvider = NonNullable<Parameters<typeof capabilityReport>[2]>;

function featureById(report: CapabilityReport, id: string) {
  return requiredValue(report.features.find((feature) => feature.id === id));
}

test('capability report is deterministic, provider-neutral, and honest about execution', () => {
  const report = capabilityReport('netlify');
  assert.equal(report.version, 1);
  assert.equal(report.runtime, 'netlify');
  assert.equal(report.authoritative, true);
  assert.ok(report.features.every((feature) => isCapabilityStatus(feature.status)));
  assert.equal(featureById(report, 'lookup').status, 'supported');
  assert.equal(featureById(report, 'tls_intelligence').status, 'supported');
  assert.equal(featureById(report, 'idn_confusables').status, 'local_only');
  assert.equal(featureById(report, 'scheduled_monitoring').status, 'disabled');
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
  const distributed: OperationBudgetProvider = {
    mode: 'redis_rest',
    distributed: true,
    limits: { [OPERATION_CLASSES.REGISTRY_LIGHT]: { session: 2, runtime: 3 } },
    usageLimits: {
      modelVersion: OPERATION_USAGE_MODEL_VERSION,
      daily: 100,
      monthly: 1000,
      features: { lookup_fast: { daily: 50, monthly: 500 } },
    },
    acquire() {
      return { allowed: false, scope: 'provider', retryAfterSeconds: 1 };
    },
    status() {
      return [];
    },
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
  assert.equal(featureById(enabled, 'distributed_budgets').status, 'supported');
  assert.match(enabled.limitations[0], /concurrency.*usage allowances.*deployment-wide/i);

  const unavailable: OperationBudgetProvider = {
    mode: 'unavailable',
    distributed: false,
    limits: { [OPERATION_CLASSES.REGISTRY_LIGHT]: { session: 2, runtime: 3 } },
    acquire() {
      return { allowed: false, scope: 'provider', retryAfterSeconds: 1 };
    },
    status() {
      return [];
    },
  };
  const disabled = capabilityReport('netlify', {}, unavailable);
  assert.equal(featureById(disabled, 'distributed_budgets').status, 'unavailable');
  assert.equal(disabled.controls.concurrency.usage.mode, 'unavailable');
  assert.match(disabled.limitations[0], /fail closed/i);
});

test('emergency switches are reflected by the server-authoritative feature report', () => {
  const report = capabilityReport('express', {
    WHOISLEUTH_DISABLE_RDAP: '1',
    WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: 'true',
    WHOISLEUTH_DISABLE_TLS_INTELLIGENCE: 'yes',
  });
  const rdap = featureById(report, 'rdap');
  const dns = featureById(report, 'dns_intelligence');
  const posture = featureById(report, 'domain_posture');
  const tls = featureById(report, 'tls_intelligence');
  assert.equal(rdap.status, 'disabled');
  assert.equal(dns.status, 'disabled');
  assert.equal(posture.status, 'disabled');
  assert.equal(tls.status, 'disabled');
  assert.match(stringValue(posture.reason), /DNS intelligence is disabled/i);
  assert.equal(featureById(report, 'lookup').status, 'supported');
});

test('optional scheduled monitoring is explicit, credential-gated, and Netlify-only', () => {
  const disabled = capabilityReport('netlify', {});
  const unavailable = capabilityReport('netlify', { WHOISLEUTH_SCHEDULED_MONITORING: '1' });
  const readyEnvironment = {
    WHOISLEUTH_SCHEDULED_MONITORING: '1',
    WHOISLEUTH_SCHEDULED_MONITOR_KEY: Buffer.alloc(32, 7).toString('base64'),
    WHOISLEUTH_SCHEDULED_MONITOR_NAMESPACE: 'whoisleuth:scheduled-monitor:test',
  };
  const supported = capabilityReport('netlify', readyEnvironment);
  const unsupportedRuntime = capabilityReport('express', readyEnvironment);
  const byId = (report: CapabilityReport) => featureById(report, 'scheduled_monitoring');
  assert.equal(byId(disabled).status, 'disabled');
  assert.match(stringValue(byId(disabled).reason), /not enabled/i);
  assert.equal(byId(unavailable).status, 'unavailable');
  assert.match(stringValue(byId(unavailable).reason), /valid WHOISLEUTH_SCHEDULED_MONITOR_KEY/i);
  assert.deepEqual(byId(supported), {
    id: 'scheduled_monitoring', status: 'supported', execution: 'worker', scanModes: ['fast'],
  });
  assert.equal(byId(unsupportedRuntime).status, 'unavailable');
  assert.match(stringValue(byId(unsupportedRuntime).reason), /Netlify worker deployment/i);
  assert.equal(JSON.stringify(supported).includes(readyEnvironment.WHOISLEUTH_SCHEDULED_MONITOR_KEY), false);
});

test('optional archived-verdict search is explicit, credential-gated, and deep-only', () => {
  const disabled = capabilityReport('express', {});
  const unavailable = capabilityReport('express', { WHOISLEUTH_ENABLE_URLSCAN: '1' });
  const supported = capabilityReport('express', {
    WHOISLEUTH_ENABLE_URLSCAN: '1',
    URLSCAN_API_KEY: 'fixture-api-key',
  });
  const byId = (report: CapabilityReport) => featureById(report, 'urlscan_search');
  assert.equal(byId(disabled).status, 'disabled');
  assert.match(stringValue(byId(disabled).reason), /not enabled/i);
  assert.equal(byId(unavailable).status, 'unavailable');
  assert.match(stringValue(byId(unavailable).reason), /credential is unavailable or malformed/i);
  assert.deepEqual(byId(supported), {
    id: 'urlscan_search', status: 'supported', execution: 'hosted', scanModes: ['deep'],
  });
  assert.equal(JSON.stringify(supported).includes('fixture-api-key'), false);
});

test('optional malware-host intelligence is explicit, credential-gated, and deep-only', () => {
  const disabled = capabilityReport('express', {});
  const unavailable = capabilityReport('express', { WHOISLEUTH_ENABLE_URLHAUS: '1' });
  const supported = capabilityReport('express', {
    WHOISLEUTH_ENABLE_URLHAUS: '1',
    URLHAUS_AUTH_KEY: 'fixture-auth-key',
  });
  const byId = (report: CapabilityReport) => featureById(report, 'urlhaus_host');
  assert.equal(byId(disabled).status, 'disabled');
  assert.match(stringValue(byId(disabled).reason), /not enabled/i);
  assert.equal(byId(unavailable).status, 'unavailable');
  assert.match(stringValue(byId(unavailable).reason), /credential is unavailable or malformed/i);
  assert.deepEqual(byId(supported), {
    id: 'urlhaus_host', status: 'supported', execution: 'hosted', scanModes: ['deep'],
  });
  assert.equal(JSON.stringify(supported).includes('fixture-auth-key'), false);
});

test('optional malware-IOC intelligence is explicit, credential-gated, and deep-only', () => {
  const disabled = capabilityReport('express', {});
  const unavailable = capabilityReport('express', { WHOISLEUTH_ENABLE_THREATFOX: '1' });
  const supported = capabilityReport('express', {
    WHOISLEUTH_ENABLE_THREATFOX: '1',
    ABUSECH_AUTH_KEY: 'fixture-auth-key',
  });
  const byId = (report: CapabilityReport) => featureById(report, 'threatfox_domain_ioc');
  assert.equal(byId(disabled).status, 'disabled');
  assert.match(stringValue(byId(disabled).reason), /not enabled/i);
  assert.equal(byId(unavailable).status, 'unavailable');
  assert.match(stringValue(byId(unavailable).reason), /credential is unavailable or malformed/i);
  assert.deepEqual(byId(supported), {
    id: 'threatfox_domain_ioc', status: 'supported', execution: 'hosted', scanModes: ['deep'],
  });
  assert.equal(JSON.stringify(supported).includes('fixture-auth-key'), false);
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
    const body = JSON.parse(requiredValue(allowed.body));
    assert.equal(body.runtime, 'netlify');
    assert.equal(body.authoritative, true);
  } finally {
    if (previousPassword === undefined) delete process.env.SITE_PASSWORD; else process.env.SITE_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
  }
});
