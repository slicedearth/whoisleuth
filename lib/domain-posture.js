// Owned-domain email/DNS posture audit. DNS and HTTPS collection lives here
// so Express and Netlify expose the same result shape; the parsers and report
// builder are pure, keeping policy interpretation independently testable.

const dns = require('dns').promises;
const { fetchRdapRecord } = require('./rdap');
const { safeFetch, readTextCapped } = require('./safe-fetch');
const { classifyMxRecords } = require('./dns-mx');
const {
  parseSpfRecords,
  parseDmarcRecords,
  parseMtaStsDnsRecords,
  parseMtaStsPolicy,
  parseTlsRptRecords,
  parseBimiRecords,
  parseDkimRecords,
} = require('./domain-posture-parsers');

const DNS_TIMEOUT_MS = 6000;
const POLICY_TIMEOUT_MS = 7000;
const MAX_POLICY_BYTES = 64 * 1024;
const MAX_DKIM_SELECTORS = 10;
const MISSING_DNS_CODES = new Set(['ENODATA', 'ENOTFOUND', 'ENONAME']);

function trimTerminalDots(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 46) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

function trimEdgeDots(value) {
  let start = 0;
  const withoutTerminalDots = trimTerminalDots(value);
  while (start < withoutTerminalDots.length && withoutTerminalDots.charCodeAt(start) === 46) start += 1;
  return start === 0 ? withoutTerminalDots : withoutTerminalDots.slice(start);
}

function normalizeAuditDomain(raw) {
  try {
    const input = trimTerminalDots(String(raw || '').trim());
    const hostname = new URL(`https://${input}`).hostname.toLowerCase();
    if (!hostname.includes('.') || hostname.length > 253) return null;
    if (!hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
    return hostname;
  } catch {
    return null;
  }
}

function normalizeDkimSelectors(rawSelectors) {
  if (!Array.isArray(rawSelectors)) return [];
  return [...new Set(rawSelectors
    .map((selector) => trimEdgeDots(String(selector || '').trim().toLowerCase()))
    .filter((selector) => selector.length > 0 && selector.length <= 253)
    .filter((selector) => selector.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))))]
    .slice(0, MAX_DKIM_SELECTORS);
}

function withTimeout(promise, label, timeoutMs = DNS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (err) => { clearTimeout(timeout); reject(err); }
    );
  });
}

async function resolveDns(label, factory) {
  try {
    return { records: await withTimeout(factory(), label), error: null };
  } catch (err) {
    if (MISSING_DNS_CODES.has(err && err.code)) return { records: [], error: null };
    return { records: [], error: err && err.message ? err.message : String(err) };
  }
}

/**
 * @param {string} id
 * @param {string} label
 * @param {'pass' | 'warning' | 'danger' | 'info'} status
 * @param {string} summary
 * @param {{ detail?: string, records?: string[], remediation?: string }} [options]
 */
function check(id, label, status, summary, { detail = '', records = [], remediation = '' } = {}) {
  return { id, label, status, summary, detail, records, remediation };
}

function queryFailureCheck(id, label, error) {
  return check(id, label, 'info', 'Check could not be completed', {
    detail: error,
    remediation: 'Retry the audit before changing DNS; a resolver failure is not evidence that the policy is absent.',
  });
}

