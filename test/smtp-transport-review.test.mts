import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { Socket } from 'node:net';
import type { PeerCertificate } from 'node:tls';
import { describe, test } from 'node:test';

import {
  DNSSEC_CHAIN_SCHEMA,
  DNSSEC_TRUST_ANCHOR_SCHEMA,
  type DnssecChainReport,
} from '../lib/dnssec-chain-validation.mts';
import {
  EHLO_COMMAND,
  MAIL_TRANSPORT_INPUT_SCHEMA,
  STARTTLS_COMMAND,
  certificateObservation,
  collectMailTransportReview,
  normalizeSmtpReply,
  runSmtpConversation,
  smtpStartTlsOptions,
  smtpCapabilities,
  type SmtpConversationConnection,
  type SmtpConversationResult,
} from '../lib/smtp-transport-review.mts';
import { analyzeTlsaEvidence } from '../lib/tlsa-evidence.mts';

const OBSERVED_AT = '2026-08-11T00:00:00.000Z';
const PUBLIC_ADDRESS = '93.184.216.34';
const X509_FIXTURE_BASE64 = [
  'MIIETTCCAzWgAwIBAgIUUjf2vcj1u3aTkQma3003KAP6I9AwDQYJKoZIhvcNAQELBQAwSTEbMBkGA1UEAwwS',
  'bG9naW4uZXhhbXBsZS50ZXN0MR0wGwYDVQQKDBRFeGFtcGxlIG9yZ2FuaXNhdGlvbjELMAkGA1UEBhMCQVUw',
  'HhcNMjYwNzI3MTczODI0WhcNMjYwODI2MTczODI0WjBJMRswGQYDVQQDDBJsb2dpbi5leGFtcGxlLnRlc3Qx',
  'HTAbBgNVBAoMFEV4YW1wbGUgb3JnYW5pc2F0aW9uMQswCQYDVQQGEwJBVTCCASIwDQYJKoZIhvcNAQEBBQAD',
  'ggEPADCCAQoCggEBAMZ61OhoNgyLigpvDTp2TRJLlgpl928mOeXHhdcEiH+jB9ku16PHWGspQRTTMt6WU1Kq',
  'UZ1W/zQEHVkh9UfBburFsiZhk9P/8iY0NQnPNgvbC6VHVwnGKuNrXHFmxAwpCBDxjBo2Zu9bjrknue47rtsz',
  'DvJkHhBhjpXZJXsaCZA7/NmV6HwuvBew8oa325wX1cOR0h8OZHcR9nY3lWcJRbOETG/7maA/qZCaK3Mr/Fk',
  'FJmOQyQ0sooGgfL9FvpGZvBbUYrD2iNRQlrnUMjKk++tcMtHhC3QtCxzynycFRuvkOznVrI5PIYaSEpmRfAu',
  'qXfx2VUDnEFLNphTpKiH5m9kCAwEAAaOCASswggEnMHEGA1UdEQRqMGiCEmxvZ2luLmV4YW1wbGUudGVzdIIO',
  'Ki5leGFtcGxlLnRlc3SHBF242CKBFXNlY3VyaXR5QGV4YW1wbGUudGVzdIYlaHR0cHM6Ly9pZGVudGl0eS5l',
  'eGFtcGxlLnRlc3QvcHJvZmlsZTAdBgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwdAYIKwYBBQUHAQEE',
  'aDBmMCwGCCsGAQUFBzABhiBodHRwczovL29jc3AuZXhhbXBsZS50ZXN0L3N0YXR1czA2BggrBgEFBQcwAoYq',
  'aHR0cDovL2lzc3Vlci5leGFtcGxlLnRlc3QvY2VydGlmaWNhdGUuZGVyMB0GA1UdDgQWBBS7gjHsrFn/EIDd',
  'mJEyW4eNb1Tz0DANBgkqhkiG9w0BAQsFAAOCAQEAptDi0upi//E1M/IgiVaEnIIWKEhpLNl62goNT9Z7f9TH',
  'M0dP9adFSjVXtOPP9n0V2zmcEVUG5CCZvpZiizZZKWOl/OuCegRj6At1URyd27C3NlavvINfCoclgLL3em0u',
  '/rgq6vIa5bQApTbbAu8S7hvLgtpuIdy51HcKBm/33Cqrt1UsIt95r6J6ec5/ggzCJ85apk1Ir10dnARoYJNn',
  'yYZpATsi1sMmkCreAUZ/ISSo8YewsfXnKBw3tpQGJetj+GyfnSd9ao9+UNwUkq+OoSLRHpVfMZBYPg5pl7dE',
  'XDw8pnoK8d81+6jT5UnYYpF39ZO4ONP31gMQ1cOXB0Klyg==',
].join('');
const ANCHOR = {
  schema: DNSSEC_TRUST_ANCHOR_SCHEMA,
  version: 1,
  zone: '.',
  source: 'Fixture trust anchor',
  reviewedAt: OBSERVED_AT,
  dsRecords: [{ keyTag: 12345, algorithm: 13, digestType: 2, digest: '00'.repeat(32) }],
};

