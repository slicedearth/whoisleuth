// Bounded, one-connection TLS and certificate intelligence for deep scans.
//
// The collector resolves the submitted hostname once through the same public-
// address guard used by safe-fetch, validates every returned address again at
// this boundary, and connects directly to exactly one validated address. The
// original hostname remains the SNI and certificate-identity target. It does
// not enumerate protocol versions or cipher suites and retains no certificate
// bytes, session material, or application data.

const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');
const { domainToASCII } = require('node:url');
const { createObservation } = require('./observation');
const { isPrivateAddress, resolvePublicAddresses } = require('./safe-fetch');

const TLS_PROFILE_VERSION = 1;
const TLS_PORT = 443;
const TLS_TIMEOUT_MS = 5000;
const MAX_RESOLVED_ADDRESSES = 64;
const MAX_CHAIN_CERTIFICATES = 8;
const MAX_ALT_NAMES = 50;
const MAX_NAME_VALUES = 4;
const MAX_TEXT_LENGTH = 256;
const MAX_ERROR_LENGTH = 240;
const MAX_SERIAL_LENGTH = 128;
const MAX_SAN_SOURCE_LENGTH = 32 * 1024;
const MAX_CERTIFICATE_BYTES = 256 * 1024;

function tracker() {
  return { truncated: false, discarded: 0 };
}

function boundedString(value, maxLength, state) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[\u0000-\u001f\u007f]/g, ' ');
  if (normalized !== trimmed) state.discarded += 1;
  if (normalized.length > maxLength) state.truncated = true;
  return normalized.slice(0, maxLength);
}

function normalizeTlsHostname(value) {
  if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  const ascii = domainToASCII(value.trim().replace(/\.+$/, '')).toLowerCase();
  if (!ascii || ascii.length > 253 || net.isIP(ascii)) return null;
  const labels = ascii.split('.');
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return ascii;
}

function normalizeIp(value) {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u0020\u007f%]/.test(value)) return null;
  return net.isIP(value) ? value.toLowerCase() : null;
}

function normalizePublicIp(value) {
  const address = normalizeIp(value);
  return address && !isPrivateAddress(address) ? address : null;
}

function normalizePublicAddressRecords(records) {
  if (!Array.isArray(records) || records.length === 0) throw new Error('TLS target has no resolved addresses');
  if (records.length > MAX_RESOLVED_ADDRESSES) throw new Error('TLS target returned too many resolved addresses');
  return records.map((record) => {
    const address = normalizeIp(record && record.address);
    const family = Number(record && record.family);
    if (!address || ![4, 6].includes(family) || net.isIP(address) !== family || isPrivateAddress(address)) {
      throw new Error('TLS target resolved to an invalid or private/reserved address');
    }
    return { address, family };
  });
}

function normalizeDate(value, state) {
  if (typeof value !== 'string') return null;
  if (value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) {
    if (value) state.discarded += 1;
    if (value.length > 64) state.truncated = true;
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    if (value.trim()) state.discarded += 1;
    return null;
  }
  return new Date(parsed).toISOString();
}

function normalizeFingerprint(value, state) {
  if (typeof value !== 'string') return null;
  if (value.length > 128) {
    state.truncated = true;
    state.discarded += 1;
    return null;
  }
  const compact = value.replace(/:/g, '').toLowerCase();
  if (/^[0-9a-f]{64}$/.test(compact)) return compact;
  if (value.trim()) state.discarded += 1;
  return null;
}

function normalizeSerial(value, state) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const compact = value.trim().replace(/:/g, '').toLowerCase();
  if (!compact || compact.length > MAX_SERIAL_LENGTH || !/^[0-9a-f]+$/.test(compact)) {
    if (compact) state.discarded += 1;
    if (compact.length > MAX_SERIAL_LENGTH) state.truncated = true;
    return null;
  }
  return compact.replace(/^0+(?=[0-9a-f])/, '');
}

const NAME_FIELDS = Object.freeze({
  CN: 'commonNames',
  O: 'organizations',
  OU: 'organizationalUnits',
  C: 'countries',
  L: 'localities',
  ST: 'states',
});

function normalizeNameValues(value, state) {
  const source = Array.isArray(value) ? value : [value];
  const values = [];
  for (const item of source) {
    const normalized = boundedString(item, MAX_TEXT_LENGTH, state);
    if (!normalized || values.includes(normalized)) continue;
    if (values.length >= MAX_NAME_VALUES) state.truncated = true;
    else values.push(normalized);
  }
  return values;
}