function spfCheck(query) {
  if (query.error) return queryFailureCheck('spf', 'SPF', query.error);
  const parsed = parseSpfRecords(query.records);
  if (parsed.records.length === 0) {
    return check('spf', 'SPF', 'warning', 'No SPF policy published', {
      remediation: 'Publish one SPF TXT record that authorizes every legitimate sender and ends in -all once verified.',
    });
  }
  if (!parsed.valid) {
    return check('spf', 'SPF', 'danger', 'SPF policy is invalid', {
      detail: parsed.issues.join(' '), records: parsed.records,
      remediation: 'Consolidate the policy into exactly one v=spf1 TXT record and validate its syntax.',
    });
  }

  const details = [`Terminal policy: ${parsed.terminalPolicy}.`, `Top-level DNS-querying terms: ${parsed.dnsLookupTerms}.`, ...parsed.issues];
  if (parsed.terminalPolicy === 'pass') {
    return check('spf', 'SPF', 'danger', 'Policy authorizes every sender (+all)', {
      detail: details.join(' '), records: parsed.records,
      remediation: 'Replace +all with an explicit sender allowlist and a restrictive terminal policy.',
    });
  }
  if (parsed.terminalPolicy === 'fail' && parsed.issues.length === 0) {
    return check('spf', 'SPF', 'pass', 'Restrictive fail-all policy', { detail: details.join(' '), records: parsed.records });
  }
  if (parsed.terminalPolicy === 'redirect') {
    return check('spf', 'SPF', 'info', 'Policy delegates evaluation with redirect', {
      detail: `${details.join(' ')} The redirect target is not recursively evaluated by this audit.`, records: parsed.records,
      remediation: 'Confirm the redirect target exists, remains under trusted control, and resolves within SPF lookup limits.',
    });
  }
  return check('spf', 'SPF', 'warning', `Policy ends in ${parsed.terminalPolicy || 'an unknown result'}`, {
    detail: details.join(' '), records: parsed.records,
    remediation: parsed.terminalPolicy === 'softfail'
      ? 'Move from ~all to -all after confirming every legitimate sending service is authorized.'
      : 'Add a restrictive -all terminal policy after confirming every legitimate sending service.',
  });
}

function dmarcCheck(query) {
  if (query.error) return queryFailureCheck('dmarc', 'DMARC', query.error);
  const parsed = parseDmarcRecords(query.records);
  if (parsed.records.length === 0) {
    return check('dmarc', 'DMARC', 'danger', 'No DMARC policy published', {
      remediation: 'Publish _dmarc as a single v=DMARC1 record, begin with reporting, then move to quarantine or reject enforcement.',
    });
  }
  if (!parsed.valid) {
    return check('dmarc', 'DMARC', 'danger', 'DMARC policy is invalid', {
      detail: parsed.issues.join(' '), records: parsed.records,
      remediation: 'Publish one syntactically valid DMARC record and remove duplicate or unsupported tags.',
    });
  }

  const details = [
    `Domain policy: ${parsed.policy}.`,
    `Subdomain policy: ${parsed.subdomainPolicy}.`,
    `Non-existent subdomain policy: ${parsed.nonexistentSubdomainPolicy}.`,
    parsed.aggregateReporting ? 'Aggregate reporting is configured.' : 'No aggregate reporting destination is configured.',
    parsed.failureReporting ? 'Failure reporting is configured.' : 'No failure reporting destination is configured.',
    ...parsed.issues,
  ];
  if (parsed.testMode) {
    return check('dmarc', 'DMARC', 'warning', 'Policy is in test mode (t=y)', {
      detail: details.join(' '), records: parsed.records,
      remediation: 'Remove t=y once reports confirm legitimate mail passes alignment.',
    });
  }
  if (parsed.policy === 'none') {
    return check('dmarc', 'DMARC', 'warning', 'Monitoring only (p=none)', {
      detail: details.join(' '), records: parsed.records,
      remediation: 'Use aggregate reports to fix alignment, then move to p=quarantine or p=reject.',
    });
  }
  if (parsed.subdomainPolicy === 'none' || parsed.nonexistentSubdomainPolicy === 'none') {
    return check('dmarc', 'DMARC', 'warning', `Domain enforced at p=${parsed.policy}; subdomain coverage is weaker`, {
      detail: details.join(' '), records: parsed.records,
      remediation: 'Set sp and np to quarantine or reject unless weaker subdomain treatment is intentional.',
    });
  }
  if (!parsed.aggregateReporting) {
    return check('dmarc', 'DMARC', 'warning', `Enforced at p=${parsed.policy}; aggregate reporting is not configured`, {
      detail: details.join(' '), records: parsed.records,
      remediation: 'Add a monitored rua destination so authentication failures and abuse trends remain visible.',
    });
  }
  if (parsed.legacyPct !== null) {
    return check('dmarc', 'DMARC', 'warning', `Enforced at p=${parsed.policy}; legacy pct tag is still published`, {
      detail: details.join(' '), records: parsed.records,
      remediation: 'Remove the historic pct tag and use the current DMARC test-mode/enforcement controls.',
    });
  }
  return check('dmarc', 'DMARC', 'pass', `Enforced at p=${parsed.policy}`, { detail: details.join(' '), records: parsed.records });
}