function reply(...lines: string[]) {
  return normalizeSmtpReply(lines);
}

function secureReport(target: string): DnssecChainReport {
  return {
    schema: DNSSEC_CHAIN_SCHEMA,
    version: 1,
    state: 'secure',
    target,
    observedAt: OBSERVED_AT,
    resolver: { address: PUBLIC_ADDRESS, port: 53 },
    trustAnchor: { zone: '.', source: ANCHOR.source, reviewedAt: OBSERVED_AT, dsRecordCount: 1 },
    validatedZone: target,
    delegations: [],
    completeness: 'complete',
    transport: { state: 'complete', queryCount: 1, responseBytes: 100, queryLimit: 32, responseByteLimit: 524288, totalTimeoutMs: 30000 },
    failure: null,
    limitations: [],
  };
}

function probeResult(address: string): SmtpConversationResult {
  return {
    connectedAddress: address,
    greeting: reply('220 fixture-mx ESMTP'),
    ehlo: reply('250-fixture-mx', '250 PIPELINING'),
    capabilities: ['PIPELINING'],
    starttlsAdvertised: false,
    starttlsReply: null,
    starttlsState: 'not_advertised',
    tls: null,
    bytesRead: 55,
    lineCount: 3,
  };
}

describe('authorised SMTP transport review', () => {
  test('keeps PKIX path validation separate from endpoint identity alignment', () => {
    const peerCertificate = {
      raw: Buffer.from(X509_FIXTURE_BASE64, 'base64'),
      subject: { CN: 'login.example.test' },
      subjectaltname: 'DNS:login.example.test, DNS:*.example.test',
    };
    const socket = new Socket();
    const connectionOptions = smtpStartTlsOptions(socket, 'mx.unrelated.invalid');
    assert.equal(connectionOptions.rejectUnauthorized, false);
    assert.equal(connectionOptions.servername, 'mx.unrelated.invalid');
    assert.equal(connectionOptions.checkServerIdentity?.(
      'mx.unrelated.invalid',
      peerCertificate as PeerCertificate,
    ), undefined);
    socket.destroy();

    const certificate = certificateObservation('mx.unrelated.invalid', {
      peerCertificate,
      authorized: true,
      authorizationError: null,
      protocol: 'TLSv1.3',
      cipherName: 'FIXTURE-CIPHER',
      remoteAddress: PUBLIC_ADDRESS,
    });
    assert.equal(certificate.observation.pkixState, 'validated');
    assert.equal(certificate.observation.identityState, 'misaligned');
    assert.match(certificate.observation.identityError ?? '', /not in the cert|does not match/u);
  });

  test('normalizes bounded SMTP framing and retains capability names only', () => {
    const value = reply('250-fixture-mx', '250-STARTTLS', '250 SIZE 1024');
    assert.equal(value.code, 250);
    assert.equal(value.sha256, createHash('sha256').update('250-fixture-mx\r\n250-STARTTLS\r\n250 SIZE 1024\r\n', 'ascii').digest('hex'));
    assert.deepEqual(smtpCapabilities(value), ['SIZE', 'STARTTLS']);
    assert.throws(() => reply('250-first', '251 last'), /status changed|framing/u);
    assert.throws(() => reply('250 SIZE\rINJECT'), /invalid or oversized/u);
    assert.throws(() => reply('250 smtputf8-\u00e9'), /invalid or oversized/u);
  });

  test('issues only EHLO and STARTTLS during the bounded active conversation', async () => {
    const commands: string[] = [];
    let destroyed = false;
    const replies = [
      reply('220 fixture-mx ESMTP'),
      reply('250-fixture-mx', '250-STARTTLS', '250 SIZE 1024'),
      reply('220 Begin TLS'),
    ];
    const connection: SmtpConversationConnection = {
      remoteAddress: PUBLIC_ADDRESS,
      readReply: async () => {
        const value = replies.shift();
        assert.ok(value);
        return value;
      },
      write: async (command) => { commands.push(command); },
      startTls: async () => ({
        peerCertificate: null,
        authorized: null,
        authorizationError: null,
        protocol: 'TLSv1.3',
        cipherName: 'FIXTURE-CIPHER',
        remoteAddress: PUBLIC_ADDRESS,
      }),
      diagnostics: () => ({ bytesRead: 99, lineCount: 6 }),
      destroy: () => { destroyed = true; },
    };

    const result = await runSmtpConversation('mx1.example.test', connection);
    assert.deepEqual(commands, [EHLO_COMMAND, STARTTLS_COMMAND]);
    assert.equal(result.starttlsState, 'negotiated');
    assert.equal(result.connectedAddress, PUBLIC_ADDRESS);
    assert.equal(destroyed, true);
    assert.doesNotMatch(commands.join(''), /(?:AUTH|MAIL FROM|RCPT TO|DATA|VRFY|EXPN)/iu);
  });

  test('revalidates selected public addresses and emits relationship leads without raw transport material', async () => {
    const resolutionCalls: string[] = [];
    const probeCalls: string[] = [];
    const input = {
      schema: MAIL_TRANSPORT_INPUT_SCHEMA,
      version: 1,
      domain: 'example.test',
      mxHosts: ['mx1.example.test', 'mx2.example.test'],
      policyContext: {},
    };
    const review = await collectMailTransportReview(input, {
      resolver: PUBLIC_ADDRESS,
      trustAnchor: ANCHOR,
      ownedOrAuthorized: true,
      activeProbeAcknowledged: true,
    }, {
      now: () => 0,
      observedAt: () => OBSERVED_AT,
      resolveHost: async (_session, host) => {
        resolutionCalls.push(host);
        return { addresses: [{ address: PUBLIC_ADDRESS, family: 4 }], aliases: [] };
      },
      validateDnssec: async ({ target }) => ({ report: secureReport(String(target)), zone: String(target), keys: [] }),
      collectTlsaEvidence: async () => ({
        state: 'not_published',
        recordCount: 0,
        signatureState: 'validated',
        dane: null,
        limitations: ['Fixture authenticated denial.'],
      }),
      probe: async ({ hostname, address }) => {
        probeCalls.push(hostname);
        return probeResult(address);
      },
    });

    assert.equal(review.runState, 'complete');
    assert.deepEqual(resolutionCalls, [
      'mx1.example.test', 'mx1.example.test',
      'mx2.example.test', 'mx2.example.test',
    ]);
    assert.deepEqual(probeCalls, ['mx1.example.test', 'mx2.example.test']);
    assert.deepEqual(review.relationships.map((item) => item.basis), ['connected_address', 'greeting_sha256']);
    assert.ok(review.relationships.every((item) => item.interpretation === 'review_lead'));
    assert.equal(review.endpoints[0]?.dnssec?.state, 'secure');
    assert.equal(review.endpoints[0]?.tlsa.state, 'not_published');
    assert.equal(review.endpoints[0]?.starttls.state, 'not_advertised');
    const serialized = JSON.stringify(review);
    assert.doesNotMatch(serialized, /fixture-mx/u);
    assert.doesNotMatch(serialized, /"(?:peerCertificate|certificateDer|lines)"/u);
  });

  test('requires both explicit acknowledgements and blocks private or reserved resolution', async () => {
    const input = {
      schema: MAIL_TRANSPORT_INPUT_SCHEMA,
      version: 1,
      domain: 'example.test',
      mxHosts: ['mx.example.test'],
      policyContext: {},
    };
    await assert.rejects(() => collectMailTransportReview(input, {
      resolver: PUBLIC_ADDRESS,
      trustAnchor: ANCHOR,
      ownedOrAuthorized: true,
      activeProbeAcknowledged: false,
    }), /active-probing acknowledgement/u);

    let probed = false;
    const review = await collectMailTransportReview(input, {
      resolver: PUBLIC_ADDRESS,
      trustAnchor: ANCHOR,
      ownedOrAuthorized: true,
      activeProbeAcknowledged: true,
    }, {
      now: () => 0,
      observedAt: () => OBSERVED_AT,
      resolveHost: async () => ({ addresses: [{ address: PUBLIC_ADDRESS, family: 4 }, { address: '192.0.2.1', family: 4 }], aliases: [] }),
      probe: async ({ address }) => {
        probed = true;
        return probeResult(address);
      },
    });
    assert.equal(probed, false);
    assert.equal(review.endpoints[0]?.state, 'unavailable');
    assert.equal(review.endpoints[0]?.failure?.stage, 'resolution');
    assert.match(review.endpoints[0]?.failure?.detail ?? '', /private|reserved/u);
  });

  test('aborts a probe when the fixed endpoint timer expires', async () => {
    let aborted = false;
    const review = await collectMailTransportReview({
      schema: MAIL_TRANSPORT_INPUT_SCHEMA,
      version: 1,
      domain: 'example.test',
      mxHosts: ['mx.example.test'],
      policyContext: {},
    }, {
      resolver: PUBLIC_ADDRESS,
      trustAnchor: ANCHOR,
      ownedOrAuthorized: true,
      activeProbeAcknowledged: true,
    }, {
      now: () => 0,
      observedAt: () => OBSERVED_AT,
      resolveHost: async () => ({ addresses: [{ address: PUBLIC_ADDRESS, family: 4 }], aliases: [] }),
      validateDnssec: async ({ target }) => ({ report: secureReport(String(target)), zone: String(target), keys: [] }),
      probe: async ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('Fixture SMTP endpoint timed out after abort.'));
        }, { once: true });
      }),
      setTimer: (callback) => { callback(); return 1; },
      clearTimer: () => {},
    });

    assert.equal(aborted, true);
    assert.equal(review.endpoints[0]?.state, 'timed_out');
    assert.equal(review.endpoints[0]?.failure?.stage, 'smtp');
  });

  test('keeps an incomplete DANE comparison partial after TLSA validation', async () => {
    const dane = analyzeTlsaEvidence({
      serviceName: '_25._tcp.mx.example.test',
      dnssecState: 'validated',
      pkixValidationState: 'unavailable',
      records: [{ usage: 3, selector: 0, matchingType: 1, associationData: '00'.repeat(32) }],
    });
    assert.equal(dane.state, 'partial');
    const review = await collectMailTransportReview({
      schema: MAIL_TRANSPORT_INPUT_SCHEMA,
      version: 1,
      domain: 'example.test',
      mxHosts: ['mx.example.test'],
      policyContext: {},
    }, {
      resolver: PUBLIC_ADDRESS,
      trustAnchor: ANCHOR,
      ownedOrAuthorized: true,
      activeProbeAcknowledged: true,
    }, {
      now: () => 0,
      observedAt: () => OBSERVED_AT,
      resolveHost: async () => ({ addresses: [{ address: PUBLIC_ADDRESS, family: 4 }], aliases: [] }),
      validateDnssec: async ({ target }) => ({ report: secureReport(String(target)), zone: String(target), keys: [] }),
      probe: async ({ address }) => probeResult(address),
      collectTlsaEvidence: async () => ({ state: 'validated', recordCount: 1, signatureState: 'validated', dane, limitations: [] }),
    });

    assert.equal(review.endpoints[0]?.tlsa.state, 'validated');
    assert.equal(review.endpoints[0]?.tlsa.dane?.state, 'partial');
    assert.equal(review.endpoints[0]?.state, 'partial');
    assert.equal(review.runState, 'partial');
  });

  test('does not begin an SMTP connection after the total-run budget expires', async () => {
    let clock = 0;
    let resolutions = 0;
    let probed = false;
    const review = await collectMailTransportReview({
      schema: MAIL_TRANSPORT_INPUT_SCHEMA,
      version: 1,
      domain: 'example.test',
      mxHosts: ['mx.example.test'],
      policyContext: {},
    }, {
      resolver: PUBLIC_ADDRESS,
      trustAnchor: ANCHOR,
      ownedOrAuthorized: true,
      activeProbeAcknowledged: true,
    }, {
      now: () => clock,
      observedAt: () => OBSERVED_AT,
      resolveHost: async () => {
        resolutions += 1;
        clock = resolutions === 1 ? 10_000 : 30_001;
        return { addresses: [{ address: PUBLIC_ADDRESS, family: 4 }], aliases: [] };
      },
      validateDnssec: async ({ target }) => ({ report: secureReport(String(target)), zone: String(target), keys: [] }),
      probe: async ({ address }) => {
        probed = true;
        return probeResult(address);
      },
    });

    assert.equal(probed, false);
    assert.equal(review.endpoints[0]?.state, 'timed_out');
    assert.equal(review.endpoints[0]?.failure?.stage, 'smtp');
    assert.match(review.endpoints[0]?.failure?.detail ?? '', /total run timed out/u);
  });
});