function normalizeDistinguishedName(value, state) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(NAME_FIELDS).map(([sourceKey, outputKey]) => [
    outputKey,
    normalizeNameValues(source[sourceKey], state),
  ]));
}

function parseQuotedAltName(value) {
  if (!value.startsWith('"')) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function splitAltNames(source) {
  const output = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ',') {
      output.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  output.push(source.slice(start).trim());
  return output;
}

function normalizeSanDns(value) {
  if (typeof value !== 'string' || value.length > 255 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  if (value.startsWith('*.')) {
    const suffix = normalizeTlsHostname(value.slice(2));
    return suffix ? `*.${suffix}` : null;
  }
  return normalizeTlsHostname(value);
}

function normalizeAltNames(value, state) {
  /** @type {{ dnsNames: string[], ipAddresses: string[], truncated: boolean }} */
  const result = { dnsNames: [], ipAddresses: [], truncated: false };
  if (typeof value !== 'string' || !value) return result;
  let source = value;
  if (source.length > MAX_SAN_SOURCE_LENGTH) {
    source = source.slice(0, MAX_SAN_SOURCE_LENGTH);
    state.truncated = true;
    result.truncated = true;
  }
  for (const entry of splitAltNames(source)) {
    const separator = entry.indexOf(':');
    if (separator <= 0) continue;
    const type = entry.slice(0, separator).trim().toLowerCase();
    const raw = entry.slice(separator + 1).trim();
    const decoded = raw.startsWith('"') ? parseQuotedAltName(raw) : raw;
    if (decoded === null) { state.discarded += 1; continue; }
    const list = type === 'dns' ? result.dnsNames : type === 'ip address' ? result.ipAddresses : null;
    const normalized = type === 'dns' ? normalizeSanDns(decoded) : type === 'ip address' ? normalizeIp(decoded) : null;
    if (!list || !normalized) {
      if (list) state.discarded += 1;
      continue;
    }
    if (list.includes(normalized)) continue;
    if (result.dnsNames.length + result.ipAddresses.length >= MAX_ALT_NAMES) {
      state.truncated = true;
      result.truncated = true;
    } else list.push(normalized);
  }
  result.dnsNames.sort();
  result.ipAddresses.sort();
  return result;
}

function hashRawCertificate(raw, state) {
  if (!Buffer.isBuffer(raw)) return null;
  if (raw.length === 0 || raw.length > MAX_CERTIFICATE_BYTES) {
    state.discarded += 1;
    if (raw.length > MAX_CERTIFICATE_BYTES) state.truncated = true;
    return null;
  }
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function publicKeyMetadata(raw, fallback, state) {
  if (Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= MAX_CERTIFICATE_BYTES) {
    try {
      const key = new crypto.X509Certificate(raw).publicKey;
      const exported = key.export({ format: 'der', type: 'spki' });
      const details = key.asymmetricKeyDetails || {};
      const modulusLength = details.modulusLength;
      return {
        type: boundedString(key.asymmetricKeyType, 32, state),
        bits: Number.isSafeInteger(modulusLength) && Number(modulusLength) > 0 ? modulusLength : null,
        curve: boundedString(details.namedCurve, 64, state),
        fingerprintSha256: crypto.createHash('sha256').update(exported).digest('hex'),
      };
    } catch {
      state.discarded += 1;
    }
  }
  const bits = Number(fallback && fallback.bits);
  return {
    type: null,
    bits: Number.isSafeInteger(bits) && bits > 0 && bits <= 32768 ? bits : null,
    curve: boundedString(fallback && (fallback.nistCurve || fallback.asn1Curve), 64, state),
    fingerprintSha256: null,
  };
}

function normalizeCertificate(value, state, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) return null;
  const fingerprintSha256 = hashRawCertificate(value.raw, state) || normalizeFingerprint(value.fingerprint256, state);
  const certificate = {
    subject: normalizeDistinguishedName(value.subject, state),
    issuer: normalizeDistinguishedName(value.issuer, state),
    serialNumber: normalizeSerial(value.serialNumber, state),
    validFrom: normalizeDate(value.valid_from, state),
    validTo: normalizeDate(value.valid_to, state),
    fingerprintSha256,
    isCertificateAuthority: typeof value.ca === 'boolean' ? value.ca : null,
  };
  if (options.includeAltNames === true) certificate.subjectAltNames = normalizeAltNames(value.subjectaltname, state);
  if (options.includePublicKey === true) certificate.publicKey = publicKeyMetadata(value.raw, value, state);
  return certificate;
}

function certificateIdentity(value, state) {
  return hashRawCertificate(value && value.raw, state)
    || normalizeFingerprint(value && value.fingerprint256, state)
    || normalizeSerial(value && value.serialNumber, state);
}

function certificateChain(peer, state) {
  const chain = [];
  const seenObjects = new Set();
  const seenIdentities = new Set();
  let current = peer;
  let truncated = false;
  while (current && typeof current === 'object' && Object.keys(current).length > 0) {
    if (seenObjects.has(current)) break;
    seenObjects.add(current);
    const identity = certificateIdentity(current, state);
    if (identity && seenIdentities.has(identity)) break;
    if (identity) seenIdentities.add(identity);
    if (chain.length >= MAX_CHAIN_CERTIFICATES) {
      state.truncated = true;
      truncated = true;
      break;
    }
    const normalized = normalizeCertificate(current, state);
    if (!normalized) break;
    chain.push(normalized);
    const next = current.issuerCertificate;
    if (!next || next === current) break;
    current = next;
  }
  return { certificates: chain, truncated };
}

function boundedCipher(value, state) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = boundedString(value.name, 128, state);
  const standardName = boundedString(value.standardName, 128, state);
  const version = boundedString(value.version, 32, state);
  return name || standardName || version ? { name, standardName, version } : null;
}

function boundedEphemeralKey(value, state) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = boundedString(value.type, 32, state);
  const name = boundedString(value.name, 64, state);
  const size = Number(value.size);
  const normalizedSize = Number.isSafeInteger(size) && size > 0 && size <= 32768 ? size : null;
  return type || name || normalizedSize ? { type, name, size: normalizedSize } : null;
}

