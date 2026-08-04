// Owned-domain email/DNS posture audit. DNS and HTTPS collection lives here
// so Express and Netlify expose the same result shape; the parsers and report
// builder are pure, keeping policy interpretation independently testable.

import { promises as dns } from 'node:dns';

import { fetchRdapRecord } from './rdap.mts';
import { nonEmptyErrorMessage } from './error-detail.mts';
import { safeFetch, readTextCapped } from './safe-fetch.mts';
import { whoisleuthRequestHeaders } from './outbound-identity.mts';
import { classifyMxRecords } from './dns-mx.mts';
import type { MxRecord } from './dns-mx.mts';
import {
  parseSpfRecords,
  parseDmarcRecords,
  parseMtaStsDnsRecords,
  parseMtaStsPolicy,
  parseTlsRptRecords,
  parseBimiRecords,
  parseDkimRecords,
} from './domain-posture-parsers.mts';
import {
  buildExternalDependencies,
  expandSpfPolicy,
  validateDmarcExternalReporting,
} from './domain-posture-analysis.mts';
import type {
  DmarcExternalAuthorization,
  ExternalDependency,
  SpfExpansion,
} from './domain-posture-analysis.mts';

const DNS_TIMEOUT_MS = 6000;
const POLICY_TIMEOUT_MS = 7000;
const MAX_POLICY_BYTES = 64 * 1024;
const MAX_DKIM_SELECTORS = 10;
const POSTURE_ENRICHMENT_DEADLINE_MS = 6500;
const MISSING_DNS_CODES = new Set(['ENODATA', 'ENOTFOUND', 'ENONAME']);

type DnsQuery = {
  records: unknown[];
  error: string | null;
};

type DnssecQuery = {
  value: unknown;
  error: string | null;
};

type MtaStsPolicyFetch = {
  text: string;
  contentType: string | null;
  error: string | null;
};

type DkimQuery = DnsQuery & { selector: string; retired?: boolean };
type MailProtectionProfile = 'defensive_no_mail' | 'parked' | 'standard';
type RegistryPostureEvidence = {
  statuses: string[];
  nameservers: string[];
  dsRecordCount: number;
  dsDataTruncated?: boolean;
  error: string | null;
};
type CheckStatus = 'pass' | 'warning' | 'danger' | 'info';
type PostureCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  summary: string;
  detail: string;
  records: string[];
  remediation: string;
};
type CheckOptions = { detail?: string; records?: string[]; remediation?: string };
type PostureInput = {
  spf: DnsQuery;
  dmarc: DnsQuery;
  mx: DnsQuery;
  dnssec: DnssecQuery;
  caa: DnsQuery;
  mtaStsDns: DnsQuery;
  mtaStsPolicy: MtaStsPolicyFetch | null;
  tlsRpt: DnsQuery;
  bimi: DnsQuery;
  dkim: DkimQuery[];
  spfExpansion?: SpfExpansion;
  dmarcAuthorizations?: DmarcExternalAuthorization[];
  nameservers?: DnsQuery;
  registry?: RegistryPostureEvidence;
  mailProtectionProfile?: MailProtectionProfile;
};

function errorRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asMxRecords(records: unknown[]): MxRecord[] {
  return records as MxRecord[];
}

function trimTerminalDots(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 46) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

function trimEdgeDots(value: string): string {
  let start = 0;
  const withoutTerminalDots = trimTerminalDots(value);
  while (start < withoutTerminalDots.length && withoutTerminalDots.charCodeAt(start) === 46) start += 1;
  return start === 0 ? withoutTerminalDots : withoutTerminalDots.slice(start);
}

function normalizeAuditDomain(raw: unknown): string | null {
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

function normalizeDkimSelectors(rawSelectors: unknown): string[] {
  if (!Array.isArray(rawSelectors)) return [];
  return [...new Set(rawSelectors
    .map((selector) => trimEdgeDots(String(selector || '').trim().toLowerCase()))
    .filter((selector) => selector.length > 0 && selector.length <= 253)
    .filter((selector) => selector.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))))]
    .slice(0, MAX_DKIM_SELECTORS);
}