function mxCheck(query) {
  if (query.error) return queryFailureCheck('mx', 'Mail exchange', query.error);
  const classified = classifyMxRecords(query.records);
  const records = query.records.map((record) => `${record.priority} ${record.exchange || '.'}`);
  if (classified.hasNullMx) {
    return check('mx', 'Mail exchange', 'pass', 'Null MX explicitly declines inbound mail', {
      records,
      detail: 'This is appropriate only if the domain is intentionally unable to receive email.',
    });
  }
  if (classified.hasMx) {
    return check('mx', 'Mail exchange', 'pass', `${classified.mxHosts.length} mail exchanger${classified.mxHosts.length === 1 ? '' : 's'} configured`, { records });
  }
  return check('mx', 'Mail exchange', 'warning', 'No explicit MX record', {
    remediation: 'Publish valid MX records for a receiving domain, or a null MX if the domain intentionally accepts no mail.',
  });
}

function dnssecCheck(input) {
  if (input.error) return queryFailureCheck('dnssec', 'DNSSEC', input.error);
  const value = String(input.value || '').toLowerCase();
  if (value === 'signed') return check('dnssec', 'DNSSEC', 'pass', 'Registry reports a signed delegation');
  if (value === 'unsigned') {
    return check('dnssec', 'DNSSEC', 'warning', 'Registry reports an unsigned delegation', {
      remediation: 'Enable DNSSEC with the DNS provider and publish the DS record through the registrar.',
    });
  }
  return check('dnssec', 'DNSSEC', 'info', 'Delegation status is unavailable', {
    detail: 'The registry record did not expose a conclusive DNSSEC delegation state.',
  });
}

function caaDisplay(record) {
  const property = ['issue', 'issuewild', 'iodef', 'contactemail', 'contactphone'].find((key) => record[key] !== undefined);
  return property ? `${record.critical || 0} ${property} "${record[property]}"` : JSON.stringify(record);
}

function caaCheck(query) {
  if (query.error) return queryFailureCheck('caa', 'CAA', query.error);
  const records = query.records.map(caaDisplay);
  if (records.length > 0) return check('caa', 'CAA', 'pass', `${records.length} certificate-authority rule${records.length === 1 ? '' : 's'} published`, { records });
  return check('caa', 'CAA', 'warning', 'No CAA policy published', {
    detail: 'No CAA record was returned for this exact name; a subdomain can still inherit policy from a parent name.',
    remediation: 'Publish CAA issue/issuewild records to restrict which certificate authorities may issue for the domain.',
  });
}

function matchesMtaPattern(host, pattern) {
  const normalizedHost = String(host || '').toLowerCase().replace(/\.+$/, '');
  const normalizedPattern = String(pattern || '').toLowerCase().replace(/\.+$/, '');
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(1);
    return normalizedHost.endsWith(suffix) && normalizedHost.length > suffix.length;
  }
  return normalizedHost === normalizedPattern;
}

