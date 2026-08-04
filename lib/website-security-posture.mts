// Versioned, bounded passive security-posture findings derived only from the
// HTTP, static page, TLS, and DNS evidence already collected by a deep Lookup.
// Findings use fixed explanatory text and bounded counts; upstream header
// values, certificate errors, URLs, and DNS record contents are not copied.

import { createObservation } from './observation.mts';

type UnknownRecord = Record<string, unknown>;
type PostureCategory = 'transport' | 'response headers' | 'forms and resources' | 'certificate' | 'domain controls';
type PostureState = 'observed' | 'potential_exposure' | 'observed_absence' | 'unavailable';
type PostureTone = 'configured' | 'review' | 'neutral';
type PostureFinding = {
  id: string;
  category: PostureCategory;
  state: PostureState;
  tone: PostureTone;
  label: string;
  detail: string;
  evidence: string[];
};
type WebsiteSecurityPostureInput = {
  http?: unknown;
  responsePolicy?: unknown;
  pageIdentity?: unknown;
  tls?: unknown;
  dns?: unknown;
  dnssec?: unknown;
  observedAt?: unknown;
};

const WEBSITE_SECURITY_POSTURE_VERSION = 2;
const MAX_SECURITY_POSTURE_FINDINGS = 32;
const MAX_RETAINED_ORIGINS = 30;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function statusAvailable(value: unknown, source: string): boolean {
  const item = record(value);
  return item.source === source && typeof item.status === 'string' && ['success', 'partial'].includes(item.status);
}

function present(value: unknown): boolean {
  return typeof value === 'string' && value.length <= 2048 && value.trim().length > 0;
}

function boundedCount(value: unknown, maximum: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? Math.min(number, maximum) : 0;
}

function finding(
  id: string,
  category: PostureCategory,
  state: PostureState,
  tone: PostureTone,
  label: string,
  detail: string,
  evidence: string[],
): PostureFinding {
  return { id, category, state, tone, label, detail, evidence };
}

function httpFindings(httpValue: unknown): PostureFinding[] {
  const http = record(httpValue);
  if (!statusAvailable(http, 'http') || !http.response || typeof http.response !== 'object') {
    return [finding(
      'http_response_unavailable', 'transport', 'unavailable', 'neutral', 'HTTP posture unavailable',
      'No selected HTTP response was available to evaluate transport or response-header posture.', ['HTTP collection'],
    )];
  }

  const response = record(http.response);
  const headers = record(response.securityHeaders);
  const transport = typeof http.transportSecurity === 'string' && http.transportSecurity.length <= 16
    ? http.transportSecurity.toLowerCase()
    : '';
  const findings: PostureFinding[] = [];

  if (transport === 'https') {
    findings.push(finding(
      'https_transport', 'transport', 'observed', 'configured', 'HTTPS transport observed',
      'The selected homepage response was reached over HTTPS.', ['HTTP response'],
    ));
  } else if (transport === 'http') {
    findings.push(finding(
      'cleartext_transport', 'transport', 'potential_exposure', 'review', 'Cleartext HTTP transport',
      'The selected homepage response used cleartext HTTP, so traffic did not receive HTTPS transport protection.', ['HTTP response'],
    ));
  } else {
    findings.push(finding(
      'http_transport_unavailable', 'transport', 'unavailable', 'neutral', 'HTTP transport unavailable',
      'The selected response did not provide a usable HTTP or HTTPS transport observation.', ['HTTP response'],
    ));
  }

  if (http.httpsDowngrade === true) {
    findings.push(finding(
      'https_downgrade', 'transport', 'potential_exposure', 'review', 'HTTPS downgrade observed',
      'The retained redirect chain moved from HTTPS to cleartext HTTP.', ['HTTP redirect chain'],
    ));
  }

  if (!Object.prototype.hasOwnProperty.call(response, 'securityHeaders')
    || !response.securityHeaders
    || typeof response.securityHeaders !== 'object'
    || Array.isArray(response.securityHeaders)) {
    findings.push(finding(
      'http_headers_unavailable', 'response headers', 'unavailable', 'neutral', 'Response-header posture unavailable',
      'The selected HTTP observation did not include the normalised security-header set.', ['Selected HTTP response headers'],
    ));
    return findings;
  }

  const headerChecks: Array<[string, unknown, string, string]> = [
    ['content_security_policy', headers.contentSecurityPolicy, 'Content Security Policy', 'Content-Security-Policy'],
    ['content_type_protection', headers.xContentTypeOptions, 'Content-type protection', 'X-Content-Type-Options'],
    ['referrer_policy', headers.referrerPolicy, 'Referrer policy', 'Referrer-Policy'],
    ['frame_options', headers.xFrameOptions, 'Frame options', 'X-Frame-Options'],
  ];
  if (transport === 'https') {
    headerChecks.unshift(['strict_transport_security', headers.strictTransportSecurity, 'Strict Transport Security', 'Strict-Transport-Security']);
  }
  for (const [id, value, label, header] of headerChecks) {
    findings.push(present(value)
      ? finding(
        `${id}_observed`, 'response headers', 'observed', 'configured', `${label} observed`,
        `The selected response included the ${header} header. Supported policy-quality checks are reported separately.`, ['Selected HTTP response headers'],
      )
      : finding(
        `${id}_absent`, 'response headers', 'observed_absence', 'review', `${label} not observed`,
        `The selected response did not include the ${header} header. This is a response-scoped observation, not a site-wide vulnerability finding.`, ['Selected HTTP response headers'],
      ));
  }
  return findings;
}

