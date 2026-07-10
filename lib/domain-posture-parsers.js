// Pure parsers for the DNS policies used by the owned-domain posture audit.
// Kept separate from DNS/network I/O so policy edge cases can be tested with
// synthetic records and the Express/Netlify paths share identical behavior.

function joinTxtRecords(records) {
  if (!Array.isArray(records)) return [];
  return records
    .map((record) => Array.isArray(record) ? record.join('') : String(record || ''))
    .map((record) => record.trim())
    .filter(Boolean);
}

function parseTagList(record) {
  /** @type {Record<string, string>} */
  const tags = {};
  /** @type {string[]} */
  const duplicates = [];
  /** @type {string[]} */
  const malformed = [];

  for (const part of String(record || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) {
      malformed.push(trimmed);
      continue;
    }
    const key = trimmed.slice(0, equals).trim().toLowerCase();
    const value = trimmed.slice(equals + 1).trim();
    if (!/^[a-z][a-z0-9_.-]*$/i.test(key)) {
      malformed.push(trimmed);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(tags, key)) duplicates.push(key);
    else tags[key] = value;
  }

  return { tags, duplicates, malformed };
}

function parseSpfRecords(records) {
  const allRecords = joinTxtRecords(records);
  const spfRecords = allRecords.filter((record) => /^v=spf1(?:\s|$)/i.test(record));
  /** @type {{ records: string[], valid: boolean, record: string | null, terminalPolicy: string | null, redirect: string | null, dnsLookupTerms: number, issues: string[] }} */
  const result = {
    records: spfRecords,
    valid: false,
    record: spfRecords[0] || null,
    terminalPolicy: null,
    redirect: null,
    dnsLookupTerms: 0,
    issues: [],
  };

  if (spfRecords.length === 0) {
    result.issues.push('No SPF record was found.');
    return result;
  }
  if (spfRecords.length > 1) {
    result.issues.push('Multiple SPF records produce a permanent SPF error.');
    return result;
  }

  const terms = spfRecords[0].split(/\s+/).slice(1).filter(Boolean);
  const allIndex = terms.findIndex((term) => /^[+?~-]?all$/i.test(term));
  const allTerm = allIndex === -1 ? null : terms[allIndex];
  const redirectTerm = terms.find((term) => /^redirect=/i.test(term));
  const lookupTermRe = /^[+?~-]?(?:include:|a(?::|\/|$)|mx(?::|\/|$)|ptr(?::|$)|exists:)/i;
  result.dnsLookupTerms = terms.filter((term) => lookupTermRe.test(term)).length + (redirectTerm ? 1 : 0);
  result.redirect = redirectTerm ? redirectTerm.slice(redirectTerm.indexOf('=') + 1) : null;

  if (terms.some((term) => /^[+?~-]?ptr(?::|$)/i.test(term))) {
    result.issues.push('The deprecated ptr mechanism should not be used.');
  }
  if (result.dnsLookupTerms > 10) {
    result.issues.push('The record has more than 10 top-level DNS-querying terms.');
  }
  if (allTerm) {
    const qualifier = /^[?~-]/.test(allTerm) ? allTerm[0] : '+';
    result.terminalPolicy = { '-': 'fail', '~': 'softfail', '?': 'neutral', '+': 'pass' }[qualifier];
    if (allIndex !== terms.length - 1) result.issues.push('Terms after the all mechanism are unreachable.');
  } else if (result.redirect) {
    result.terminalPolicy = 'redirect';
  } else {
    result.terminalPolicy = 'none';
    result.issues.push('No all mechanism or redirect modifier defines a terminal policy.');
  }

  result.valid = true;
  return result;
}