function mtaStsCheck(dnsQuery, policyFetch, mxQuery) {
  if (dnsQuery.error) return queryFailureCheck('mta_sts', 'MTA-STS', dnsQuery.error);
  const dnsPolicy = parseMtaStsDnsRecords(dnsQuery.records);
  const hasMx = !mxQuery.error && classifyMxRecords(mxQuery.records).hasMx;
  if (dnsPolicy.records.length === 0) {
    return check('mta_sts', 'MTA-STS', hasMx ? 'warning' : 'info', 'No MTA-STS policy advertised', {
      remediation: hasMx ? 'Publish _mta-sts and serve a valid policy over HTTPS to require authenticated TLS for inbound mail.' : '',
    });
  }
  if (!dnsPolicy.valid) {
    return check('mta_sts', 'MTA-STS', 'danger', 'MTA-STS DNS record is invalid', {
      detail: dnsPolicy.issues.join(' '), records: dnsPolicy.records,
      remediation: 'Publish exactly one v=STSv1 DNS record with a non-empty id tag.',
    });
  }
  if (!policyFetch || policyFetch.error) {
    return check('mta_sts', 'MTA-STS', 'danger', 'Policy is advertised but cannot be validated', {
      detail: policyFetch?.error || 'The HTTPS policy was not fetched.', records: dnsPolicy.records,
      remediation: 'Serve a text/plain policy with a valid certificate at https://mta-sts.<domain>/.well-known/mta-sts.txt.',
    });
  }

  const policy = parseMtaStsPolicy(policyFetch.text);
  const records = [...dnsPolicy.records, ...String(policyFetch.text || '').trim().split(/\r?\n/).filter(Boolean)];
  if (!policy.valid) {
    return check('mta_sts', 'MTA-STS', 'danger', 'HTTPS policy is invalid', {
      detail: policy.issues.join(' '), records,
      remediation: 'Fix the STSv1 policy fields, max_age, mode, and MX patterns at the well-known HTTPS location.',
    });
  }
  if (!policyFetch.contentType || !/^text\/plain(?:\s*;|$)/i.test(policyFetch.contentType)) {
    return check('mta_sts', 'MTA-STS', 'danger', 'HTTPS policy has the wrong content type', {
      detail: `${policyFetch.contentType ? `Received ${policyFetch.contentType}` : 'No Content-Type header was returned'}; MTA-STS policies should be served as text/plain.`, records,
      remediation: 'Configure the policy host to return Content-Type: text/plain.',
    });
  }

  const mxHosts = mxQuery.error ? [] : classifyMxRecords(mxQuery.records).mxHosts;
  const unmatched = mxHosts.filter((host) => !policy.mx.some((pattern) => matchesMtaPattern(host, pattern)));
  if (unmatched.length) {
    return check('mta_sts', 'MTA-STS', 'danger', 'Policy does not cover every published MX host', {
      detail: `Unmatched MX: ${unmatched.join(', ')}.`, records,
      remediation: 'Add each legitimate MX host (or an appropriate wildcard) to the HTTPS policy before enforcing it.',
    });
  }
  if (policy.mode === 'enforce') return check('mta_sts', 'MTA-STS', 'pass', 'Authenticated TLS is enforced', { detail: `Policy max_age: ${policy.maxAge} seconds.`, records });
  if (policy.mode === 'testing') {
    return check('mta_sts', 'MTA-STS', 'warning', 'Policy is in testing mode', {
      detail: `Policy max_age: ${policy.maxAge} seconds.`, records,
      remediation: 'Review TLS reports and move the policy to mode: enforce once every legitimate MX is covered.',
    });
  }
  return check('mta_sts', 'MTA-STS', 'warning', 'Policy explicitly disables enforcement (mode: none)', {
    records, remediation: 'Use testing, then enforce, if this domain receives mail and its providers support authenticated TLS.',
  });
}

function tlsRptCheck(query, mxQuery) {
  if (query.error) return queryFailureCheck('tls_rpt', 'TLS-RPT', query.error);
  const parsed = parseTlsRptRecords(query.records);
  if (parsed.records.length === 0) {
    const hasMx = !mxQuery.error && classifyMxRecords(mxQuery.records).hasMx;
    return check('tls_rpt', 'TLS-RPT', hasMx ? 'warning' : 'info', 'No SMTP TLS reporting policy', {
      detail: hasMx ? '' : 'The domain has no receiving mail exchanger, so SMTP TLS reporting is not currently actionable.',
      remediation: hasMx ? 'Publish a v=TLSRPTv1 record at _smtp._tls with a monitored rua destination.' : '',
    });
  }
  if (!parsed.valid) {
    return check('tls_rpt', 'TLS-RPT', 'danger', 'TLS reporting policy is invalid', {
      detail: parsed.issues.join(' '), records: parsed.records,
      remediation: 'Publish exactly one v=TLSRPTv1 record with at least one valid rua destination.',
    });
  }
  return check('tls_rpt', 'TLS-RPT', 'pass', `${parsed.rua.length} report destination${parsed.rua.length === 1 ? '' : 's'} configured`, { records: parsed.records });
}