type ResponsePolicyFindingDefinition = {
  label: string;
  detail: (count: number) => string;
  state?: PostureState;
  tone?: PostureTone;
  evidence?: string[];
};

const RESPONSE_POLICY_FINDINGS: Readonly<Record<string, ResponsePolicyFindingDefinition>> = Object.freeze({
  csp_default_source_missing: {
    label: 'CSP default source not declared',
    detail: () => 'The selected Content Security Policy did not declare default-src. A policy can enumerate fetch directives individually, so this is a bounded review signal rather than proof of exposure.',
  },
  csp_base_uri_missing: {
    label: 'CSP base URI control not declared',
    detail: () => 'The selected Content Security Policy did not declare base-uri, which has no default-src fallback.',
  },
  csp_object_source_unbounded: {
    label: 'CSP object source not bounded',
    detail: () => 'The selected Content Security Policy declared neither object-src nor a default-src fallback.',
  },
  csp_permissive_script_source: {
    label: 'Permissive CSP script source observed',
    detail: () => 'The effective selected script source included a wildcard or broad scheme source. This fixed observation does not establish that an unsafe script is reachable.',
  },
  csp_unsafe_eval: {
    label: 'CSP permits unsafe evaluation',
    detail: () => "The effective selected script source included 'unsafe-eval'.",
  },
  csp_unsafe_inline: {
    label: 'Response CSP header permits unqualified inline script',
    detail: () => "The selected response header included 'unsafe-inline' without a nonce or hash source in that directive. A separate page policy was not observed early enough to qualify this response-scoped finding.",
  },
  csp_inline_constrained_by_meta: {
    label: 'Page CSP further constrains inline script',
    detail: () => 'A bounded CSP meta policy appeared before page scripts and further constrained the inline-script allowance in the selected response header. Browsers enforce both policies.',
    state: 'observed',
    tone: 'configured',
    evidence: ['Selected HTTP response headers', 'Static page CSP meta policy'],
  },
  hsts_disabled: {
    label: 'HSTS disabled by selected response',
    detail: () => 'The selected Strict-Transport-Security policy declared max-age=0.',
  },
  hsts_short_max_age: {
    label: 'Short HSTS duration observed',
    detail: () => 'The selected Strict-Transport-Security max-age was greater than zero but shorter than 180 days.',
  },
  referrer_policy_permissive: {
    label: 'Permissive referrer policy observed',
    detail: () => 'The effective selected Referrer-Policy was unsafe-url or no-referrer-when-downgrade.',
  },
  cookies_missing_secure: {
    label: 'Response cookies without Secure',
    detail: (count) => `${count} selected response cookie${count === 1 ? '' : 's'} did not declare Secure. Cookie purpose and application behavior were not inspected.`,
  },
  cookies_missing_http_only: {
    label: 'Response cookies without HttpOnly',
    detail: (count) => `${count} selected response cookie${count === 1 ? '' : 's'} did not declare HttpOnly. Some client-readable cookies are intentional, so this is a review signal only.`,
  },
  cookies_missing_same_site: {
    label: 'Response cookies without SameSite',
    detail: (count) => `${count} selected response cookie${count === 1 ? '' : 's'} did not declare SameSite.`,
  },
  cookies_same_site_none_without_secure: {
    label: 'SameSite=None cookies without Secure',
    detail: (count) => `${count} selected response cookie${count === 1 ? '' : 's'} declared SameSite=None without Secure.`,
  },
});

