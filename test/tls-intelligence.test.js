const { EventEmitter } = require('node:events');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  TLS_PROFILE_VERSION,
  MAX_ALT_NAMES,
  MAX_CHAIN_CERTIFICATES,
  MAX_RESOLVED_ADDRESSES,
  buildTlsObservation,
  collectTlsIntelligence,
  failedTlsObservation,
  normalizeAltNames,
  normalizePublicAddressRecords,
  normalizeTlsHostname,
  skippedTlsObservation,
} = require('../lib/tls-intelligence');

const OBSERVED_AT = '2026-07-13T10:00:00.000Z';
const NOW = new Date('2026-07-13T10:00:00.000Z');

function certificate(overrides = {}) {
  return {
    subject: { CN: 'login.example.test', O: 'Example organization', C: 'AU' },
    issuer: { CN: 'Example issuing CA', O: 'Example CA' },
    subjectaltname: 'DNS:login.example.test, DNS:*.example.test, IP Address:93.184.216.34',
    serialNumber: '00A1B2C3',
    valid_from: 'Jul  1 00:00:00 2026 GMT',
    valid_to: 'Aug  1 00:00:00 2026 GMT',
    fingerprint256: 'AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA',
    bits: 2048,
    ca: false,
    ...overrides,
  };
}

function handshake(overrides = {}) {
  return {
    connectedAddress: '93.184.216.34',
    sniHost: 'login.example.test',
    protocol: 'TLSv1.3',
    alpnProtocol: 'h2',
    cipher: { name: 'TLS_AES_256_GCM_SHA384', standardName: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' },
    ephemeralKey: { type: 'ECDH', name: 'X25519', size: 253 },
    authorized: true,
    authorizationError: null,
    hostnameMatches: true,
    hostnameError: null,
    peerCertificate: certificate(),
    ...overrides,
  };
}

class FakeTlsSocket extends EventEmitter {
  constructor(peer = certificate()) {
    super();
    this.peer = peer;
    this.remoteAddress = '93.184.216.34';
    this.alpnProtocol = 'h2';
    this.authorized = true;
    this.authorizationError = null;
    this.destroyedByCollector = false;
  }

  getPeerCertificate() { return this.peer; }
  getProtocol() { return 'TLSv1.3'; }
  getCipher() { return { name: 'TLS_AES_256_GCM_SHA384', standardName: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' }; }
  getEphemeralKeyInfo() { return { type: 'ECDH', name: 'X25519', size: 253 }; }
  destroy() { this.destroyedByCollector = true; }
}

describe('TLS target normalization and address safety', () => {
  test('normalizes bounded DNS hostnames for SNI while rejecting IPs and invalid labels', () => {
    assert.equal(normalizeTlsHostname('BÜCHER.Example.'), 'xn--bcher-kva.example');
    assert.equal(normalizeTlsHostname('93.184.216.34'), null);
    assert.equal(normalizeTlsHostname('-bad.example'), null);
    assert.equal(normalizeTlsHostname('bad\n.example'), null);
  });

  test('accepts only bounded public address records with a matching family', () => {
    assert.deepEqual(normalizePublicAddressRecords([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]), [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    assert.throws(() => normalizePublicAddressRecords([{ address: '127.0.0.1', family: 4 }]), /private\/reserved/);
    assert.throws(() => normalizePublicAddressRecords([{ address: '93.184.216.34', family: 6 }]), /invalid/);
    assert.throws(() => normalizePublicAddressRecords([]), /no resolved addresses/);
    assert.throws(() => normalizePublicAddressRecords(Array.from({ length: MAX_RESOLVED_ADDRESSES + 1 }, () => ({ address: '93.184.216.34', family: 4 }))), /too many/);
  });
});

describe('certificate profile normalization', () => {
  test('builds a bounded successful one-connection profile', () => {
    const root = certificate({
      subject: { CN: 'Example root CA' },
      issuer: { CN: 'Example root CA' },
      serialNumber: 'FF',
      fingerprint256: 'BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB',
      ca: true,
    });
    root.issuerCertificate = root;
    const leaf = certificate({ issuerCertificate: root });
    const result = buildTlsObservation(handshake({ peerCertificate: leaf }), {
      observedAt: OBSERVED_AT,
      durationMs: 42,
      resolvedAddressCount: 2,
      now: NOW,
    });

    assert.equal(result.version, 1);
    assert.equal(result.profileVersion, TLS_PROFILE_VERSION);
    assert.equal(result.status, 'success');
    assert.equal(result.complete, true);
    assert.equal(result.connectedAddress, '93.184.216.34');
    assert.equal(result.connectedFamily, 4);
    assert.equal(result.port, 443);
    assert.equal(result.sniHost, 'login.example.test');
    assert.equal(result.protocol, 'TLSv1.3');
    assert.equal(result.alpnProtocol, 'h2');
    assert.equal(result.cipher.name, 'TLS_AES_256_GCM_SHA384');
    assert.equal(result.ephemeralKey.name, 'X25519');
    assert.equal(result.authorization.authorized, true);
    assert.equal(result.hostname.matches, true);
    assert.equal(result.validity.status, 'valid');
    assert.deepEqual(result.certificate.subject.commonNames, ['login.example.test']);
    assert.deepEqual(result.certificate.subjectAltNames.dnsNames, ['*.example.test', 'login.example.test']);
    assert.deepEqual(result.certificate.subjectAltNames.ipAddresses, ['93.184.216.34']);
    assert.equal(result.certificate.serialNumber, 'a1b2c3');
    assert.equal(result.certificate.fingerprintSha256, 'a'.repeat(64));
    assert.equal(result.certificate.publicKey.bits, 2048);
    assert.equal(result.chain.length, 2);
    assert.equal(result.chain[1].isCertificateAuthority, true);
    assert.equal(result.findings[0].id, 'wildcard_certificate');
    assert.equal(result.diagnostics.connectionAttempts, 1);
    assert.equal(result.diagnostics.resolvedAddressCount, 2);
    assert.match(result.limitations.join(' '), /one validated public address/i);
  });

  test('keeps validity, trust, hostname, and wildcard findings separate and explainable', () => {
    const result = buildTlsObservation(handshake({
      authorized: false,
      authorizationError: 'CERT_HAS_EXPIRED',
      hostnameMatches: false,
      hostnameError: 'Hostname does not match certificate',
      peerCertificate: certificate({ valid_to: 'Jul  1 00:00:00 2026 GMT' }),
    }), { observedAt: OBSERVED_AT, now: NOW });

    assert.equal(result.validity.status, 'expired');
    assert.equal(result.authorization.authorized, false);
    assert.equal(result.hostname.matches, false);
    assert.deepEqual(result.findings.map((finding) => finding.id), [
      'certificate_expired',
      'certificate_unauthorized',
      'hostname_mismatch',
      'wildcard_certificate',
    ]);
    assert.ok(result.findings.every((finding) => !/malicious/i.test(finding.detail)));
  });

  test('reports not-yet-valid and unknown validity without inventing dates', () => {
    assert.equal(buildTlsObservation(handshake({
      peerCertificate: certificate({ valid_from: 'Aug  1 00:00:00 2026 GMT' }),
    }), { now: NOW }).validity.status, 'not_yet_valid');
    assert.equal(buildTlsObservation(handshake({
      peerCertificate: certificate({ valid_from: 'bad', valid_to: null }),
    }), { now: NOW }).validity.status, 'unknown');
  });

  test('marks profiles partial when the leaf fingerprint or validation outcomes are incomplete', () => {
    const missingFingerprint = buildTlsObservation(handshake({
      peerCertificate: certificate({ fingerprint256: 'not-a-sha256-fingerprint' }),
    }), { now: NOW });
    assert.equal(missingFingerprint.status, 'partial');
    assert.equal(missingFingerprint.complete, false);
    assert.equal(missingFingerprint.certificate.fingerprintSha256, null);
    assert.ok(missingFingerprint.diagnostics.discardedFields >= 1);

    const missingValidation = buildTlsObservation(handshake({
      authorized: null,
      hostnameMatches: null,
    }), { now: NOW });
    assert.equal(missingValidation.status, 'partial');
    assert.equal(missingValidation.complete, false);
  });

  test('parses quoted SAN entries, rejects malformed names, and caps the combined inventory', () => {
    const state = { truncated: false, discarded: 0 };
    const source = [
      'DNS:"login.example.test"',
      'DNS:bad name.example',
      ...Array.from({ length: MAX_ALT_NAMES + 2 }, (_, index) => `DNS:host-${index}.example.test`),
      'IP Address:93.184.216.34',
    ].join(', ');
    const result = normalizeAltNames(source, state);
    assert.equal(result.dnsNames.length + result.ipAddresses.length, MAX_ALT_NAMES);
    assert.equal(result.truncated, true);
    assert.equal(state.truncated, true);
    assert.ok(state.discarded >= 1);
  });

  test('bounds a recursive certificate chain without retaining raw certificate bytes', () => {
    const certificates = Array.from({ length: MAX_CHAIN_CERTIFICATES + 1 }, (_, index) => certificate({
      serialNumber: String(index + 1).padStart(2, '0'),
      fingerprint256: `${(index + 1).toString(16).padStart(2, '0')}:`.repeat(31) + (index + 1).toString(16).padStart(2, '0'),
    }));
    certificates.forEach((item, index) => { item.issuerCertificate = certificates[index + 1]; });
    const result = buildTlsObservation(handshake({ peerCertificate: certificates[0] }), { now: NOW });
    assert.equal(result.chain.length, MAX_CHAIN_CERTIFICATES);
    assert.equal(result.chainTruncated, true);
    assert.equal(result.status, 'partial');
    assert.equal(result.truncated, true);
    assert.equal(JSON.stringify(result).includes('raw'), false);
  });

  test('uses explicit error and skipped envelopes for non-success states', () => {
    const failed = failedTlsObservation(new Error(`failed\n${'x'.repeat(400)}`), {
      sniHost: 'example.test',
      connectedAddress: '93.184.216.34',
      connectionAttempts: 1,
      observedAt: OBSERVED_AT,
    });
    assert.equal(failed.status, 'error');
    assert.equal(failed.complete, false);
    assert.ok(failed.diagnostics.error.length <= 240);
    assert.equal(failed.certificate, null);

    const skipped = skippedTlsObservation();
    assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.diagnostics.connectionAttempts, 0);
    assert.equal(skipped.certificate, null);
  });
});

describe('one-connection TLS collection', () => {
  test('pins one TLS connection to the first validated address while retaining SNI', async () => {
    const socket = new FakeTlsSocket();
    let calls = 0;
    let connectionOptions;
    const scheduledDeadlines = [];
    const clearedDeadlines = [];
    const resultPromise = collectTlsIntelligence('LOGIN.EXAMPLE.TEST', {
      resolveAddresses: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ],
      connect: (options, callback) => {
        calls += 1;
        connectionOptions = options;
        queueMicrotask(callback);
        return socket;
      },
      checkServerIdentity: () => undefined,
      setTimer: (callback, ms) => { scheduledDeadlines.push({ callback, ms }); return `deadline-${scheduledDeadlines.length}`; },
      clearTimer: (value) => { clearedDeadlines.push(value); },
      observedAt: () => OBSERVED_AT,
      now: (() => { let value = 1000; return () => value += 10; })(),
    });
    const result = await resultPromise;

    assert.equal(calls, 1);
    assert.deepEqual(connectionOptions, {
      host: '93.184.216.34',
      port: 443,
      servername: 'login.example.test',
      rejectUnauthorized: false,
      ALPNProtocols: ['h2', 'http/1.1'],
    });
    assert.equal(result.status, 'success');
    assert.equal(result.connectedAddress, '93.184.216.34');
    assert.equal(result.sniHost, 'login.example.test');
    assert.equal(result.diagnostics.connectionAttempts, 1);
    assert.equal(scheduledDeadlines.length, 2);
    assert.equal(scheduledDeadlines[0].ms, 5000);
    assert.ok(scheduledDeadlines[1].ms > 0 && scheduledDeadlines[1].ms <= 5000);
    assert.deepEqual(clearedDeadlines, ['deadline-1', 'deadline-2']);
    assert.equal(socket.destroyedByCollector, true);
  });

  test('records a hostname mismatch from the runtime checker without failing the handshake observation', async () => {
    const socket = new FakeTlsSocket();
    const result = await collectTlsIntelligence('login.example.test', {
      resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
      connect: (_options, callback) => { queueMicrotask(callback); return socket; },
      checkServerIdentity: () => Object.assign(new Error('Hostname mismatch'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }),
      observedAt: () => OBSERVED_AT,
      now: () => NOW.getTime(),
    });
    assert.equal(result.status, 'success');
    assert.equal(result.hostname.matches, false);
    assert.match(result.hostname.error, /Hostname mismatch/);
    assert.ok(result.findings.some((finding) => finding.id === 'hostname_mismatch'));
  });

  test('fails closed before connecting when resolution is private, malformed, or fails', async () => {
    let connectCalls = 0;
    for (const resolveAddresses of [
      async () => [{ address: '127.0.0.1', family: 4 }],
      async () => [{ address: 'not-an-ip', family: 4 }],
      async () => { throw new Error('resolver unavailable'); },
    ]) {
      const result = await collectTlsIntelligence('example.test', {
        resolveAddresses,
        connect: () => { connectCalls += 1; throw new Error('must not connect'); },
        observedAt: () => OBSERVED_AT,
      });
      assert.equal(result.status, 'error');
      assert.equal(result.diagnostics.connectionAttempts, 0);
    }
    assert.equal(connectCalls, 0);
  });

  test('bounds address resolution within the same overall collection deadline', async () => {
    let connectCalls = 0;
    let deadlineCallback;
    const resultPromise = collectTlsIntelligence('example.test', {
      resolveAddresses: () => new Promise(() => {}),
      connect: () => { connectCalls += 1; throw new Error('must not connect'); },
      setTimer: (callback) => { deadlineCallback = callback; queueMicrotask(callback); return 'resolution-deadline'; },
      clearTimer: () => {},
      observedAt: () => OBSERVED_AT,
    });
    const result = await resultPromise;
    assert.equal(typeof deadlineCallback, 'function');
    assert.equal(result.status, 'error');
    assert.match(result.diagnostics.error, /resolution timed out/i);
    assert.equal(result.diagnostics.connectionAttempts, 0);
    assert.equal(connectCalls, 0);
  });

  test('converts synchronous connection failures and timeouts into bounded evidence', async () => {
    const synchronous = await collectTlsIntelligence('example.test', {
      resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
      connect: () => { throw new Error('connect failed'); },
      observedAt: () => OBSERVED_AT,
    });
    assert.equal(synchronous.status, 'error');
    assert.equal(synchronous.diagnostics.connectionAttempts, 1);

    const socket = new FakeTlsSocket();
    let deadlineCallback;
    let timerCalls = 0;
    const timeoutPromise = collectTlsIntelligence('example.test', {
      resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
      connect: () => socket,
      setTimer: (callback) => {
        timerCalls += 1;
        deadlineCallback = callback;
        if (timerCalls === 2) queueMicrotask(callback);
        return `deadline-${timerCalls}`;
      },
      clearTimer: () => {},
      observedAt: () => OBSERVED_AT,
    });
    const timedOut = await timeoutPromise;
    assert.equal(timedOut.status, 'error');
    assert.match(timedOut.diagnostics.error, /timed out/i);
    assert.equal(socket.destroyedByCollector, true);
  });
});