function parseDmarcRecords(records) {
  const allRecords = joinTxtRecords(records);
  const dmarcRecords = allRecords.filter((record) => /^v\s*=\s*dmarc1(?:\s*;|$)/i.test(record));
  /** @type {{ records: string[], valid: boolean, record: string | null, tags: Record<string, string>, policy: string | null, subdomainPolicy: string | null, nonexistentSubdomainPolicy: string | null, testMode: boolean, enforced: boolean, aggregateReporting: boolean, failureReporting: boolean, legacyPct: number | null, issues: string[] }} */
  const result = {
    records: dmarcRecords,
    valid: false,
    record: dmarcRecords[0] || null,
    tags: {},
    policy: null,
    subdomainPolicy: null,
    nonexistentSubdomainPolicy: null,
    testMode: false,
    enforced: false,
    aggregateReporting: false,
    failureReporting: false,
    legacyPct: null,
    issues: [],
  };

  if (dmarcRecords.length === 0) {
    result.issues.push('No DMARC policy record was found.');
    return result;
  }
  if (dmarcRecords.length > 1) {
    result.issues.push('Multiple DMARC policy records make policy discovery fail.');
    return result;
  }

  const parsed = parseTagList(dmarcRecords[0]);
  result.tags = parsed.tags;
  if (parsed.duplicates.length) result.issues.push(`Duplicate DMARC tag${parsed.duplicates.length === 1 ? '' : 's'}: ${parsed.duplicates.join(', ')}.`);
  if (parsed.malformed.length) result.issues.push(`Malformed DMARC field${parsed.malformed.length === 1 ? '' : 's'}: ${parsed.malformed.join(', ')}.`);

  const allowedPolicies = new Set(['none', 'quarantine', 'reject']);
  const policy = (parsed.tags.p || 'none').toLowerCase();
  const subdomainPolicy = (parsed.tags.sp || policy).toLowerCase();
  const nonexistentPolicy = (parsed.tags.np || parsed.tags.sp || policy).toLowerCase();
  if (!allowedPolicies.has(policy)) result.issues.push(`Unsupported DMARC p value: ${parsed.tags.p}.`);
  if (!allowedPolicies.has(subdomainPolicy)) result.issues.push(`Unsupported DMARC sp value: ${parsed.tags.sp}.`);
  if (!allowedPolicies.has(nonexistentPolicy)) result.issues.push(`Unsupported DMARC np value: ${parsed.tags.np}.`);
  if (parsed.tags.t && !/^[yn]$/i.test(parsed.tags.t)) result.issues.push(`Unsupported DMARC t value: ${parsed.tags.t}.`);

  if (parsed.tags.pct !== undefined) {
    const pct = Number(parsed.tags.pct);
    result.legacyPct = Number.isInteger(pct) && pct >= 0 && pct <= 100 ? pct : null;
    result.issues.push('The legacy pct tag is historic in the current DMARC specification.');
  }

  result.policy = allowedPolicies.has(policy) ? policy : null;
  result.subdomainPolicy = allowedPolicies.has(subdomainPolicy) ? subdomainPolicy : null;
  result.nonexistentSubdomainPolicy = allowedPolicies.has(nonexistentPolicy) ? nonexistentPolicy : null;
  result.testMode = /^y$/i.test(parsed.tags.t || 'n');
  result.enforced = Boolean(result.policy && result.policy !== 'none' && !result.testMode);
  result.aggregateReporting = Boolean(parsed.tags.rua);
  result.failureReporting = Boolean(parsed.tags.ruf);
  result.valid = parsed.duplicates.length === 0
    && parsed.malformed.length === 0
    && Boolean(result.policy && result.subdomainPolicy && result.nonexistentSubdomainPolicy)
    && (!parsed.tags.t || /^[yn]$/i.test(parsed.tags.t));
  return result;
}