function responsePolicyFindings(value: unknown): PostureFinding[] {
  const policy = record(value);
  if (![1, 2].includes(Number(policy.responsePolicyVersion))) return [];
  const findings: PostureFinding[] = [];
  const components = record(policy.components);
  const componentLabels: Array<[string, string]> = [
    ['contentSecurityPolicy', 'Content Security Policy quality unavailable'],
    ['strictTransportSecurity', 'Strict Transport Security quality unavailable'],
    ['referrerPolicy', 'Referrer policy quality unavailable'],
    ['responseCookies', 'Response-cookie attribute review incomplete'],
  ];
  for (const [key, label] of componentLabels) {
    if (!['partial', 'malformed'].includes(String(components[key] || ''))) continue;
    findings.push(finding(
      `response_policy_${key}_unavailable`,
      'response headers',
      'unavailable',
      'neutral',
      label,
      'The selected value was present but could not be interpreted completely within the configured parser and byte limits.',
      ['Transient selected response-policy analysis'],
    ));
  }
  for (const rawSignal of (Array.isArray(policy.signals) ? policy.signals : []).slice(0, 16)) {
    const signal = record(rawSignal);
    const id = typeof signal.id === 'string' ? signal.id : '';
    const definition = RESPONSE_POLICY_FINDINGS[id];
    if (!definition || findings.some((item) => item.id === id)) continue;
    const count = boundedCount(signal.count, 32);
    findings.push(finding(
      id,
      'response headers',
      definition.state ?? 'potential_exposure',
      definition.tone ?? 'review',
      definition.label,
      definition.detail(count),
      definition.evidence ?? ['Transient selected response-policy analysis'],
    ));
  }
  return findings;
}