function validityStatus(certificate, now) {
  if (!certificate || !certificate.validFrom || !certificate.validTo) return 'unknown';
  const time = now.getTime();
  if (time < Date.parse(certificate.validFrom)) return 'not_yet_valid';
  if (time > Date.parse(certificate.validTo)) return 'expired';
  return 'valid';
}

function tlsFindings(profile) {
  /** @type {Array<{ id: string, tone: string, label: string, detail: string }>} */
  const findings = [];
  if (profile.validity.status === 'expired') findings.push({ id: 'certificate_expired', tone: 'warning', label: 'Certificate expired', detail: 'The leaf certificate was outside its validity period at observation time.' });
  if (profile.validity.status === 'not_yet_valid') findings.push({ id: 'certificate_not_yet_valid', tone: 'warning', label: 'Certificate not yet valid', detail: 'The leaf certificate validity period had not started at observation time.' });
  if (profile.authorization.authorized === false) findings.push({ id: 'certificate_unauthorized', tone: 'warning', label: 'Certificate not authorized', detail: 'The runtime trust store did not authorize the observed certificate chain. This can reflect an incomplete chain, private CA, self-signed certificate, expiry, or another validation failure.' });
  if (profile.hostname.matches === false) findings.push({ id: 'hostname_mismatch', tone: 'warning', label: 'Hostname mismatch', detail: 'The observed leaf certificate did not match the SNI hostname.' });
  if (profile.certificate?.subjectAltNames?.dnsNames.some((name) => name.startsWith('*.'))) findings.push({ id: 'wildcard_certificate', tone: 'neutral', label: 'Wildcard certificate', detail: 'The leaf certificate includes at least one wildcard DNS name. Wildcard use is common and is not inherently suspicious.' });
  return findings;
}

