import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { Socket } from 'node:net';
import type { PeerCertificate } from 'node:tls';
import { describe, test } from 'node:test';

import {
  DNSSEC_CHAIN_SCHEMA,
  DNSSEC_TRUST_ANCHOR_SCHEMA,
  DNS_TYPE_A,
  DNS_TYPE_AAAA,
  DNS_TYPE_CNAME,
  DnssecQuerySession,
  type DnssecChainReport,
} from '../lib/dnssec-chain-validation.mts';
import {
  EHLO_COMMAND,
  MAIL_TRANSPORT_INPUT_SCHEMA,
  STARTTLS_COMMAND,
  certificateObservation,
  collectMailTransportReview,
  normalizeSmtpReply,
  resolveSelectedHost,
  runSmtpConversation,
  smtpStartTlsOptions,
  smtpCapabilities,
  type SmtpConversationConnection,
  type SmtpConversationResult,
} from '../lib/smtp-transport-review.mts';
import { analyzeTlsaEvidence } from '../lib/tlsa-evidence.mts';

const OBSERVED_AT = '2026-08-11T00:00:00.000Z';
const PUBLIC_ADDRESS = '93.184.216.34';
const ALTERNATE_PUBLIC_ADDRESS = '93.184.216.35';
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

function wireName(name: string): Buffer {
  return Buffer.concat([...name.split('.').flatMap((label) => {
    const bytes = Buffer.from(label, 'ascii');
    return [Buffer.from([bytes.length]), bytes];
  }), Buffer.from([0])]);
}

