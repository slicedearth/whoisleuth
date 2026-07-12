const CAPABILITIES_VERSION = 1;
const CAPABILITY_STATUSES = new Set(['supported', 'disabled', 'unavailable', 'local_only']);

const DEFINITIONS = Object.freeze([
  { id: 'lookup', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
  { id: 'rdap', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
  { id: 'whois', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  { id: 'dns_intelligence', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  { id: 'certificate_transparency', status: 'supported', execution: 'hosted', scanModes: [] },
  { id: 'domain_posture', status: 'supported', execution: 'hosted', scanModes: [] },
  { id: 'idn_confusables', status: 'local_only', execution: 'browser', scanModes: ['fast', 'deep'] },
  { id: 'analyst_cases', status: 'local_only', execution: 'browser', scanModes: [] },
  { id: 'watchlists', status: 'local_only', execution: 'browser', scanModes: ['fast', 'deep'] },
  { id: 'scheduled_monitoring', status: 'unavailable', execution: 'worker', scanModes: [], reason: 'No scheduled worker is configured in this deployment.' },
  { id: 'distributed_budgets', status: 'unavailable', execution: 'hosted', scanModes: [], reason: 'Distributed counters are not configured.' },
]);

function capabilityReport(runtime = 'unknown') {
  const normalizedRuntime = ['express', 'netlify'].includes(runtime) ? runtime : 'unknown';
  return {
    version: CAPABILITIES_VERSION,
    runtime: normalizedRuntime,
    authoritative: true,
    features: DEFINITIONS.map((item) => ({ ...item, scanModes: [...item.scanModes] })),
    limitations: normalizedRuntime === 'netlify'
      ? ['In-memory rate and concurrency state is per serverless instance and resets on cold starts.']
      : ['In-memory controls are process-local and reset when the server restarts.'],
  };
}

function isCapabilityStatus(value) {
  return CAPABILITY_STATUSES.has(value);
}

module.exports = { CAPABILITIES_VERSION, capabilityReport, isCapabilityStatus };
