import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';
import {
  DNSSEC_CHAIN_SCHEMA,
  type DnssecChainReport,
} from '../lib/dnssec-chain-validation.mts';
import {
  MAIL_TRANSPORT_REVIEW_SCHEMA,
  type MailTransportReview,
} from '../lib/smtp-transport-review.mts';

const OBSERVED_AT = '2026-08-11T00:00:00.000Z';
const PUBLIC_ADDRESS = '93.184.216.34';

function capture() {
  let output = '';
  return { stream: { write(chunk: string) { output += chunk; } }, value: () => output };
}

function dnssecReport(state: DnssecChainReport['state'] = 'secure'): DnssecChainReport {
  return {
    schema: DNSSEC_CHAIN_SCHEMA,
    version: 1,
    state,
    target: 'example.test',
    observedAt: OBSERVED_AT,
    resolver: { address: PUBLIC_ADDRESS, port: 53 },
    trustAnchor: { zone: '.', source: 'Fixture anchor', reviewedAt: OBSERVED_AT, dsRecordCount: 1 },
    validatedZone: state === 'secure' ? 'example.test' : null,
    delegations: [],
    completeness: state === 'secure' ? 'complete' : 'partial',
    transport: { state: 'complete', queryCount: 1, responseBytes: 100, queryLimit: 32, responseByteLimit: 524288, totalTimeoutMs: 15000 },
    failure: state === 'secure' ? null : { kind: 'validation', stage: 'fixture', detail: 'Fixture validation failure.' },
    limitations: ['Fixture limitation.'],
  };
}

function mailReview(): MailTransportReview {
  return {
    schema: MAIL_TRANSPORT_REVIEW_SCHEMA,
    version: 1,
    generatedAt: OBSERVED_AT,
    domain: 'example.test',
    runState: 'complete',
    authorization: { ownedOrAuthorized: true, activeProbeAcknowledged: true },
    resolver: { address: PUBLIC_ADDRESS, port: 53 },
    trustAnchor: { zone: '.', source: 'Fixture anchor', reviewedAt: OBSERVED_AT },
    policyContext: {
      mtaSts: { state: 'unavailable', source: null, observedAt: null, completeness: 'unavailable' },
      tlsRpt: { state: 'unavailable', source: null, observedAt: null, completeness: 'unavailable' },
    },
    endpoints: [],
    relationships: [],
    bounds: {
      targets: 0, targetLimit: 3, concurrency: 1, dnsQueries: 0, dnsQueryLimit: 32, dnsResponseBytes: 0, dnsResponseByteLimit: 524288,
      smtpResponseByteLimitPerTarget: 16384, smtpReplyLineLimitPerTarget: 64, smtpLineByteLimit: 1000,
      smtpCapabilityLimitPerTarget: 32, addressCandidateLimitPerResolution: 16, dnsAliasLimitPerResolution: 4,
      certificateByteLimitPerTarget: 262144, connectionsPerTarget: 1,
      endpointTimeoutMs: 8000, totalTimeoutMs: 30000, retries: 0,
    },
    limitations: ['Fixture limitation.'],
  };
}

describe('isolated cryptographic and mail CLI actions', () => {
  test('parses mandatory resolver, trust-anchor, and authorization acknowledgements', () => {
    assert.deepEqual(parseCliArguments([
      'dnssec-validate', 'example.test', '--resolver', PUBLIC_ADDRESS,
      '--trust-anchor', 'anchor.json', '--owned-or-authorized', '--json',
    ]), {
      action: 'dnssec-validate', target: 'example.test', resolver: PUBLIC_ADDRESS,
      trustAnchorSource: 'anchor.json', ownedOrAuthorized: true,
      output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments([
      'mail-transport', 'mail.json', '--resolver', PUBLIC_ADDRESS,
      '--trust-anchor', 'anchor.json', '--owned-or-authorized', '--active-probe',
    ]), {
      action: 'mail-transport', source: 'mail.json', resolver: PUBLIC_ADDRESS,
      trustAnchorSource: 'anchor.json', ownedOrAuthorized: true, activeProbeAcknowledged: true,
      output: 'terminal', quiet: false, color: true,
    });
    assert.throws(() => parseCliArguments([
      'dnssec-validate', 'example.test', '--resolver', PUBLIC_ADDRESS, '--trust-anchor', 'anchor.json',
    ]), /owned-or-authorized/u);
    assert.throws(() => parseCliArguments([
      'mail-transport', '--resolver', PUBLIC_ADDRESS, '--trust-anchor', 'anchor.json', '--owned-or-authorized',
    ]), /active-probe/u);
  });

  test('runs DNSSEC validation only after the explicit gate and preserves non-secure exit state', async () => {
    const stdout = capture();
    const received: Record<string, unknown>[] = [];
    const baseArgs = [
      'dnssec-validate', 'example.test', '--resolver', PUBLIC_ADDRESS,
      '--trust-anchor', 'anchor.json', '--owned-or-authorized', '--json',
    ];
    const code = await runCli(baseArgs, {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => OBSERVED_AT,
      readTrustAnchorInput: async () => '{"fixture":true}',
      validateDnssecChain: async (input) => {
        received.push(input as unknown as Record<string, unknown>);
        return dnssecReport();
      },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(received[0]?.ownedOrAuthorized, true);
    assert.equal(received[0]?.resolver, PUBLIC_ADDRESS);
    assert.equal(JSON.parse(stdout.value()).state, 'secure');

    const partial = await runCli(baseArgs, {
      stdout: capture().stream,
      stderr: capture().stream,
      now: () => OBSERVED_AT,
      readTrustAnchorInput: async () => '{}',
      validateDnssecChain: async () => dnssecReport('bogus'),
    });
    assert.equal(partial, EXIT_CODES.PARTIAL_FAILURE);
  });

  test('passes both active mail acknowledgements and bounded local inputs to the collector', async () => {
    const stdout = capture();
    const receivedOptions: Record<string, unknown>[] = [];
    const code = await runCli([
      'mail-transport', 'mail.json', '--resolver', PUBLIC_ADDRESS,
      '--trust-anchor', 'anchor.json', '--owned-or-authorized', '--active-probe', '--json',
    ], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => OBSERVED_AT,
      readMailTransportInput: async () => '{"fixture":true}',
      readTrustAnchorInput: async () => '{"anchor":true}',
      collectMailTransportReview: async (_input, options) => {
        receivedOptions.push(options as unknown as Record<string, unknown>);
        return mailReview();
      },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(receivedOptions[0]?.ownedOrAuthorized, true);
    assert.equal(receivedOptions[0]?.activeProbeAcknowledged, true);
    assert.equal(JSON.parse(stdout.value()).schema, MAIL_TRANSPORT_REVIEW_SCHEMA);
  });
});