function pageFindings(pageValue: unknown, httpValue: unknown): PostureFinding[] {
  const page = record(pageValue);
  if (!statusAvailable(page, 'html')) {
    return [finding(
      'static_page_evidence_unavailable', 'forms and resources', 'unavailable', 'neutral', 'Static page posture unavailable',
      'No bounded static page-identity observation was available to evaluate form and resource destinations.', ['Static page analysis'],
    )];
  }

  const forms = record(page.forms);
  const resources = record(page.resources);
  const formsAvailable = page.forms !== null && typeof page.forms === 'object' && !Array.isArray(page.forms)
    && Object.prototype.hasOwnProperty.call(forms, 'insecureActionCount');
  const resourcesAvailable = page.resources !== null && typeof page.resources === 'object' && !Array.isArray(page.resources)
    && Array.isArray(resources.externalOrigins);
  const insecureActions = boundedCount(forms.insecureActionCount, 50);
  const externalActions = Math.min(
    Array.isArray(forms.externalActionOrigins) ? forms.externalActionOrigins.length : 0,
    10,
  );
  const http = record(httpValue);
  const finalUsesHttps = http.transportSecurity === 'https';
  const externalOrigins = (Array.isArray(resources.externalOrigins) ? resources.externalOrigins : [])
    .slice(0, MAX_RETAINED_ORIGINS)
    .filter((value): value is string => typeof value === 'string' && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value));
  const insecureResourceOrigins = finalUsesHttps
    ? externalOrigins.filter((value) => value.toLowerCase().startsWith('http://')).length
    : 0;
  const complete = page.complete === true && resources.truncated !== true && forms.truncated !== true;
  const findings: PostureFinding[] = [];

  if (!formsAvailable) {
    findings.push(finding(
      'form_metadata_unavailable', 'forms and resources', 'unavailable', 'neutral', 'Form posture unavailable',
      'The static page observation did not include the bounded form summary.', ['Static form metadata'],
    ));
  } else if (insecureActions > 0) {
    findings.push(finding(
      'cleartext_form_actions', 'forms and resources', 'potential_exposure', 'review', 'Cleartext form destinations observed',
      `${insecureActions} retained form action${insecureActions === 1 ? '' : 's'} used cleartext HTTP from an HTTPS page.`, ['Static form metadata'],
    ));
  } else if (complete) {
    findings.push(finding(
      'cleartext_form_actions_absent', 'forms and resources', 'observed_absence', 'configured', 'No cleartext form destination observed',
      'No retained form action used cleartext HTTP in the complete bounded static-page observation.', ['Static form metadata'],
    ));
  }

  if (formsAvailable && externalActions > 0) {
    findings.push(finding(
      'external_form_destinations', 'forms and resources', 'observed', 'neutral', 'External form destinations observed',
      `${externalActions} external form-action origin${externalActions === 1 ? ' was' : 's were'} retained for review. External submission can be legitimate and is not itself a vulnerability.`, ['Static form metadata'],
    ));
  }

  if (finalUsesHttps && !resourcesAvailable) {
    findings.push(finding(
      'resource_metadata_unavailable', 'forms and resources', 'unavailable', 'neutral', 'Resource posture unavailable',
      'The static page observation did not include the bounded resource-origin summary.', ['Static resource metadata'],
    ));
  } else if (finalUsesHttps && insecureResourceOrigins > 0) {
    findings.push(finding(
      'mixed_content_origins', 'forms and resources', 'potential_exposure', 'review', 'Cleartext resource origins observed',
      `${insecureResourceOrigins} retained resource origin${insecureResourceOrigins === 1 ? '' : 's'} used HTTP from the selected HTTPS page and may create mixed-content exposure.`, ['Static resource metadata'],
    ));
  } else if (finalUsesHttps && complete) {
    findings.push(finding(
      'mixed_content_origins_absent', 'forms and resources', 'observed_absence', 'configured', 'No cleartext resource origin observed',
      'No retained resource origin used HTTP in the complete bounded static-page observation.', ['Static resource metadata'],
    ));
  }
  return findings;
}