function bimiCheck(query, dmarcQuery) {
  if (query.error) return queryFailureCheck('bimi', 'BIMI', query.error);
  const parsed = parseBimiRecords(query.records);
  if (parsed.records.length === 0) return check('bimi', 'BIMI', 'info', 'No default-selector BIMI record', { detail: 'BIMI is optional and does not affect mail authentication.' });
  if (!parsed.valid) {
    return check('bimi', 'BIMI', 'warning', 'Default-selector BIMI record is invalid', {
      detail: parsed.issues.join(' '), records: parsed.records,
      remediation: 'Publish one v=BIMI1 record with an HTTPS SVG logo location.',
    });
  }

  const dmarc = dmarcQuery.error ? null : parseDmarcRecords(dmarcQuery.records);
  const enforcementReady = dmarc?.valid
    && !dmarc.testMode
    && typeof dmarc.policy === 'string'
    && ['quarantine', 'reject'].includes(dmarc.policy)
    && typeof dmarc.subdomainPolicy === 'string'
    && ['quarantine', 'reject'].includes(dmarc.subdomainPolicy)
    && (dmarc.legacyPct === null || dmarc.legacyPct === 100);
  if (!enforcementReady) {
    return check('bimi', 'BIMI', 'warning', 'Record exists but DMARC is not BIMI-ready', {
      detail: 'BIMI display generally requires enforced DMARC for the organizational domain and subdomains. Mailbox providers apply additional requirements.',
      records: parsed.records,
      remediation: 'Enforce DMARC at quarantine or reject for the domain and subdomains before relying on BIMI.',
    });
  }
  return check('bimi', 'BIMI', 'pass', parsed.authority ? 'Logo and authority evidence published' : 'Logo published; provider-specific evidence may still be required', {
    detail: 'Mailbox providers decide independently whether to display a logo.', records: parsed.records,
  });
}

function dkimCheck(selectorQueries) {
  if (!Array.isArray(selectorQueries) || selectorQueries.length === 0) {
    return check('dkim', 'DKIM', 'info', 'Not checked: no selectors configured', {
      detail: 'DKIM selectors cannot be discovered reliably from DNS; configure the selectors used by each legitimate sending platform in the Brand Profile.',
    });
  }

  const results = selectorQueries.map(({ selector, records, error }) => error
    ? { selector, valid: false, records: [], keyType: null, revoked: false, testing: false, issues: [error] }
    : parseDkimRecords(selector, records));
  const valid = results.filter((result) => result.valid);
  const records = results.flatMap((result) => result.records.map((record) => `${result.selector}: ${record}`));
  if (valid.length === results.length) {
    const testing = results.filter((result) => result.testing).map((result) => result.selector);
    return check('dkim', 'DKIM', testing.length ? 'warning' : 'pass', `${valid.length} configured selector${valid.length === 1 ? '' : 's'} publish valid keys`, {
      detail: testing.length ? `Testing flag is enabled for: ${testing.join(', ')}.` : '', records,
      remediation: testing.length ? 'Remove the DKIM t=y testing flag after validation.' : '',
    });
  }
  const failed = results.filter((result) => !result.valid);
  return check('dkim', 'DKIM', 'warning', `${failed.length} configured selector${failed.length === 1 ? '' : 's'} could not be validated`, {
    detail: failed.map((result) => `${result.selector}: ${result.issues.join(' ')}`).join(' '), records,
    remediation: 'Confirm each selector is current, publish its public key, or remove retired selectors from the Brand Profile.',
  });
}