function dnsResponse(query: Buffer, name: string, type: number, answers: readonly Readonly<{ owner: string; type: number; rdata: Buffer }>[]): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(query.readUInt16BE(0), 0);
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answers.length, 6);
  const question = Buffer.concat([wireName(name), Buffer.from([type >> 8, type & 0xff, 0, 1])]);
  const records = answers.map((answer) => {
    const recordHeader = Buffer.alloc(10);
    recordHeader.writeUInt16BE(answer.type, 0);
    recordHeader.writeUInt16BE(1, 2);
    recordHeader.writeUInt32BE(60, 4);
    recordHeader.writeUInt16BE(answer.rdata.length, 8);
    return Buffer.concat([wireName(answer.owner), recordHeader, answer.rdata]);
  });
  return Buffer.concat([header, question, ...records]);
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
    assert.equal(connectionOptions.socket, socket);
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

    const invalidPath = certificateObservation('login.example.test', {
      peerCertificate,
      authorized: false,
      authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      protocol: 'TLSv1.3',
      cipherName: 'FIXTURE-CIPHER',
      remoteAddress: PUBLIC_ADDRESS,
    });
    assert.equal(invalidPath.observation.state, 'observed');
    assert.equal(invalidPath.observation.pkixState, 'failed');
    assert.equal(invalidPath.observation.identityState, 'aligned');
    assert.equal(invalidPath.observation.authorizationError, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
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
    assert.deepEqual(review.endpoints[0]?.address, { value: PUBLIC_ADDRESS, family: 4, state: 'connected' });
    assert.equal(review.endpoints[0]?.addressAuthentication.state, 'not_evaluated');
    assert.equal(review.endpoints[0]?.resolution.state, 'public_revalidated');
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
    assert.deepEqual(review.endpoints[0]?.address, { value: null, family: null, state: 'unavailable' });
    assert.equal(review.endpoints[0]?.addressAuthentication.state, 'unavailable');
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
    assert.equal(review.endpoints[0]?.address.state, 'revalidated');
    assert.equal(review.endpoints[0]?.resolution.state, 'public_revalidated');
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
    assert.equal(review.endpoints[0]?.address.state, 'revalidated');
  });

  test('does not promote selected DNS candidates when DNSSEC or fresh revalidation fails', async () => {
    const input = {
      schema: MAIL_TRANSPORT_INPUT_SCHEMA, version: 1, domain: 'example.test',
      mxHosts: ['mx1.example.test', 'mx2.example.test'], policyContext: {},
    };
    let calls = 0;
    let probed = false;
    const review = await collectMailTransportReview(input, {
      resolver: PUBLIC_ADDRESS, trustAnchor: ANCHOR, ownedOrAuthorized: true, activeProbeAcknowledged: true,
    }, {
      now: () => 0,
      observedAt: () => OBSERVED_AT,
      resolveHost: async () => {
        calls += 1;
        return { addresses: [{ address: calls === 3 ? PUBLIC_ADDRESS : ALTERNATE_PUBLIC_ADDRESS, family: 4 }], aliases: [] };
      },
      validateDnssec: async ({ target }) => {
        if (String(target).startsWith('mx1')) throw new Error('Fixture DNSSEC validation failed.');
        return { report: secureReport(String(target)), zone: String(target), keys: [] };
      },
      probe: async ({ address }) => { probed = true; return probeResult(address); },
    });

    assert.equal(probed, false);
    assert.deepEqual(review.endpoints.map((endpoint) => endpoint.address.state), ['selected', 'selected']);
    assert.deepEqual(review.endpoints.map((endpoint) => endpoint.resolution.state), ['failed', 'failed']);
    assert.deepEqual(review.endpoints.map((endpoint) => endpoint.failure?.stage), ['dnssec', 'revalidation']);
    assert.equal(review.relationships.length, 0, 'Unconnected selected addresses must never create connection relationships.');
  });

  test('requires the probe and STARTTLS socket to remain pinned before retaining endpoint evidence', async () => {
    const input = {
      schema: MAIL_TRANSPORT_INPUT_SCHEMA, version: 1, domain: 'example.test',
      mxHosts: ['mx1.example.test', 'mx2.example.test'], policyContext: {},
    };
    const review = await collectMailTransportReview(input, {
      resolver: PUBLIC_ADDRESS, trustAnchor: ANCHOR, ownedOrAuthorized: true, activeProbeAcknowledged: true,
    }, {
      now: () => 0,
      observedAt: () => OBSERVED_AT,
      resolveHost: async () => ({ addresses: [{ address: PUBLIC_ADDRESS, family: 4 }], aliases: [] }),
      validateDnssec: async ({ target }) => ({ report: secureReport(String(target)), zone: String(target), keys: [] }),
      probe: async ({ hostname, address }) => hostname.startsWith('mx1')
        ? probeResult(ALTERNATE_PUBLIC_ADDRESS)
        : { ...probeResult(address), starttlsState: 'negotiated', tls: { peerCertificate: null, authorized: null, authorizationError: null, protocol: 'TLSv1.3', cipherName: 'FIXTURE-CIPHER', remoteAddress: ALTERNATE_PUBLIC_ADDRESS } },
    });

    assert.equal(review.endpoints[0]?.address.state, 'revalidated');
    assert.equal(review.endpoints[0]?.smtp.state, 'unavailable');
    assert.equal(review.endpoints[1]?.address.state, 'connected');
    assert.equal(review.endpoints[1]?.smtp.state, 'observed');
    assert.match(review.endpoints[1]?.failure?.detail ?? '', /STARTTLS connection did not remain pinned/u);
  });

  test('retains confirmed SMTP provenance when later TLSA collection is unavailable', async () => {
    const review = await collectMailTransportReview({
      schema: MAIL_TRANSPORT_INPUT_SCHEMA, version: 1, domain: 'example.test', mxHosts: ['mx.example.test'], policyContext: {},
    }, {
      resolver: PUBLIC_ADDRESS, trustAnchor: ANCHOR, ownedOrAuthorized: true, activeProbeAcknowledged: true,
    }, {
      now: () => 0,
      observedAt: () => OBSERVED_AT,
      resolveHost: async () => ({ addresses: [{ address: PUBLIC_ADDRESS, family: 4 }], aliases: [] }),
      validateDnssec: async ({ target }) => ({ report: secureReport(String(target)), zone: String(target), keys: [] }),
      probe: async ({ address }) => probeResult(address),
      collectTlsaEvidence: async () => { throw new Error('Fixture TLSA collection failed.'); },
    });

    assert.equal(review.endpoints[0]?.state, 'partial');
    assert.equal(review.endpoints[0]?.address.state, 'connected');
    assert.equal(review.endpoints[0]?.smtp.state, 'observed');
    assert.equal(review.endpoints[0]?.failure?.stage, 'tlsa');
  });

  test('resolves bounded fixture-only CNAME chains and rejects reserved results', async () => {
    const steps = [
      { name: 'mx.example.test', type: DNS_TYPE_A, answers: [{ owner: 'mx.example.test', type: DNS_TYPE_CNAME, rdata: wireName('edge.example.test') }] },
      { name: 'mx.example.test', type: DNS_TYPE_AAAA, answers: [] },
      { name: 'edge.example.test', type: DNS_TYPE_A, answers: [{ owner: 'edge.example.test', type: DNS_TYPE_A, rdata: Buffer.from(PUBLIC_ADDRESS.split('.').map(Number)) }] },
      { name: 'edge.example.test', type: DNS_TYPE_AAAA, answers: [] },
    ];
    let index = 0;
    const session = new DnssecQuerySession({
      resolver: { address: PUBLIC_ADDRESS, port: 53, family: 4 },
      transactionId: () => 7,
      now: () => 0,
      exchange: async (query) => {
        const step = steps[index++];
        assert.ok(step);
        return dnsResponse(query, step.name, step.type, step.answers);
      },
    });
    assert.deepEqual(await resolveSelectedHost(session, 'mx.example.test'), {
      addresses: [{ address: PUBLIC_ADDRESS, family: 4 }], aliases: ['edge.example.test'],
    });

    let reservedQuery = 0;
    const reservedSession = new DnssecQuerySession({
      resolver: { address: PUBLIC_ADDRESS, port: 53, family: 4 }, transactionId: () => 8, now: () => 0,
      exchange: async (query) => {
        reservedQuery += 1;
        return reservedQuery === 1
          ? dnsResponse(query, 'mx.example.test', DNS_TYPE_A, [{ owner: 'mx.example.test', type: DNS_TYPE_A, rdata: Buffer.from([192, 0, 2, 1]) }])
          : dnsResponse(query, 'mx.example.test', DNS_TYPE_AAAA, []);
      },
    });
    await assert.rejects(() => resolveSelectedHost(reservedSession, 'mx.example.test'), /private or reserved/u);
  });
});