function tlsFindings(tlsValue: unknown): PostureFinding[] {
  const tls = record(tlsValue);
  if (!statusAvailable(tls, 'tls')) {
    return [finding(
      'tls_evidence_unavailable', 'certificate', 'unavailable', 'neutral', 'TLS posture unavailable',
      'No successful or partial TLS handshake observation was available for certificate review.', ['TLS collection'],
    )];
  }

  const authorization = record(tls.authorization);
  const hostname = record(tls.hostname);
  const validity = record(tls.validity);
  const protocol = typeof tls.protocol === 'string' && tls.protocol.length <= 32 ? tls.protocol.trim().toUpperCase() : '';
  const findings: PostureFinding[] = [];

  if (protocol) {
    const legacy = ['TLSV1', 'TLSV1.0', 'TLSV1.1'].includes(protocol);
    findings.push(legacy
      ? finding(
        'legacy_tls_negotiated', 'certificate', 'potential_exposure', 'review', 'Legacy TLS negotiated',
        'The single retained connection negotiated TLS 1.1 or earlier. This does not enumerate every protocol the endpoint supports.', ['TLS handshake'],
      )
      : finding(
        'modern_tls_negotiated', 'certificate', 'observed', 'configured', 'Modern TLS negotiated',
        'The single retained connection negotiated TLS 1.2 or later. This does not enumerate every protocol the endpoint supports.', ['TLS handshake'],
      ));
  }

  findings.push(authorization.authorized === true
    ? finding(
      'certificate_authorized', 'certificate', 'observed', 'configured', 'Certificate chain authorised',
      'The runtime trust store authorised the observed certificate chain for the retained connection.', ['TLS handshake'],
    )
    : authorization.authorized === false
      ? finding(
        'certificate_not_authorized', 'certificate', 'potential_exposure', 'review', 'Certificate chain not authorised',
        'The runtime trust store did not authorise the observed certificate chain. Review the separately attributed TLS evidence for context.', ['TLS handshake'],
      )
      : finding(
        'certificate_authorization_unavailable', 'certificate', 'unavailable', 'neutral', 'Certificate authorisation unavailable',
        'The retained TLS observation did not include a conclusive chain-authorization result.', ['TLS handshake'],
      ));

  findings.push(hostname.matches === true
    ? finding(
      'certificate_hostname_match', 'certificate', 'observed', 'configured', 'Certificate hostname matched',
      'The observed leaf certificate matched the hostname used for the retained TLS connection.', ['TLS handshake'],
    )
    : hostname.matches === false
      ? finding(
        'certificate_hostname_mismatch', 'certificate', 'potential_exposure', 'review', 'Certificate hostname mismatch',
        'The observed leaf certificate did not match the hostname used for the retained TLS connection.', ['TLS handshake'],
      )
      : finding(
        'certificate_hostname_unavailable', 'certificate', 'unavailable', 'neutral', 'Certificate hostname check unavailable',
        'The retained TLS observation did not include a conclusive hostname-match result.', ['TLS handshake'],
      ));

  const validityStatus = typeof validity.status === 'string' && validity.status.length <= 32
    ? validity.status.toLowerCase()
    : '';
  findings.push(validityStatus === 'valid'
    ? finding(
      'certificate_valid', 'certificate', 'observed', 'configured', 'Certificate valid at observation time',
      'The observed leaf certificate was within its published validity period.', ['TLS certificate'],
    )
    : ['expired', 'not_yet_valid'].includes(validityStatus)
      ? finding(
        'certificate_validity_problem', 'certificate', 'potential_exposure', 'review', 'Certificate validity requires review',
        'The observed leaf certificate was outside its published validity period.', ['TLS certificate'],
      )
      : finding(
        'certificate_validity_unavailable', 'certificate', 'unavailable', 'neutral', 'Certificate validity unavailable',
        'The retained TLS observation did not provide a complete certificate validity period.', ['TLS certificate'],
      ));
  return findings;
}

function dnssecState(value: unknown): 'signed' | 'unsigned' | 'unknown' {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) return 'unknown';
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['signed', 'signeddelegation', 'secure', 'yes', 'true', 'active'].includes(normalized)) return 'signed';
  if (['unsigned', 'insecure', 'no', 'false', 'inactive'].includes(normalized)) return 'unsigned';
  return 'unknown';
}