function buildPostureReport(domain, input) {
  const checks = [
    spfCheck(input.spf),
    dmarcCheck(input.dmarc),
    mxCheck(input.mx),
    dnssecCheck(input.dnssec),
    caaCheck(input.caa),
    mtaStsCheck(input.mtaStsDns, input.mtaStsPolicy, input.mx),
    tlsRptCheck(input.tlsRpt, input.mx),
    bimiCheck(input.bimi, input.dmarc),
    dkimCheck(input.dkim),
  ];
  const summary = { pass: 0, warning: 0, danger: 0, info: 0 };
  for (const item of checks) summary[item.status] += 1;
  return { domain, summary, checks };
}

async function fetchMtaStsPolicy(domain) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POLICY_TIMEOUT_MS);
  try {
    const url = `https://mta-sts.${domain}/.well-known/mta-sts.txt`;
    const res = await safeFetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WHOISleuth-Posture/1.0)', Accept: 'text/plain' },
    });
    if (!res.ok) {
      // Not reading this body - release it explicitly instead of leaving an
      // unconsumed stream (and the connection it's tied to) open until
      // undici's own idle-timeout eventually notices.
      await res.body?.cancel().catch(() => {});
      return { text: '', contentType: res.headers.get('content-type'), error: `Policy endpoint returned HTTP ${res.status}.` };
    }
    const body = await readTextCapped(res, MAX_POLICY_BYTES);
    if (body.truncated) return { text: '', contentType: res.headers.get('content-type'), error: `Policy exceeds ${MAX_POLICY_BYTES} bytes.` };
    return { text: body.text, contentType: res.headers.get('content-type'), error: null };
  } catch (err) {
    return { text: '', contentType: null, error: err && err.name === 'AbortError' ? 'Policy fetch timed out.' : (err.message || String(err)) };
  } finally {
    clearTimeout(timeout);
  }
}

/** @param {string} domain @param {{ dkimSelectors?: string[] }} [options] */
async function checkDomainPosture(domain, { dkimSelectors = [] } = {}) {
  const normalizedDomain = normalizeAuditDomain(domain);
  if (!normalizedDomain) throw new Error('Invalid domain name for posture audit.');
  domain = normalizedDomain;
  const selectors = normalizeDkimSelectors(dkimSelectors);
  const [spf, dmarc, mx, caa, mtaStsDns, tlsRpt, bimi, dkim, rdap] = await Promise.all([
    resolveDns(`TXT ${domain}`, () => dns.resolveTxt(domain)),
    resolveDns(`TXT _dmarc.${domain}`, () => dns.resolveTxt(`_dmarc.${domain}`)),
    resolveDns(`MX ${domain}`, () => dns.resolveMx(domain)),
    resolveDns(`CAA ${domain}`, () => dns.resolveCaa(domain)),
    resolveDns(`TXT _mta-sts.${domain}`, () => dns.resolveTxt(`_mta-sts.${domain}`)),
    resolveDns(`TXT _smtp._tls.${domain}`, () => dns.resolveTxt(`_smtp._tls.${domain}`)),
    resolveDns(`TXT default._bimi.${domain}`, () => dns.resolveTxt(`default._bimi.${domain}`)),
    Promise.all(selectors.map(async (selector) => ({
      selector,
      ...await resolveDns(`TXT ${selector}._domainkey.${domain}`, () => dns.resolveTxt(`${selector}._domainkey.${domain}`)),
    }))),
    fetchRdapRecord('domain', domain).catch((err) => ({ error: err.message || String(err) })),
  ]);

  const parsedMtaDns = mtaStsDns.error ? null : parseMtaStsDnsRecords(mtaStsDns.records);
  const mtaStsPolicy = parsedMtaDns?.valid ? await fetchMtaStsPolicy(domain) : null;
  const dnssec = rdap?.error
    ? { value: null, error: rdap.error }
    : { value: rdap?.parsed?.dnssec || null, error: null };
  const report = buildPostureReport(domain, { spf, dmarc, mx, caa, mtaStsDns, mtaStsPolicy, tlsRpt, bimi, dkim, dnssec });
  return { ...report, checkedAt: new Date().toISOString(), dkimSelectors: selectors };
}

module.exports = {
  normalizeAuditDomain,
  normalizeDkimSelectors,
  matchesMtaPattern,
  buildPostureReport,
  checkDomainPosture,
};