function buildTlsObservation(handshake = {}, options = {}) {
  const state = tracker();
  const certificate = normalizeCertificate(handshake.peerCertificate, state, { includeAltNames: true, includePublicKey: true });
  const chain = certificateChain(handshake.peerCertificate, state);
  const connectedAddress = normalizePublicIp(handshake.connectedAddress);
  const protocol = boundedString(handshake.protocol, 32, state);
  const cipher = boundedCipher(handshake.cipher, state);
  const sniHost = normalizeTlsHostname(handshake.sniHost);
  const authorized = typeof handshake.authorized === 'boolean' ? handshake.authorized : null;
  const hostnameMatches = typeof handshake.hostnameMatches === 'boolean' ? handshake.hostnameMatches : null;
  const authorizationError = authorized === false
    ? boundedString(handshake.authorizationError, MAX_ERROR_LENGTH, state)
    : null;
  const hostnameError = hostnameMatches === false
    ? boundedString(handshake.hostnameError, MAX_ERROR_LENGTH, state)
    : null;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  /** @type {any} */
  const profile = {
    profileVersion: TLS_PROFILE_VERSION,
    connectedAddress,
    connectedFamily: connectedAddress ? net.isIP(connectedAddress) : null,
    port: TLS_PORT,
    sniHost,
    protocol,
    alpnProtocol: boundedString(handshake.alpnProtocol, 32, state),
    cipher,
    ephemeralKey: boundedEphemeralKey(handshake.ephemeralKey, state),
    authorization: {
      authorized,
      error: authorizationError,
    },
    hostname: {
      matches: hostnameMatches,
      error: hostnameError,
    },
    validity: { status: validityStatus(certificate, now) },
    certificate,
    chain: chain.certificates,
    chainTruncated: chain.truncated,
    findings: [],
  };
  profile.findings = tlsFindings(profile);
  const complete = Boolean(
    connectedAddress
    && sniHost
    && protocol
    && cipher
    && certificate?.fingerprintSha256
    && typeof authorized === 'boolean'
    && typeof hostnameMatches === 'boolean'
  )
    && !state.truncated
    && state.discarded === 0;
  return {
    ...createObservation({
      status: complete ? 'success' : 'partial',
      observedAt: options.observedAt,
      scanMode: 'deep',
      source: 'tls',
      durationMs: options.durationMs,
      complete,
      truncated: state.truncated,
      limitations: [
        'This is a point-in-time TLS handshake to one validated public address; other addresses or edge locations may present different results.',
        'Authorization reflects the certificate authorities and verification behavior available to this runtime.',
        'The profile records the negotiated connection only and does not enumerate supported TLS versions or cipher suites.',
        ...(state.truncated ? ['One or more certificate fields or chain entries reached a retention limit.'] : []),
      ],
      diagnostics: {
        connectionAttempts: 1,
        resolvedAddressCount: Number.isSafeInteger(options.resolvedAddressCount)
          ? Math.max(0, Math.min(MAX_RESOLVED_ADDRESSES, options.resolvedAddressCount))
          : null,
        discardedFields: state.discarded,
      },
    }),
    ...profile,
  };
}

function failedTlsObservation(error, options = {}) {
  const state = tracker();
  const detail = boundedString(error && error.message ? error.message : String(error || 'TLS connection failed'), MAX_ERROR_LENGTH, state);
  return {
    ...createObservation({
      status: 'error',
      observedAt: options.observedAt,
      scanMode: 'deep',
      source: 'tls',
      durationMs: options.durationMs,
      complete: false,
      limitations: ['TLS intelligence was inconclusive; DNS, connection, timeout, policy, or handshake failure is not proof that no TLS service exists.'],
      diagnostics: { connectionAttempts: options.connectionAttempts || 0, error: detail },
    }),
    profileVersion: TLS_PROFILE_VERSION,
    connectedAddress: normalizePublicIp(options.connectedAddress),
    connectedFamily: normalizePublicIp(options.connectedAddress) ? net.isIP(options.connectedAddress) : null,
    port: TLS_PORT,
    sniHost: normalizeTlsHostname(options.sniHost),
    protocol: null,
    alpnProtocol: null,
    cipher: null,
    ephemeralKey: null,
    authorization: { authorized: null, error: null },
    hostname: { matches: null, error: null },
    validity: { status: 'unknown' },
    certificate: null,
    chain: [],
    chainTruncated: false,
    findings: [],
  };
}

function skippedTlsObservation(detail = 'TLS intelligence is disabled by deployment policy.') {
  return {
    ...failedTlsObservation(detail, { connectionAttempts: 0 }),
    ...createObservation({
      status: 'skipped',
      scanMode: 'deep',
      source: 'tls',
      complete: false,
      limitations: [detail],
      diagnostics: { connectionAttempts: 0 },
    }),
  };
}

/**
 * @param {string} hostname
 * @param {{ resolveAddresses?: Function, connect?: Function, checkServerIdentity?: Function, timeoutMs?: number, now?: Function, observedAt?: Function, setTimer?: Function, clearTimer?: Function }} [options]
 */