function dnsFindings(dnsValue: unknown, dnssecValue: unknown): PostureFinding[] {
  const dns = record(dnsValue);
  const records = record(dns.records);
  const diagnostics = record(dns.diagnostics);
  const caaDiagnostic = record(diagnostics.caa);
  const caaPolicy = record(dns.caaPolicy);
  const hasEffectivePolicy = caaPolicy.policyVersion === 1;
  const caaAvailable = hasEffectivePolicy
    ? caaPolicy.complete === true
      && caaPolicy.truncated !== true
      && typeof caaPolicy.status === 'string'
      && ['success', 'not_found'].includes(caaPolicy.status)
    : statusAvailable(dns, 'dns')
      && typeof caaDiagnostic.status === 'string'
      && ['success', 'not_found'].includes(caaDiagnostic.status);
  const caaRecords = hasEffectivePolicy ? caaPolicy.records : records.caa;
  const caaCount = Math.min(Array.isArray(caaRecords) ? caaRecords.length : 0, 16);
  const caaSource = hasEffectivePolicy ? 'DNS effective CAA policy' : 'DNS CAA query';
  const findings: PostureFinding[] = [];
  const dnssec = dnssecState(dnssecValue);

  findings.push(dnssec === 'signed'
    ? finding(
      'dnssec_signed', 'domain controls', 'observed', 'configured', 'DNSSEC signing reported',
      'The registry or WHOIS source reported a signed DNSSEC delegation.', ['Registry or WHOIS DNSSEC publication'],
    )
    : dnssec === 'unsigned'
      ? finding(
        'dnssec_unsigned', 'domain controls', 'observed_absence', 'review', 'DNSSEC signing not reported',
        'The registry or WHOIS source reported an unsigned DNSSEC delegation.', ['Registry or WHOIS DNSSEC publication'],
      )
      : finding(
        'dnssec_unavailable', 'domain controls', 'unavailable', 'neutral', 'DNSSEC state unavailable',
        'The retained registry and WHOIS evidence did not provide a recognised DNSSEC state.', ['Registry or WHOIS DNSSEC publication'],
      ));

  findings.push(!caaAvailable
    ? finding(
      'caa_unavailable', 'domain controls', 'unavailable', 'neutral', 'CAA posture unavailable',
      'The CAA query did not produce a conclusive response for this observation.', [caaSource],
    )
    : caaCount > 0
      ? finding(
        'caa_observed', 'domain controls', 'observed', 'configured', 'CAA records observed',
        `${caaCount} bounded CAA record${caaCount === 1 ? ' was' : 's were'} observed. Record policy quality was not scored.`, [caaSource],
      )
      : finding(
        'caa_absent', 'domain controls', 'observed_absence', 'review', 'CAA records not observed',
        hasEffectivePolicy
          ? 'The completed effective-policy walk returned no applicable CAA record in this point-in-time observation.'
          : 'The resolver returned no CAA record in this point-in-time query.',
        [caaSource],
      ));
  return findings;
}

function analyzeWebsiteSecurityPosture(input: WebsiteSecurityPostureInput = {}) {
  const findings = [
    ...httpFindings(input.http),
    ...responsePolicyFindings(input.responsePolicy),
    ...pageFindings(input.pageIdentity, input.http),
    ...tlsFindings(input.tls),
    ...dnsFindings(input.dns, input.dnssec),
  ].slice(0, MAX_SECURITY_POSTURE_FINDINGS);
  const sourceValues = [input.http, input.pageIdentity, input.tls, input.dns];
  if (input.responsePolicy !== undefined) sourceValues.push(input.responsePolicy);
  const partial = sourceValues.some((value) => {
    const item = record(value);
    return item.status !== 'success' || item.complete !== true;
  }) || findings.some((item) => item.state === 'unavailable');
  const counts = {
    observed: findings.filter((item) => item.state === 'observed').length,
    potentialExposure: findings.filter((item) => item.state === 'potential_exposure').length,
    observedAbsence: findings.filter((item) => item.state === 'observed_absence').length,
    unavailable: findings.filter((item) => item.state === 'unavailable').length,
  };
  const limitations = [
    'This is a point-in-time passive interpretation of one bounded deep lookup, not an active vulnerability assessment.',
    'Observed absence applies only to the selected response or retained static evidence and does not establish site-wide absence.',
    'Response-policy findings retain fixed identifiers and counts only; complete policies, cookie data, nonces, hashes, and reporting endpoints are discarded.',
    'The TLS result describes one negotiated connection and does not enumerate every supported protocol or cipher.',
  ];
  if (partial) limitations.push('One or more contributing source observations were partial or unavailable.');

  return {
    postureVersion: WEBSITE_SECURITY_POSTURE_VERSION,
    ...createObservation({
      status: partial ? 'partial' : 'success',
      observedAt: input.observedAt,
      scanMode: 'deep',
      source: 'derived',
      complete: !partial,
      truncated: false,
      limitations,
      diagnostics: { findings: findings.length, ...counts },
    }),
    summary: counts,
    findings,
  };
}

export {
  MAX_SECURITY_POSTURE_FINDINGS,
  WEBSITE_SECURITY_POSTURE_VERSION,
  analyzeWebsiteSecurityPosture,
};

export type {
  PostureCategory,
  PostureFinding,
  PostureState,
  PostureTone,
  WebsiteSecurityPostureInput,
};