function normalizeMailProtectionProfile(value: unknown): MailProtectionProfile {
  return value === 'defensive_no_mail' || value === 'parked' ? value : 'standard';
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = DNS_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (err) => { clearTimeout(timeout); reject(err); }
    );
  });
}

async function resolveDns(
  label: string,
  factory: () => Promise<unknown[]>,
  timeoutMs = DNS_TIMEOUT_MS,
): Promise<DnsQuery> {
  try {
    return { records: await withTimeout(factory(), label, timeoutMs), error: null };
  } catch (err) {
    const error = errorRecord(err);
    if (typeof error.code === 'string' && MISSING_DNS_CODES.has(error.code)) return { records: [], error: null };
    return { records: [], error: nonEmptyErrorMessage(err, String(err)) };
  }
}

function check(id: string, label: string, status: CheckStatus, summary: string, { detail = '', records = [], remediation = '' }: CheckOptions = {}): PostureCheck {
  return { id, label, status, summary, detail, records, remediation };
}

function queryFailureCheck(id: string, label: string, error: string): PostureCheck {
  return check(id, label, 'info', 'Check could not be completed', {
    detail: error,
    remediation: 'Retry the audit before changing DNS; a resolver failure is not evidence that the policy is absent.',
  });
}

function spfCheck(query: DnsQuery, expansion?: SpfExpansion): PostureCheck {
  if (query.error) return queryFailureCheck('spf', 'SPF', query.error);
  const parsed = parseSpfRecords(query.records);
  if (parsed.records.length === 0) {
    return check('spf', 'SPF', 'warning', 'No SPF policy published', {
      remediation: 'Publish one SPF TXT record that authorises every legitimate sender and ends in -all once verified.',
    });
  }
  if (!parsed.valid) {
    return check('spf', 'SPF', 'danger', 'SPF policy is invalid', {
      detail: parsed.issues.join(' '), records: parsed.records,
      remediation: 'Consolidate the policy into exactly one v=spf1 TXT record and validate its syntax.',
    });
  }

  const expansionDetails = expansion
    ? [
        `Expanded policy: ${expansion.state}.`,
        `Policy queries: ${expansion.lookupsUsed}/${expansion.lookupLimit}.`,
        `DNS-querying terms observed: ${expansion.dnsLookupTerms}.`,
        `Void answers: ${expansion.voidLookups}/${expansion.voidLookupLimit}.`,
        ...expansion.issues,
      ]
    : [];
  const details = [
    `Terminal policy: ${parsed.terminalPolicy}.`,
    `Top-level DNS-querying terms: ${parsed.dnsLookupTerms}.`,
    ...expansionDetails,
    ...parsed.issues,
  ];
  if (parsed.terminalPolicy === 'pass') {
    return check('spf', 'SPF', 'danger', 'Policy authorises every sender (+all)', {
      detail: details.join(' '), records: parsed.records,
      remediation: 'Replace +all with an explicit sender allowlist and a restrictive terminal policy.',
    });
  }
  if (parsed.terminalPolicy === 'fail' && parsed.issues.length === 0 && (!expansion || expansion.state === 'complete')) {
    return check('spf', 'SPF', 'pass', 'Restrictive fail-all policy', { detail: details.join(' '), records: parsed.records });
  }
  if (expansion && expansion.state !== 'complete') {
    return check('spf', 'SPF', expansion.state === 'invalid' ? 'danger' : 'warning', 'SPF expansion is incomplete', {
      detail: details.join(' '),
      records: parsed.records,
      remediation: 'Review unresolved, invalid, cyclic, or budget-limited include and redirect branches before treating the policy as complete.',
    });
  }
  if (parsed.terminalPolicy === 'redirect') {
    return check('spf', 'SPF', 'info', 'Policy delegates evaluation with redirect', {
      detail: details.join(' '), records: parsed.records,
      remediation: 'Confirm the redirect target exists, remains under trusted control, and resolves within SPF lookup limits.',
    });
  }
  return check('spf', 'SPF', 'warning', `Policy ends in ${parsed.terminalPolicy || 'an unknown result'}`, {
    detail: details.join(' '), records: parsed.records,
    remediation: parsed.terminalPolicy === 'softfail'
      ? 'Move from ~all to -all after confirming every legitimate sending service is authorised.'
      : 'Add a restrictive -all terminal policy after confirming every legitimate sending service.',
  });
}