async function collectTlsIntelligence(hostname, options = {}) {
  const normalizedHostname = normalizeTlsHostname(hostname);
  const now = options.now || Date.now;
  const observedAt = options.observedAt || (() => new Date().toISOString());
  const started = now();
  if (!normalizedHostname) return failedTlsObservation('TLS target hostname is invalid', { observedAt: observedAt(), durationMs: now() - started });

  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) ? Math.max(100, Math.min(15_000, requestedTimeout)) : TLS_TIMEOUT_MS;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const resolveAddresses = options.resolveAddresses || resolvePublicAddresses;
  let records;
  let resolutionDeadline;
  try {
    const resolved = await Promise.race([
      Promise.resolve().then(() => resolveAddresses(normalizedHostname)),
      new Promise((_, reject) => {
        resolutionDeadline = setTimer(() => reject(new Error('TLS resolution timed out')), timeoutMs);
      }),
    ]);
    records = normalizePublicAddressRecords(resolved);
  } catch (error) {
    return failedTlsObservation(error, { sniHost: normalizedHostname, observedAt: observedAt(), durationMs: now() - started });
  } finally {
    if (resolutionDeadline !== undefined) clearTimer(resolutionDeadline);
  }
  const selected = records[0];
  const connect = options.connect || tls.connect;
  const checkServerIdentity = options.checkServerIdentity || tls.checkServerIdentity;
  const remainingMs = Math.max(0, timeoutMs - Math.max(0, now() - started));
  if (remainingMs === 0) {
    return failedTlsObservation('TLS handshake timed out', {
      sniHost: normalizedHostname,
      connectedAddress: selected.address,
      connectionAttempts: 0,
      observedAt: observedAt(),
      durationMs: now() - started,
    });
  }

  return new Promise((resolve) => {
    let socket;
    let deadline;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (deadline !== undefined) clearTimer(deadline);
      if (socket && typeof socket.destroy === 'function') socket.destroy();
      resolve(result);
    };
    const fail = (error) => finish(failedTlsObservation(error, {
      sniHost: normalizedHostname,
      connectedAddress: selected.address,
      connectionAttempts: 1,
      observedAt: observedAt(),
      durationMs: now() - started,
    }));
    try {
      socket = connect({
        host: selected.address,
        port: TLS_PORT,
        servername: normalizedHostname,
        rejectUnauthorized: false,
        ALPNProtocols: ['h2', 'http/1.1'],
      }, () => {
        try {
          const peerCertificate = socket.getPeerCertificate(true);
          let hostnameError = null;
          if (peerCertificate && Object.keys(peerCertificate).length > 0) {
            hostnameError = checkServerIdentity(normalizedHostname, peerCertificate) || null;
          }
          finish(buildTlsObservation({
            connectedAddress: socket.remoteAddress || selected.address,
            sniHost: normalizedHostname,
            protocol: socket.getProtocol(),
            alpnProtocol: socket.alpnProtocol || null,
            cipher: socket.getCipher(),
            ephemeralKey: socket.getEphemeralKeyInfo(),
            authorized: socket.authorized,
            authorizationError: socket.authorizationError || null,
            hostnameMatches: peerCertificate && Object.keys(peerCertificate).length > 0 ? hostnameError === null : null,
            hostnameError: hostnameError && (hostnameError.message || hostnameError.code || String(hostnameError)),
            peerCertificate,
          }, {
            observedAt: observedAt(),
            durationMs: now() - started,
            resolvedAddressCount: records.length,
            now: new Date(now()),
          }));
        } catch (error) {
          fail(error);
        }
      });
      socket.once('error', fail);
      deadline = setTimer(() => fail(new Error('TLS handshake timed out')), remainingMs);
      if (settled && deadline !== undefined) clearTimer(deadline);
    } catch (error) {
      fail(error);
    }
  });
}

module.exports = {
  TLS_PROFILE_VERSION,
  TLS_TIMEOUT_MS,
  MAX_RESOLVED_ADDRESSES,
  MAX_CHAIN_CERTIFICATES,
  MAX_ALT_NAMES,
  normalizeTlsHostname,
  normalizePublicAddressRecords,
  normalizeAltNames,
  buildTlsObservation,
  failedTlsObservation,
  skippedTlsObservation,
  collectTlsIntelligence,
};