function parseMtaStsDnsRecords(records) {
  const allRecords = joinTxtRecords(records);
  const policyRecords = allRecords.filter((record) => /^v\s*=\s*stsv1(?:\s*;|$)/i.test(record));
  /** @type {{ records: string[], valid: boolean, record: string | null, id: string | null, issues: string[] }} */
  const result = { records: policyRecords, valid: false, record: policyRecords[0] || null, id: null, issues: [] };
  if (policyRecords.length === 0) {
    result.issues.push('No MTA-STS DNS record was found.');
    return result;
  }
  if (policyRecords.length > 1) {
    result.issues.push('Multiple MTA-STS DNS records make the policy invalid.');
    return result;
  }
  const parsed = parseTagList(policyRecords[0]);
  result.id = parsed.tags.id || null;
  if (!result.id) result.issues.push('The MTA-STS DNS record has no policy id.');
  if (parsed.duplicates.length) result.issues.push(`Duplicate MTA-STS tag${parsed.duplicates.length === 1 ? '' : 's'}: ${parsed.duplicates.join(', ')}.`);
  if (parsed.malformed.length) result.issues.push(`Malformed MTA-STS field${parsed.malformed.length === 1 ? '' : 's'}: ${parsed.malformed.join(', ')}.`);
  result.valid = Boolean(result.id) && parsed.duplicates.length === 0 && parsed.malformed.length === 0;
  return result;
}

function parseMtaStsPolicy(text) {
  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {string[]} */
  const mx = [];
  /** @type {string[]} */
  const duplicates = [];
  /** @type {string[]} */
  const malformed = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) {
      malformed.push(trimmed);
      continue;
    }
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (key === 'mx') mx.push(value.toLowerCase().replace(/\.+$/, ''));
    else if (Object.prototype.hasOwnProperty.call(fields, key)) duplicates.push(key);
    else fields[key] = value;
  }

  const mode = (fields.mode || '').toLowerCase();
  const maxAge = /^\d+$/.test(fields.max_age || '') ? Number(fields.max_age) : null;
  const issues = [];
  if (fields.version !== 'STSv1') issues.push('The policy version must be STSv1.');
  if (!['enforce', 'testing', 'none'].includes(mode)) issues.push('The policy mode must be enforce, testing, or none.');
  if (maxAge === null || !Number.isSafeInteger(maxAge)) issues.push('The policy max_age must be a non-negative integer.');
  if (mode !== 'none' && mx.length === 0) issues.push('An enforcing or testing policy needs at least one mx pattern.');
  if (duplicates.length) issues.push(`Duplicate MTA-STS policy field${duplicates.length === 1 ? '' : 's'}: ${duplicates.join(', ')}.`);
  if (malformed.length) issues.push(`Malformed MTA-STS policy line${malformed.length === 1 ? '' : 's'}: ${malformed.join(', ')}.`);

  return {
    valid: issues.length === 0,
    version: fields.version || null,
    mode: mode || null,
    maxAge,
    mx,
    issues,
  };
}