function dmarcCheck(query: DnsQuery, authorizations: DmarcExternalAuthorization[] = []): PostureCheck {
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
  const external = authorizations.filter((authorization) => authorization.state !== 'self');
  const unresolvedExternal = external.filter((authorization) => authorization.state !== 'authorized');
  if (external.length > 0) {
    details.push(
      `${external.length} external reporting destination${external.length === 1 ? '' : 's'} checked; `
      + `${unresolvedExternal.length} could not be authorized.`,
    );
  }
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
  if (unresolvedExternal.length > 0) {
    return check('dmarc', 'DMARC', 'warning', `Enforced at p=${parsed.policy}; external reporting authorization is incomplete`, {
      detail: `${details.join(' ')} ${unresolvedExternal.map((authorization) => `${authorization.destination}: ${authorization.state}.`).join(' ')}`,
      records: parsed.records,
      remediation: 'Publish the required external reporting authorisation record or remove the unavailable destination.',
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

function mxCheck(query: DnsQuery): PostureCheck {
  if (query.error) return queryFailureCheck('mx', 'Mail exchange', query.error);
  const mxRecords = asMxRecords(query.records);
  const classified = classifyMxRecords(mxRecords);
  const records = mxRecords.map((record) => `${record.priority} ${record.exchange || '.'}`);
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

function dnssecCheck(input: DnssecQuery): PostureCheck {
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

function dnssecDelegationConsistencyCheck(
  input: DnssecQuery,
  registry: RegistryPostureEvidence,
): PostureCheck {
  if (registry.error) {
    return check('dnssec_delegation_consistency', 'DNSSEC delegation consistency', 'info', 'Registry evidence is unavailable', {
      detail: 'DNSSEC delegation and retained DS records could not be compared because normalised registry evidence was unavailable.',
    });
  }
  if (input.error) {
    return check('dnssec_delegation_consistency', 'DNSSEC delegation consistency', 'info', 'DNSSEC state is unavailable', {
      detail: 'The registry DNSSEC state and retained DS record count could not be compared.',
    });
  }

  const value = String(input.value || '').toLowerCase();
  const hasDsRecords = registry.dsRecordCount > 0;
  if (value === 'signed' && hasDsRecords) {
    return check('dnssec_delegation_consistency', 'DNSSEC delegation consistency', 'pass', 'Signed state and retained DS records agree', {
      detail: `${registry.dsRecordCount} registry DS record${registry.dsRecordCount === 1 ? '' : 's'} retained.`,
    });
  }
  if (value === 'unsigned' && !hasDsRecords) {
    return check('dnssec_delegation_consistency', 'DNSSEC delegation consistency', 'pass', 'Unsigned state and no retained DS records agree', {
      detail: 'This is a consistency result, not a recommendation to leave DNSSEC disabled.',
    });
  }
  if (registry.dsDataTruncated) {
    return check('dnssec_delegation_consistency', 'DNSSEC delegation consistency', 'info', 'Retained DS evidence is incomplete', {
      detail: 'The normalised registry response reported truncated DS data, so apparent disagreement is inconclusive.',
    });
  }
  if (value === 'signed' && !hasDsRecords) {
    return check('dnssec_delegation_consistency', 'DNSSEC delegation consistency', 'warning', 'Signed state reported without retained DS records', {
      detail: 'This can reflect registry publication differences or incomplete upstream data and should be reviewed before changing delegation.',
      remediation: 'Confirm the intended DS publication with the registrar, registry, and authoritative DNS provider.',
    });
  }
  if (value === 'unsigned' && hasDsRecords) {
    return check('dnssec_delegation_consistency', 'DNSSEC delegation consistency', 'warning', 'Retained DS records conflict with the unsigned state', {
      detail: `${registry.dsRecordCount} registry DS record${registry.dsRecordCount === 1 ? '' : 's'} retained. The difference can be transient or source-limited.`,
      remediation: 'Confirm the live delegation and DS publication before changing DNSSEC configuration.',
    });
  }
  return check('dnssec_delegation_consistency', 'DNSSEC delegation consistency', 'info', 'DNSSEC consistency is inconclusive', {
    detail: `${registry.dsRecordCount} registry DS record${registry.dsRecordCount === 1 ? '' : 's'} retained, but the registry DNSSEC state was not conclusive.`,
  });
}

function caaDisplay(record: Record<string, unknown>): string {
  const property = ['issue', 'issuewild', 'iodef', 'contactemail', 'contactphone'].find((key) => record[key] !== undefined);
  return property ? `${record.critical || 0} ${property} "${record[property]}"` : JSON.stringify(record);
}

function caaCheck(query: DnsQuery): PostureCheck {
  if (query.error) return queryFailureCheck('caa', 'CAA', query.error);
  const records = query.records.map((record) => caaDisplay(record as Record<string, unknown>));
  if (records.length > 0) return check('caa', 'CAA', 'pass', `${records.length} certificate-authority rule${records.length === 1 ? '' : 's'} published`, { records });
  return check('caa', 'CAA', 'warning', 'No CAA policy published', {
    detail: 'No CAA record was returned for this exact name; a subdomain can still inherit policy from a parent name.',
    remediation: 'Publish CAA issue/issuewild records to restrict which certificate authorities may issue for the domain.',
  });
}

function matchesMtaPattern(host: unknown, pattern: unknown): boolean {
  const normalizedHost = String(host || '').toLowerCase().replace(/\.+$/, '');
  const normalizedPattern = String(pattern || '').toLowerCase().replace(/\.+$/, '');
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(1);
    return normalizedHost.endsWith(suffix) && normalizedHost.length > suffix.length;
  }
  return normalizedHost === normalizedPattern;
}

function mtaStsCheck(dnsQuery: DnsQuery, policyFetch: MtaStsPolicyFetch | null, mxQuery: DnsQuery): PostureCheck {
  if (dnsQuery.error) return queryFailureCheck('mta_sts', 'MTA-STS', dnsQuery.error);
  const dnsPolicy = parseMtaStsDnsRecords(dnsQuery.records);
  const hasMx = !mxQuery.error && classifyMxRecords(asMxRecords(mxQuery.records)).hasMx;
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

  const mxHosts = mxQuery.error ? [] : classifyMxRecords(asMxRecords(mxQuery.records)).mxHosts;
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

function tlsRptCheck(query: DnsQuery, mxQuery: DnsQuery): PostureCheck {
  if (query.error) return queryFailureCheck('tls_rpt', 'TLS-RPT', query.error);
  const parsed = parseTlsRptRecords(query.records);
  if (parsed.records.length === 0) {
    const hasMx = !mxQuery.error && classifyMxRecords(asMxRecords(mxQuery.records)).hasMx;
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

function bimiCheck(query: DnsQuery, dmarcQuery: DnsQuery): PostureCheck {
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
      detail: 'BIMI display generally requires enforced DMARC for the organisational domain and subdomains. Mailbox providers apply additional requirements.',
      records: parsed.records,
      remediation: 'Enforce DMARC at quarantine or reject for the domain and subdomains before relying on BIMI.',
    });
  }
  return check('bimi', 'BIMI', 'pass', parsed.authority ? 'Logo and authority evidence published' : 'Logo published; provider-specific evidence may still be required', {
    detail: 'Mailbox providers decide independently whether to display a logo.', records: parsed.records,
  });
}

function dkimCheck(selectorQueries: DkimQuery[]): PostureCheck {
  selectorQueries = selectorQueries.filter((query) => query.retired !== true);
  if (selectorQueries.length === 0) {
    return check('dkim', 'DKIM', 'info', 'Not checked: no selectors configured', {
      detail: 'DKIM selectors cannot be discovered reliably from DNS; configure the selectors used by each legitimate sending platform in the Brand Profile.',
    });
  }

  const results = selectorQueries.map(({ selector, records, error }) => error
    ? {
        selector,
        valid: false,
        records: [],
        keyType: null,
        keyBits: null,
        keyParseState: 'not_checked' as const,
        revoked: false,
        testing: false,
        issues: [error],
      }
    : parseDkimRecords(selector, records));
  const valid = results.filter((result) => result.valid);
  const records = results.flatMap((result) => result.records.map((record) => `${result.selector}: ${record}`));
  if (valid.length === results.length) {
    const testing = results.filter((result) => result.testing).map((result) => result.selector);
    const weakRsa = results.filter((result) => result.keyType === 'rsa' && result.keyBits !== null && result.keyBits < 2048);
    const unknownStrength = results.filter((result) => result.keyBits === null);
    const needsReview = testing.length > 0 || weakRsa.length > 0 || unknownStrength.length > 0;
    const detail = [
      testing.length ? `Testing flag is enabled for: ${testing.join(', ')}.` : '',
      weakRsa.length ? `RSA keys below 2048 bits: ${weakRsa.map((result) => `${result.selector} (${result.keyBits} bits)`).join(', ')}.` : '',
      unknownStrength.length ? `Key strength could not be determined for: ${unknownStrength.map((result) => result.selector).join(', ')}.` : '',
      ...results.filter((result) => result.keyBits !== null).map((result) => `${result.selector}: ${result.keyType} ${result.keyBits}-bit key.`),
    ].filter(Boolean).join(' ');
    return check('dkim', 'DKIM', needsReview ? 'warning' : 'pass', `${valid.length} configured selector${valid.length === 1 ? '' : 's'} publish valid keys`, {
      detail, records,
      remediation: testing.length
        ? 'Remove the DKIM t=y testing flag after validation.'
        : weakRsa.length
          ? 'Rotate RSA DKIM keys below 2048 bits and verify the replacement selector before retirement.'
          : unknownStrength.length
            ? 'Confirm the published public key can be parsed and meets the sending platform policy.'
            : '',
    });
  }
  const failed = results.filter((result) => !result.valid);
  return check('dkim', 'DKIM', 'warning', `${failed.length} configured selector${failed.length === 1 ? '' : 's'} could not be validated`, {
    detail: failed.map((result) => `${result.selector}: ${result.issues.join(' ')}`).join(' '), records,
    remediation: 'Confirm each selector is current, publish its public key, or remove retired selectors from the Brand Profile.',
  });
}

function retiredDkimCheck(selectorQueries: DkimQuery[]): PostureCheck | null {
  const retired = selectorQueries.filter((query) => query.retired === true);
  if (retired.length === 0) return null;
  const unavailable = retired.filter((query) => Boolean(query.error));
  const published = retired.filter((query) => !query.error && query.records.length > 0);
  const records = published.flatMap((query) => query.records.map((record) => `${query.selector}: ${String(Array.isArray(record) ? record.join('') : record || '')}`));
  if (unavailable.length > 0) {
    return check('dkim_retired', 'Retired DKIM selectors', 'info', 'Retired-selector review is incomplete', {
      detail: unavailable.map((query) => `${query.selector}: ${query.error}`).join(' '),
      records,
      remediation: 'Retry before concluding that retired keys are no longer published.',
    });
  }
  if (published.length > 0) {
    return check('dkim_retired', 'Retired DKIM selectors', 'warning', `${published.length} retired selector${published.length === 1 ? '' : 's'} remain published`, {
      detail: 'Continued publication is not proof that a key is still used, but it should be confirmed with the sending platform.',
      records,
      remediation: 'Confirm mail has moved to the active selector, then remove obsolete public keys according to the provider rotation plan.',
    });
  }
  return check('dkim_retired', 'Retired DKIM selectors', 'pass', `${retired.length} retired selector${retired.length === 1 ? '' : 's'} are no longer published`);
}

function defensiveMailProfileCheck(profile: MailProtectionProfile, input: PostureInput): PostureCheck | null {
  if (profile === 'standard') return null;
  const spf = input.spf.error ? null : parseSpfRecords(input.spf.records);
  const dmarc = input.dmarc.error ? null : parseDmarcRecords(input.dmarc.records);
  const mx = input.mx.error ? null : classifyMxRecords(asMxRecords(input.mx.records));
  const requirements = {
    nullMx: mx?.hasNullMx === true,
    restrictiveSpf: spf?.valid === true && spf.terminalPolicy === 'fail' && spf.dnsLookupTerms === 0,
    rejectingDmarc: dmarc?.valid === true
      && dmarc.policy === 'reject'
      && dmarc.subdomainPolicy === 'reject'
      && dmarc.nonexistentSubdomainPolicy === 'reject'
      && !dmarc.testMode,
  };
  const unavailable = Boolean(input.spf.error || input.dmarc.error || input.mx.error);
  const passed = Object.values(requirements).filter(Boolean).length;
  return check('defensive_mail_profile', profile === 'parked' ? 'Parked-domain mail posture' : 'Defensive no-mail posture', unavailable
    ? 'info'
    : passed === 3
      ? 'pass'
      : 'warning', unavailable
    ? 'The defensive mail profile could not be fully evaluated'
    : passed === 3
      ? 'Null MX, restrictive SPF, and rejecting DMARC are observed'
      : `${passed}/3 defensive mail controls are observed`, {
    detail: `Null MX: ${requirements.nullMx ? 'observed' : 'not observed'}. Restrictive SPF without sender dependencies: ${requirements.restrictiveSpf ? 'observed' : 'not observed'}. Rejecting DMARC for domain and subdomains: ${requirements.rejectingDmarc ? 'observed' : 'not observed'}.`,
    remediation: unavailable || passed === 3
      ? ''
      : 'For a domain that should not send or receive mail, review null MX, v=spf1 -all, and enforced DMARC reject policy.',
  });
}

function registrationLockCheck(registry: RegistryPostureEvidence): PostureCheck {
  if (registry.error) return queryFailureCheck('registration_lock', 'Registration controls', registry.error);
  const statuses = registry.statuses.map((status) => status.toLowerCase().replace(/[^a-z]/gu, ''));
  if (statuses.length === 0) {
    return check('registration_lock', 'Registration controls', 'info', 'Registry lock state is unavailable', {
      detail: 'No normalised EPP status was returned. This does not describe registrar account security.',
    });
  }
  const transferLocks = statuses.filter((status) => ['clienttransferprohibited', 'servertransferprohibited'].includes(status));
  const changeLocks = statuses.filter((status) => [
    'clientupdateprohibited',
    'serverupdateprohibited',
    'clientdeleteprohibited',
    'serverdeleteprohibited',
  ].includes(status));
  if (transferLocks.length === 0) {
    return check('registration_lock', 'Registration controls', 'warning', 'No transfer restriction observed in registry status', {
      detail: 'EPP status is point-in-time registry evidence and does not reveal registrar MFA, registry-lock enrolment, account recovery controls, or every registrar-side lock.',
      records: registry.statuses,
      remediation: 'Confirm the registrar transfer lock, MFA, recovery controls, and registry-lock options directly with the account owner.',
    });
  }
  return check('registration_lock', 'Registration controls', 'pass', 'Transfer restriction observed in registry status', {
    detail: `${changeLocks.length} update or delete restriction${changeLocks.length === 1 ? '' : 's'} also observed. EPP status does not prove registrar account security.`,
    records: registry.statuses,
  });
}

function nameserverCheck(query: DnsQuery, registry: RegistryPostureEvidence): PostureCheck {
  if (query.error) return queryFailureCheck('nameservers', 'Nameserver delegation', query.error);
  const records = query.records.map((record) => String(record || '').toLowerCase().replace(/\.+$/u, '')).filter(Boolean);
  if (records.length === 0) {
    return check('nameservers', 'Nameserver delegation', 'warning', 'No nameserver delegation returned', {
      detail: 'A missing answer may reflect resolver or publication state and is not proof that a provider account or zone is absent.',
      remediation: 'Confirm delegation at the registry and DNS provider before making a change.',
    });
  }
  const registryNameservers = new Set(registry.nameservers.map((value) => value.toLowerCase().replace(/\.+$/u, '')));
  const differs = registryNameservers.size > 0
    && (records.some((record) => !registryNameservers.has(record)) || registryNameservers.size !== records.length);
  return check('nameservers', 'Nameserver delegation', differs ? 'warning' : 'pass', differs
    ? 'DNS and registry nameserver sets differ'
    : `${records.length} nameserver${records.length === 1 ? '' : 's'} observed`, {
    detail: `${registry.dsRecordCount} registry DS record${registry.dsRecordCount === 1 ? '' : 's'} observed.`
      + (differs ? ' The difference may be transient or publication-limited and should be reviewed before changing delegation.' : ''),
    records,
    remediation: differs ? 'Verify the intended delegation with both the registry and authoritative DNS provider.' : '',
  });
}

function buildPostureReport(domain: string, input: PostureInput) {
  const retiredDkim = retiredDkimCheck(input.dkim);
  const defensiveMail = defensiveMailProfileCheck(input.mailProtectionProfile || 'standard', input);
  const checks = [
    spfCheck(input.spf, input.spfExpansion),
    dmarcCheck(input.dmarc, input.dmarcAuthorizations),
    mxCheck(input.mx),
    dnssecCheck(input.dnssec),
    ...(input.registry ? [dnssecDelegationConsistencyCheck(input.dnssec, input.registry)] : []),
    caaCheck(input.caa),
    mtaStsCheck(input.mtaStsDns, input.mtaStsPolicy, input.mx),
    tlsRptCheck(input.tlsRpt, input.mx),
    bimiCheck(input.bimi, input.dmarc),
    dkimCheck(input.dkim),
    ...(retiredDkim ? [retiredDkim] : []),
    ...(defensiveMail ? [defensiveMail] : []),
    ...(input.registry ? [registrationLockCheck(input.registry)] : []),
    ...(input.registry && input.nameservers ? [nameserverCheck(input.nameservers, input.registry)] : []),
  ];
  const summary = { pass: 0, warning: 0, danger: 0, info: 0 };
  for (const item of checks) summary[item.status] += 1;
  return { domain, summary, checks };
}

async function fetchMtaStsPolicy(domain: string): Promise<MtaStsPolicyFetch> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POLICY_TIMEOUT_MS);
  try {
    const url = `https://mta-sts.${domain}/.well-known/mta-sts.txt`;
    const res = await safeFetch(url, {
      signal: controller.signal,
      headers: whoisleuthRequestHeaders({ Accept: 'text/plain' }),
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
    return {
      text: '',
      contentType: null,
      error: errorRecord(err).name === 'AbortError'
        ? 'Policy fetch timed out.'
        : nonEmptyErrorMessage(err, String(err)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkDomainPosture(
  domain: string,
  {
    dkimSelectors = [],
    retiredDkimSelectors = [],
    mailProtectionProfile = 'standard',
  }: {
    dkimSelectors?: unknown[];
    retiredDkimSelectors?: unknown[];
    mailProtectionProfile?: unknown;
  } = {},
) {
  const normalizedDomain = normalizeAuditDomain(domain);
  if (!normalizedDomain) throw new Error('Invalid domain name for posture audit.');
  domain = normalizedDomain;
  const selectors = normalizeDkimSelectors(dkimSelectors);
  const retiredSelectors = normalizeDkimSelectors(retiredDkimSelectors)
    .filter((selector) => !selectors.includes(selector))
    .slice(0, Math.max(0, MAX_DKIM_SELECTORS - selectors.length));
  const normalizedMailProfile = normalizeMailProtectionProfile(mailProtectionProfile);
  const [spf, dmarc, mx, nameservers, caa, mtaStsDns, tlsRpt, bimi, dkim, rdap] = await Promise.all([
    resolveDns(`TXT ${domain}`, () => dns.resolveTxt(domain)),
    resolveDns(`TXT _dmarc.${domain}`, () => dns.resolveTxt(`_dmarc.${domain}`)),
    resolveDns(`MX ${domain}`, () => dns.resolveMx(domain)),
    resolveDns(`NS ${domain}`, () => dns.resolveNs(domain)),
    resolveDns(`CAA ${domain}`, () => dns.resolveCaa(domain)),
    resolveDns(`TXT _mta-sts.${domain}`, () => dns.resolveTxt(`_mta-sts.${domain}`)),
    resolveDns(`TXT _smtp._tls.${domain}`, () => dns.resolveTxt(`_smtp._tls.${domain}`)),
    resolveDns(`TXT default._bimi.${domain}`, () => dns.resolveTxt(`default._bimi.${domain}`)),
    Promise.all([
      ...selectors.map(async (selector) => ({
        selector,
        retired: false,
        ...await resolveDns(`TXT ${selector}._domainkey.${domain}`, () => dns.resolveTxt(`${selector}._domainkey.${domain}`)),
      })),
      ...retiredSelectors.map(async (selector) => ({
        selector,
        retired: true,
        ...await resolveDns(`TXT ${selector}._domainkey.${domain}`, () => dns.resolveTxt(`${selector}._domainkey.${domain}`)),
      })),
    ]),
    fetchRdapRecord('domain', domain).catch((err: unknown) => ({
      error: nonEmptyErrorMessage(err, String(err)),
    })),
  ]);

  const parsedMtaDns = mtaStsDns.error ? null : parseMtaStsDnsRecords(mtaStsDns.records);
  const enrichmentDeadline = Date.now() + POSTURE_ENRICHMENT_DEADLINE_MS;
  const resolveEnrichmentTxt = (name: string) => {
    const remaining = Math.max(1, enrichmentDeadline - Date.now());
    if (remaining <= 1) return Promise.resolve({ records: [], error: 'The bounded posture-enrichment deadline was reached.' });
    return resolveDns(`TXT ${name}`, () => dns.resolveTxt(name), Math.min(DNS_TIMEOUT_MS, remaining));
  };
  const [mtaStsPolicy, spfExpansion, dmarcAuthorizations] = await Promise.all([
    parsedMtaDns?.valid ? fetchMtaStsPolicy(domain) : Promise.resolve(null),
    expandSpfPolicy(domain, spf, resolveEnrichmentTxt),
    validateDmarcExternalReporting(domain, dmarc, resolveEnrichmentTxt),
  ]);
  const dnssec = !rdap
    ? { value: null, error: 'RDAP did not return a domain record.' }
    : 'error' in rdap
      ? { value: null, error: rdap.error }
    : {
        value: rdap.parsed && 'dnssec' in rdap.parsed ? rdap.parsed.dnssec : null,
        error: null,
      };
  const parsedDomain = rdap && !('error' in rdap) ? rdap.parsed : null;
  const registry: RegistryPostureEvidence = parsedDomain
    ? {
        statuses: parsedDomain.statuses,
        nameservers: parsedDomain.nameservers,
        dsRecordCount: parsedDomain.dsData.length,
        dsDataTruncated: parsedDomain.dsDataTruncated,
        error: null,
      }
    : {
        statuses: [],
        nameservers: [],
        dsRecordCount: 0,
        dsDataTruncated: false,
        error: rdap && 'error' in rdap ? rdap.error : 'RDAP did not return normalised domain evidence.',
      };
  const externalDependencies: ExternalDependency[] = buildExternalDependencies({
    domain,
    nameservers,
    mx,
    spfExpansion,
    dmarcAuthorizations,
  });
  const report = buildPostureReport(domain, {
    spf,
    dmarc,
    mx,
    nameservers,
    caa,
    mtaStsDns,
    mtaStsPolicy,
    tlsRpt,
    bimi,
    dkim,
    dnssec,
    registry,
    spfExpansion,
    dmarcAuthorizations,
    mailProtectionProfile: normalizedMailProfile,
  });
  return {
    ...report,
    checkedAt: new Date().toISOString(),
    dkimSelectors: selectors,
    retiredDkimSelectors: retiredSelectors,
    mailProtectionProfile: normalizedMailProfile,
    spfExpansion,
    dmarcAuthorizations,
    externalDependencies,
  };
}

export {
  normalizeAuditDomain,
  normalizeDkimSelectors,
  normalizeMailProtectionProfile,
  matchesMtaPattern,
  buildPostureReport,
  checkDomainPosture,
};