function parseTlsRptRecords(records) {
  const allRecords = joinTxtRecords(records);
  const policyRecords = allRecords.filter((record) => /^v\s*=\s*tlsrptv1(?:\s*;|$)/i.test(record));
  /** @type {{ records: string[], valid: boolean, record: string | null, rua: string[], issues: string[] }} */
  const result = { records: policyRecords, valid: false, record: policyRecords[0] || null, rua: [], issues: [] };
  if (policyRecords.length === 0) {
    result.issues.push('No TLS-RPT policy record was found.');
    return result;
  }
  if (policyRecords.length > 1) {
    result.issues.push('Multiple TLS-RPT policy records make reporting invalid.');
    return result;
  }
  const parsed = parseTagList(policyRecords[0]);
  result.rua = (parsed.tags.rua || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (result.rua.length === 0) result.issues.push('The TLS-RPT record has no aggregate report destination.');
  if (parsed.duplicates.length) result.issues.push(`Duplicate TLS-RPT tag${parsed.duplicates.length === 1 ? '' : 's'}: ${parsed.duplicates.join(', ')}.`);
  if (parsed.malformed.length) result.issues.push(`Malformed TLS-RPT field${parsed.malformed.length === 1 ? '' : 's'}: ${parsed.malformed.join(', ')}.`);
  result.valid = result.rua.length > 0 && parsed.duplicates.length === 0 && parsed.malformed.length === 0;
  return result;
}

function parseBimiRecords(records) {
  const allRecords = joinTxtRecords(records);
  const bimiRecords = allRecords.filter((record) => /^v\s*=\s*bimi1(?:\s*;|$)/i.test(record));
  /** @type {{ records: string[], valid: boolean, record: string | null, logo: string | null, authority: string | null, issues: string[] }} */
  const result = { records: bimiRecords, valid: false, record: bimiRecords[0] || null, logo: null, authority: null, issues: [] };
  if (bimiRecords.length === 0) {
    result.issues.push('No default-selector BIMI record was found.');
    return result;
  }
  if (bimiRecords.length > 1) {
    result.issues.push('Multiple BIMI records were found at the default selector.');
    return result;
  }
  const parsed = parseTagList(bimiRecords[0]);
  result.logo = parsed.tags.l || null;
  result.authority = parsed.tags.a || null;
  if (!result.logo) result.issues.push('The BIMI record has no logo location.');
  if (result.logo && !/^https:\/\//i.test(result.logo)) result.issues.push('The BIMI logo location must use HTTPS.');
  if (result.authority && !/^https:\/\//i.test(result.authority)) result.issues.push('The BIMI authority evidence location must use HTTPS.');
  if (parsed.duplicates.length) result.issues.push(`Duplicate BIMI tag${parsed.duplicates.length === 1 ? '' : 's'}: ${parsed.duplicates.join(', ')}.`);
  if (parsed.malformed.length) result.issues.push(`Malformed BIMI field${parsed.malformed.length === 1 ? '' : 's'}: ${parsed.malformed.join(', ')}.`);
  result.valid = result.issues.length === 0;
  return result;
}

function parseDkimRecords(selector, records) {
  const allRecords = joinTxtRecords(records);
  /** @type {{ selector: string, records: string[], valid: boolean, keyType: string | null, revoked: boolean, testing: boolean, issues: string[] }} */
  const result = {
    selector,
    records: allRecords,
    valid: false,
    keyType: null,
    revoked: false,
    testing: false,
    issues: [],
  };
  if (allRecords.length === 0) {
    result.issues.push(`No DKIM record was found for selector ${selector}.`);
    return result;
  }
  if (allRecords.length > 1) {
    result.issues.push(`Multiple TXT records were found for DKIM selector ${selector}.`);
    return result;
  }
  const parsed = parseTagList(allRecords[0]);
  const version = parsed.tags.v || 'DKIM1';
  result.keyType = (parsed.tags.k || 'rsa').toLowerCase();
  result.revoked = parsed.tags.p === '';
  result.testing = (parsed.tags.t || '').split(':').includes('y');
  if (version.toUpperCase() !== 'DKIM1') result.issues.push(`Unsupported DKIM version: ${version}.`);
  if (!Object.prototype.hasOwnProperty.call(parsed.tags, 'p')) result.issues.push('The DKIM record has no public-key p tag.');
  if (result.revoked) result.issues.push('The DKIM key is revoked (empty p tag).');
  if (parsed.duplicates.length) result.issues.push(`Duplicate DKIM tag${parsed.duplicates.length === 1 ? '' : 's'}: ${parsed.duplicates.join(', ')}.`);
  if (parsed.malformed.length) result.issues.push(`Malformed DKIM field${parsed.malformed.length === 1 ? '' : 's'}: ${parsed.malformed.join(', ')}.`);
  result.valid = result.issues.length === 0;
  return result;
}

module.exports = {
  joinTxtRecords,
  parseTagList,
  parseSpfRecords,
  parseDmarcRecords,
  parseMtaStsDnsRecords,
  parseMtaStsPolicy,
  parseTlsRptRecords,
  parseBimiRecords,
  parseDkimRecords,
};
