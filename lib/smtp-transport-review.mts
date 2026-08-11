// Explicit, authorised SMTP transport review for analyst-selected MX hosts.
// This module is deliberately disconnected from Lookup, Bulk, monitoring,
// and recipes. It resolves only selected hosts through one caller-selected
// public resolver, revalidates and pins one public address, issues EHLO and
// optionally STARTTLS, and never authenticates, enumerates recipients, tests
// relay, or transmits a message.

import { Buffer } from 'node:buffer';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';

import {
  DNS_TYPE_A,
  DNS_TYPE_AAAA,
  DNS_TYPE_CNAME,
  DNS_TYPE_TLSA,
  DnssecQuerySession,
  collectValidatedRrset,
  normalizeDnsName,
  normalizeResolverEndpoint,
  parseDnssecTrustAnchor,
  validateDnssecChainWithContext,
  type AddressData,
  type DnsWireRecord,
  type DnssecChainReport,
  type DnssecQuerySessionOptions,
  type DnssecTrustAnchor,
  type NameData,
  type TlsaData,
} from './dnssec-chain-validation.mts';
import { isPrivateAddress } from './safe-fetch.mts';
import { analyzeTlsaEvidence, type TlsaEvidenceReport } from './tlsa-evidence.mts';

const MAIL_TRANSPORT_INPUT_SCHEMA = 'whoisleuth.mail-transport.input';
const MAIL_TRANSPORT_INPUT_VERSION = 1;
const MAIL_TRANSPORT_REVIEW_SCHEMA = 'whoisleuth.cli.mail-transport-review';
const MAIL_TRANSPORT_REVIEW_VERSION = 1;
const MAX_MAIL_TRANSPORT_INPUT_BYTES = 256 * 1024;
const MAX_MAIL_TRANSPORT_TARGETS = 3;
const MAX_MAIL_TRANSPORT_CONCURRENCY = 1;
const MAX_MAIL_TRANSPORT_ADDRESS_CANDIDATES = 16;
const MAX_MAIL_TRANSPORT_DNS_ALIASES = 4;
const MAX_SMTP_RESPONSE_BYTES = 16 * 1024;
const MAX_SMTP_REPLY_LINES = 64;
const MAX_SMTP_LINE_BYTES = 1_000;
const MAX_SMTP_CAPABILITIES = 32;
const MAX_SMTP_CERTIFICATE_BYTES = 256 * 1024;
const SMTP_ENDPOINT_TIMEOUT_MS = 8_000;
const MAIL_TRANSPORT_TOTAL_TIMEOUT_MS = 30_000;
const SMTP_PORT = 25;
const EHLO_COMMAND = 'EHLO whoisleuth.invalid\r\n';
const STARTTLS_COMMAND = 'STARTTLS\r\n';
const MAX_ERROR_LENGTH = 240;

type UnknownRecord = Record<string, unknown>;
type PolicyCompleteness = 'complete' | 'partial' | 'unavailable';
type PolicyContext = Readonly<{
  mtaSts: Readonly<{ state: string; source: string | null; observedAt: string | null; completeness: PolicyCompleteness }>;
  tlsRpt: Readonly<{ state: string; source: string | null; observedAt: string | null; completeness: PolicyCompleteness }>;
}>;

type MailTransportInput = Readonly<{
  schema: typeof MAIL_TRANSPORT_INPUT_SCHEMA;
  version: typeof MAIL_TRANSPORT_INPUT_VERSION;
  domain: string;
  mxHosts: readonly string[];
  policyContext: PolicyContext;
}>;

type SmtpReply = Readonly<{
  code: number;
  lines: readonly string[];
  bytes: number;
  sha256: string;
}>;

type RawTlsEvidence = Readonly<{
  peerCertificate: unknown;
  authorized: boolean | null;
  authorizationError: string | null;
  protocol: string | null;
  cipherName: string | null;
  remoteAddress: string | null;
}>;

type SmtpConversationConnection = {
  remoteAddress: string | null;
  readReply(): Promise<SmtpReply>;
  write(command: typeof EHLO_COMMAND | typeof STARTTLS_COMMAND): Promise<void> | void;
  startTls(hostname: string): Promise<RawTlsEvidence>;
  diagnostics(): { bytesRead: number; lineCount: number };
  destroy(): void;
};

type SmtpConversationResult = Readonly<{
  connectedAddress: string | null;
  greeting: SmtpReply;
  ehlo: SmtpReply | null;
  capabilities: readonly string[];
  starttlsAdvertised: boolean;
  starttlsReply: SmtpReply | null;
  starttlsState: 'negotiated' | 'not_advertised' | 'rejected' | 'failed';
  tls: RawTlsEvidence | null;
  bytesRead: number;
  lineCount: number;
}>;

type SmtpProbe = (options: Readonly<{
  hostname: string;
  address: string;
  family: 4 | 6;
  timeoutMs: number;
  signal: AbortSignal;
}>) => Promise<SmtpConversationResult>;

type ResolvedMailHost = Readonly<{
  addresses: readonly Readonly<{ address: string; family: 4 | 6 }>[];
  aliases: readonly string[];
}>;

type MailTransportDependencies = Readonly<{
  dnsSessionOptions?: Omit<DnssecQuerySessionOptions, 'resolver'>;
  probe?: SmtpProbe;
  resolveHost?: (session: DnssecQuerySession, host: string) => Promise<ResolvedMailHost>;
  validateDnssec?: typeof validateDnssecChainWithContext;
  collectTlsaEvidence?: typeof collectTlsa;
  now?: () => number;
  observedAt?: () => string;
  setTimer?: (callback: () => void, milliseconds: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}>;

type CertificateObservation = Readonly<{
  state: 'observed' | 'unavailable';
  sha256: string | null;
  spkiSha256: string | null;
  protocol: string | null;
  cipherName: string | null;
  pkixState: 'validated' | 'failed' | 'unavailable';
  identityState: 'aligned' | 'misaligned' | 'unavailable';
  authorizationError: string | null;
  identityError: string | null;
}>;

type TlsaObservation = Readonly<{
  state: 'validated' | 'not_published' | 'insecure' | 'bogus' | 'indeterminate' | 'timed_out' | 'unsupported' | 'unavailable';
  recordCount: number;
  signatureState: string;
  dane: TlsaEvidenceReport | null;
  limitations: readonly string[];
}>;

type MailTransportEndpoint = Readonly<{
  host: string;
  observedAt: string;
  state: 'complete' | 'partial' | 'timed_out' | 'unavailable';
  address: Readonly<{
    value: string | null;
    family: 4 | 6 | null;
    state: 'unavailable' | 'selected' | 'revalidated' | 'connected';
  }>;
  addressAuthentication: Readonly<{
    state: 'not_evaluated' | 'unavailable';
    detail: string;
  }>;
  resolution: Readonly<{
    state: 'public_revalidated' | 'failed' | 'timed_out';
    initialAddressCount: number;
    revalidatedAddressCount: number;
    aliasCount: number;
  }>;
  smtp: Readonly<{
    state: 'observed' | 'rejected' | 'timed_out' | 'unavailable';
    greetingCode: number | null;
    greetingSha256: string | null;
    capabilities: readonly string[];
    starttlsAdvertised: boolean | null;
    responseBytes: number;
    responseLines: number;
  }>;
  starttls: Readonly<{ state: SmtpConversationResult['starttlsState'] | 'timed_out' | 'unavailable' }>;
  certificate: CertificateObservation;
  dnssec: DnssecChainReport | null;
  tlsa: TlsaObservation;
  failure: Readonly<{ stage: string; detail: string }> | null;
  limitations: readonly string[];
}>;

type MailTransportRelationship = Readonly<{
  basis: 'connected_address' | 'greeting_sha256' | 'certificate_sha256';
  value: string;
  endpoints: readonly string[];
  interpretation: 'review_lead';
  limitation: string;
}>;

type MailTransportReview = Readonly<{
  schema: typeof MAIL_TRANSPORT_REVIEW_SCHEMA;
  version: typeof MAIL_TRANSPORT_REVIEW_VERSION;
  generatedAt: string;
  domain: string;
  runState: 'complete' | 'partial' | 'unavailable';
  authorization: Readonly<{ ownedOrAuthorized: true; activeProbeAcknowledged: true }>;
  resolver: Readonly<{ address: string; port: 53 }>;
  trustAnchor: Readonly<{ zone: string; source: string; reviewedAt: string }>;
  policyContext: PolicyContext;
  endpoints: readonly MailTransportEndpoint[];
  relationships: readonly MailTransportRelationship[];
  bounds: Readonly<{
    targets: number;
    targetLimit: number;
    concurrency: 1;
    dnsQueries: number;
    dnsQueryLimit: number;
    dnsResponseBytes: number;
    dnsResponseByteLimit: number;
    smtpResponseByteLimitPerTarget: number;
    smtpReplyLineLimitPerTarget: number;
    smtpLineByteLimit: number;
    smtpCapabilityLimitPerTarget: number;
    addressCandidateLimitPerResolution: number;
    dnsAliasLimitPerResolution: number;
    certificateByteLimitPerTarget: number;
    connectionsPerTarget: 1;
    endpointTimeoutMs: number;
    totalTimeoutMs: number;
    retries: 0;
  }>;
  limitations: readonly string[];
}>;

function boundedError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value || 'Mail transport review failed');
  return message.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, MAX_ERROR_LENGTH) || 'Mail transport review failed';
}

function exactRecord(value: unknown, keys: ReadonlySet<string>, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be one object.`);
  const record = value as UnknownRecord;
  const unexpected = Object.keys(record).find((key) => !keys.has(key));
  if (unexpected) throw new TypeError(`${label} contains unsupported field "${unexpected}".`);
  return record;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) throw new TypeError(`${label} must be one ISO-compatible timestamp.`);
  return new Date(value).toISOString();
}

function text(value: unknown, label: string, maximum = 160): string {
  if (typeof value !== 'string' || value.length > maximum * 4) throw new TypeError(`${label} must be bounded text.`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > maximum) throw new TypeError(`${label} must contain from 1 to ${maximum} characters.`);
  return normalized;
}

function policyEvidence(value: unknown, label: 'mtaSts' | 'tlsRpt') {
  if (value === null || value === undefined) return Object.freeze({ state: 'unavailable', source: null, observedAt: null, completeness: 'unavailable' as const });
  const record = exactRecord(value, new Set(['state', 'source', 'observedAt', 'completeness']), `policyContext.${label}`);
  const allowedStates = label === 'mtaSts'
    ? ['enforce', 'testing', 'none', 'not_published', 'partial', 'unavailable']
    : ['published', 'not_published', 'partial', 'unavailable'];
  const state = text(record.state, `policyContext.${label}.state`, 32);
  const completeness = text(record.completeness, `policyContext.${label}.completeness`, 16);
  if (!allowedStates.includes(state) || !['complete', 'partial', 'unavailable'].includes(completeness)) throw new TypeError(`policyContext.${label} has an unsupported state or completeness.`);
  const source = record.source === null ? null : text(record.source, `policyContext.${label}.source`, 160);
  const observedAt = record.observedAt === null ? null : timestamp(record.observedAt, `policyContext.${label}.observedAt`);
  const unavailable = completeness === 'unavailable';
  if ((unavailable && (source !== null || observedAt !== null)) || (!unavailable && (source === null || observedAt === null))) {
    throw new TypeError(`policyContext.${label} unavailable evidence must omit source and time; retained evidence requires both.`);
  }
  return Object.freeze({ state, source, observedAt, completeness: completeness as PolicyCompleteness });
}

function parseMailTransportInput(value: unknown): MailTransportInput {
  const source = typeof value === 'string' ? (() => {
    if (Buffer.byteLength(value, 'utf8') > MAX_MAIL_TRANSPORT_INPUT_BYTES) throw new TypeError(`Mail transport input is limited to ${MAX_MAIL_TRANSPORT_INPUT_BYTES} bytes.`);
    try { return JSON.parse(value); } catch { throw new TypeError('Mail transport input is not valid JSON.'); }
  })() : value;
  const input = exactRecord(source, new Set(['schema', 'version', 'domain', 'mxHosts', 'policyContext']), 'Mail transport input');
  if (input.schema !== MAIL_TRANSPORT_INPUT_SCHEMA || input.version !== MAIL_TRANSPORT_INPUT_VERSION) {
    throw new TypeError(`Mail transport input must use ${MAIL_TRANSPORT_INPUT_SCHEMA} version ${MAIL_TRANSPORT_INPUT_VERSION}.`);
  }
  const domain = normalizeDnsName(input.domain);
  if (!domain || !Array.isArray(input.mxHosts) || input.mxHosts.length < 1 || input.mxHosts.length > MAX_MAIL_TRANSPORT_TARGETS) {
    throw new TypeError(`Mail transport input requires one domain and 1 to ${MAX_MAIL_TRANSPORT_TARGETS} selected MX hosts.`);
  }
  const mxHosts = input.mxHosts.map((host) => normalizeDnsName(host));
  if (mxHosts.some((host) => host === null) || new Set(mxHosts).size !== mxHosts.length) throw new TypeError('Mail transport MX hosts must be valid and unique.');
  const policy = input.policyContext === undefined || input.policyContext === null
    ? {}
    : exactRecord(input.policyContext, new Set(['mtaSts', 'tlsRpt']), 'policyContext');
  return Object.freeze({
    schema: MAIL_TRANSPORT_INPUT_SCHEMA,
    version: MAIL_TRANSPORT_INPUT_VERSION,
    domain,
    mxHosts: Object.freeze(mxHosts as string[]),
    policyContext: Object.freeze({ mtaSts: policyEvidence(policy.mtaSts, 'mtaSts'), tlsRpt: policyEvidence(policy.tlsRpt, 'tlsRpt') }),
  });
}

function normalizeSmtpReply(linesValue: unknown): SmtpReply {
  if (!Array.isArray(linesValue) || linesValue.length < 1 || linesValue.length > MAX_SMTP_REPLY_LINES) throw new Error('SMTP reply line count is invalid.');
  const lines = linesValue.map((line) => {
    if (typeof line !== 'string' || Buffer.byteLength(line, 'utf8') > MAX_SMTP_LINE_BYTES || /[^\u0009\u0020-\u007e]/u.test(line)) {
      throw new Error('SMTP reply contains an invalid or oversized line.');
    }
    return line;
  });
  const bytes = lines.reduce((total, line) => total + Buffer.byteLength(line, 'utf8') + 2, 0);
  if (bytes > MAX_SMTP_RESPONSE_BYTES) throw new Error('SMTP reply exceeds the response-byte limit.');
  const first = /^(\d{3})([- ])(.*)$/u.exec(lines[0] as string);
  if (!first) throw new Error('SMTP reply does not begin with a three-digit status.');
  const code = Number(first[1]);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\d{3})([- ])(.*)$/u.exec(lines[index] as string);
    if (!match || Number(match[1]) !== code || (index < lines.length - 1 && match[2] !== '-') || (index === lines.length - 1 && match[2] !== ' ')) {
      throw new Error('SMTP multiline reply framing is invalid.');
    }
  }
  const sha256 = crypto.createHash('sha256').update(`${lines.join('\r\n')}\r\n`, 'ascii').digest('hex');
  return Object.freeze({ code, lines: Object.freeze(lines), bytes, sha256 });
}

function smtpCapabilities(reply: SmtpReply | null): readonly string[] {
  if (!reply || reply.code !== 250) return Object.freeze([]);
  const output: string[] = [];
  for (const line of reply.lines.slice(1)) {
    const token = line.slice(4).trim().split(/\s+/u)[0]?.toUpperCase() || '';
    if (!/^[A-Z0-9][A-Z0-9-]{0,31}$/u.test(token) || output.includes(token)) continue;
    if (output.length >= MAX_SMTP_CAPABILITIES) break;
    output.push(token);
  }
  return Object.freeze(output.sort());
}

async function runSmtpConversation(hostname: string, connection: SmtpConversationConnection): Promise<SmtpConversationResult> {
  try {
    const greeting = await connection.readReply();
    if (greeting.code !== 220) {
      const diagnostics = connection.diagnostics();
      return Object.freeze({ connectedAddress: connection.remoteAddress, greeting, ehlo: null, capabilities: Object.freeze([]), starttlsAdvertised: false, starttlsReply: null, starttlsState: 'rejected', tls: null, ...diagnostics });
    }
    await connection.write(EHLO_COMMAND);
    const ehlo = await connection.readReply();
    const capabilities = smtpCapabilities(ehlo);
    const starttlsAdvertised = capabilities.includes('STARTTLS');
    if (!starttlsAdvertised) {
      const diagnostics = connection.diagnostics();
      return Object.freeze({ connectedAddress: connection.remoteAddress, greeting, ehlo, capabilities, starttlsAdvertised, starttlsReply: null, starttlsState: 'not_advertised', tls: null, ...diagnostics });
    }
    await connection.write(STARTTLS_COMMAND);
    const starttlsReply = await connection.readReply();
    if (starttlsReply.code !== 220) {
      const diagnostics = connection.diagnostics();
      return Object.freeze({ connectedAddress: connection.remoteAddress, greeting, ehlo, capabilities, starttlsAdvertised, starttlsReply, starttlsState: 'rejected', tls: null, ...diagnostics });
    }
    try {
      const tlsEvidence = await connection.startTls(hostname);
      const diagnostics = connection.diagnostics();
      return Object.freeze({ connectedAddress: connection.remoteAddress, greeting, ehlo, capabilities, starttlsAdvertised, starttlsReply, starttlsState: 'negotiated', tls: tlsEvidence, ...diagnostics });
    } catch {
      const diagnostics = connection.diagnostics();
      return Object.freeze({ connectedAddress: connection.remoteAddress, greeting, ehlo, capabilities, starttlsAdvertised, starttlsReply, starttlsState: 'failed', tls: null, ...diagnostics });
    }
  } finally {
    connection.destroy();
  }
}

class SocketReplyReader {
  #socket: net.Socket;
  #buffer = Buffer.alloc(0);
  #waiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  #endedError: Error | null = null;
  bytesRead = 0;
  lineCount = 0;

  constructor(socket: net.Socket) {
    this.#socket = socket;
    socket.on('data', (chunk: Buffer) => this.#receive(Buffer.from(chunk)));
    socket.once('error', (error) => this.#fail(error));
    socket.once('end', () => this.#fail(new Error('SMTP server closed the connection before completing a reply.')));
    socket.once('timeout', () => this.#fail(new Error('SMTP transport timed out.')));
  }

  #receive(chunk: Buffer): void {
    if (this.#endedError) return;
    this.bytesRead += chunk.length;
    if (this.bytesRead > MAX_SMTP_RESPONSE_BYTES) return this.#fail(new Error('SMTP response exceeds the response-byte limit.'));
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    if (this.#buffer.length > MAX_SMTP_LINE_BYTES && this.#buffer.indexOf('\r\n') === -1) return this.#fail(new Error('SMTP response line exceeds the line-byte limit.'));
    this.#drain();
  }

  #drain(): void {
    while (this.#waiters.length) {
      const boundary = this.#buffer.indexOf('\r\n');
      if (boundary === -1) return;
      if (boundary > MAX_SMTP_LINE_BYTES) return this.#fail(new Error('SMTP response line exceeds the line-byte limit.'));
      const line = this.#buffer.subarray(0, boundary).toString('utf8');
      this.#buffer = this.#buffer.subarray(boundary + 2);
      this.lineCount += 1;
      if (this.lineCount > MAX_SMTP_REPLY_LINES) return this.#fail(new Error('SMTP response exceeds the line-count limit.'));
      this.#waiters.shift()?.resolve(line);
    }
  }

  #fail(error: Error): void {
    if (this.#endedError) return;
    this.#endedError = error;
    this.#socket.destroy();
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }

  readLine(): Promise<string> {
    if (this.#endedError) return Promise.reject(this.#endedError);
    return new Promise((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
      this.#drain();
    });
  }

  async readReply(): Promise<SmtpReply> {
    const lines: string[] = [];
    let code: string | null = null;
    while (lines.length < MAX_SMTP_REPLY_LINES) {
      const line = await this.readLine();
      lines.push(line);
      const match = /^(\d{3})([- ])/u.exec(line);
      if (!match) throw new Error('SMTP reply framing is invalid.');
      if (code === null) code = match[1] as string;
      if (match[1] !== code) throw new Error('SMTP multiline reply status changed unexpectedly.');
      if (match[2] === ' ') return normalizeSmtpReply(lines);
    }
    throw new Error('SMTP reply exceeds the line-count limit.');
  }

  release(): void {
    if (this.#waiters.length || this.#buffer.length) throw new Error('SMTP connection contained unexpected buffered bytes before STARTTLS.');
    this.#socket.removeAllListeners('data');
    this.#socket.removeAllListeners('error');
    this.#socket.removeAllListeners('end');
    this.#socket.removeAllListeners('timeout');
  }
}

function smtpStartTlsOptions(socket: net.Socket, hostname: string): tls.ConnectionOptions {
  return {
    socket,
    servername: hostname,
    rejectUnauthorized: false,
    // Keep CA-path authorization independent from the separately recorded
    // endpoint-identity comparison performed by certificateObservation().
    checkServerIdentity: () => undefined,
  };
}

async function defaultSmtpProbe(options: Parameters<SmtpProbe>[0]): Promise<SmtpConversationResult> {
  const socket = net.createConnection({ host: options.address, port: SMTP_PORT, family: options.family });
  socket.setTimeout(options.timeoutMs);
  const aborted = () => socket.destroy(new Error('SMTP endpoint review timed out.'));
  options.signal.addEventListener('abort', aborted, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.removeListener('connect', connected);
        socket.removeListener('error', failed);
        socket.removeListener('timeout', timedOut);
      };
      const connected = () => { cleanup(); resolve(); };
      const failed = (error: Error) => { cleanup(); socket.destroy(); reject(error); };
      const timedOut = () => { cleanup(); socket.destroy(); reject(new Error('SMTP connection timed out.')); };
      socket.once('connect', connected);
      socket.once('error', failed);
      socket.once('timeout', timedOut);
      if (options.signal.aborted) aborted();
    });
    const reader = new SocketReplyReader(socket);
    const connection: SmtpConversationConnection = {
      remoteAddress: socket.remoteAddress || null,
      readReply: () => reader.readReply(),
      write: (command) => new Promise<void>((resolve, reject) => socket.write(command, (error) => error ? reject(error) : resolve())),
      startTls: async (hostname) => {
        reader.release();
        const tlsSocket = tls.connect(smtpStartTlsOptions(socket, hostname));
        tlsSocket.setTimeout(options.timeoutMs);
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            tlsSocket.removeListener('secureConnect', secured);
            tlsSocket.removeListener('error', failed);
            tlsSocket.removeListener('timeout', timedOut);
          };
          const secured = () => { cleanup(); resolve(); };
          const failed = (error: Error) => { cleanup(); tlsSocket.destroy(); reject(error); };
          const timedOut = () => { cleanup(); tlsSocket.destroy(); reject(new Error('SMTP STARTTLS handshake timed out.')); };
          tlsSocket.once('secureConnect', secured);
          tlsSocket.once('error', failed);
          tlsSocket.once('timeout', timedOut);
        });
        const cipher = tlsSocket.getCipher();
        return Object.freeze({
          peerCertificate: tlsSocket.getPeerCertificate(false),
          authorized: typeof tlsSocket.authorized === 'boolean' ? tlsSocket.authorized : null,
          authorizationError: tlsSocket.authorizationError ? boundedError(tlsSocket.authorizationError) : null,
          protocol: tlsSocket.getProtocol(),
          cipherName: typeof cipher?.name === 'string' ? cipher.name.slice(0, 128) : null,
          remoteAddress: tlsSocket.remoteAddress || null,
        });
      },
      diagnostics: () => ({ bytesRead: reader.bytesRead, lineCount: reader.lineCount }),
      destroy: () => socket.destroy(),
    };
    return await runSmtpConversation(options.hostname, connection);
  } finally {
    options.signal.removeEventListener('abort', aborted);
    socket.destroy();
  }
}

async function resolveSelectedHost(session: DnssecQuerySession, host: string): Promise<ResolvedMailHost> {
  let current = host;
  const aliases: string[] = [];
  for (let depth = 0; depth <= MAX_MAIL_TRANSPORT_DNS_ALIASES; depth += 1) {
    const ipv4 = await session.query(current, DNS_TYPE_A, { fresh: true });
    const ipv6 = await session.query(current, DNS_TYPE_AAAA, { fresh: true });
    const combined = [...ipv4.records, ...ipv6.records];
    const addresses = combined.flatMap((record) => {
      if (record.owner !== current || (record.data.kind !== 'A' && record.data.kind !== 'AAAA')) return [];
      const data = record.data as AddressData;
      if (isPrivateAddress(data.address)) throw new Error('Selected MX host resolved to a private or reserved address.');
      return [{ address: data.address, family: data.kind === 'A' ? 4 as const : 6 as const }];
    });
    const uniqueAddresses = [...new Map(addresses.map((entry) => [`${entry.family}:${entry.address}`, entry])).values()];
    if (uniqueAddresses.length > MAX_MAIL_TRANSPORT_ADDRESS_CANDIDATES) throw new Error('Selected MX host exceeded the address-candidate bound.');
    if (uniqueAddresses.length) return { addresses: uniqueAddresses, aliases };
    const cnameTargets = [...new Set(combined.flatMap((record) => (
      record.owner === current && record.data.kind === 'CNAME' ? [(record.data as NameData).name] : []
    )))];
    if (cnameTargets.length !== 1) throw new Error('Selected MX host did not resolve to one bounded public address set.');
    const next = normalizeDnsName(cnameTargets[0]);
    if (!next || aliases.includes(next) || depth >= MAX_MAIL_TRANSPORT_DNS_ALIASES) throw new Error('Selected MX host exceeded the DNS alias bound.');
    aliases.push(next);
    current = next;
  }
  throw new Error('Selected MX host exceeded the DNS alias bound.');
}

function certificateObservation(host: string, tlsEvidence: RawTlsEvidence | null): { observation: CertificateObservation; certificateDer: Buffer | null; spkiDer: Buffer | null } {
  if (!tlsEvidence || !tlsEvidence.peerCertificate || typeof tlsEvidence.peerCertificate !== 'object') {
    return {
      observation: Object.freeze({ state: 'unavailable', sha256: null, spkiSha256: null, protocol: null, cipherName: null, pkixState: 'unavailable', identityState: 'unavailable', authorizationError: null, identityError: null }),
      certificateDer: null,
      spkiDer: null,
    };
  }
  const peer = tlsEvidence.peerCertificate as tls.PeerCertificate & { raw?: Buffer };
  const raw = Buffer.isBuffer(peer.raw) && peer.raw.length > 0 && peer.raw.length <= MAX_SMTP_CERTIFICATE_BYTES ? Buffer.from(peer.raw) : null;
  let spkiDer: Buffer | null = null;
  if (raw) {
    try { spkiDer = Buffer.from(new crypto.X509Certificate(raw).publicKey.export({ format: 'der', type: 'spki' })); } catch { spkiDer = null; }
  }
  let identityError: Error | null = null;
  if (raw) {
    try { identityError = tls.checkServerIdentity(host, peer) || null; } catch (error) { identityError = error instanceof Error ? error : new Error('Certificate identity comparison failed.'); }
  }
  const pkixState = tlsEvidence.authorized === true ? 'validated' : tlsEvidence.authorized === false ? 'failed' : 'unavailable';
  const identityState = raw ? identityError ? 'misaligned' : 'aligned' : 'unavailable';
  return {
    observation: Object.freeze({
      state: raw ? 'observed' : 'unavailable',
      sha256: raw ? crypto.createHash('sha256').update(raw).digest('hex') : null,
      spkiSha256: spkiDer ? crypto.createHash('sha256').update(spkiDer).digest('hex') : null,
      protocol: typeof tlsEvidence.protocol === 'string' ? tlsEvidence.protocol.slice(0, 32) : null,
      cipherName: typeof tlsEvidence.cipherName === 'string' ? tlsEvidence.cipherName.slice(0, 128) : null,
      pkixState,
      identityState,
      authorizationError: tlsEvidence.authorizationError ? boundedError(tlsEvidence.authorizationError) : null,
      identityError: identityError ? boundedError(identityError) : null,
    }),
    certificateDer: raw,
    spkiDer,
  };
}

function unavailableTlsa(state: TlsaObservation['state'], limitation: string): TlsaObservation {
  return Object.freeze({ state, recordCount: 0, signatureState: 'unavailable', dane: null, limitations: Object.freeze([limitation]) });
}

async function collectTlsa(
  session: DnssecQuerySession,
  host: string,
  dnssecContext: Awaited<ReturnType<typeof validateDnssecChainWithContext>>,
  certificate: ReturnType<typeof certificateObservation>,
  observedAt: string,
): Promise<TlsaObservation> {
  if (dnssecContext.report.state !== 'secure') {
    const mapped = ['insecure', 'bogus', 'indeterminate', 'timed_out', 'unsupported'].includes(dnssecContext.report.state)
      ? dnssecContext.report.state as TlsaObservation['state']
      : 'unavailable';
    return unavailableTlsa(mapped, `TLSA evidence was not treated as DANE because DNSSEC validation was ${dnssecContext.report.state}.`);
  }
  const serviceName = `_25._tcp.${host}`;
  try {
    const result = await collectValidatedRrset(session, dnssecContext, serviceName, DNS_TYPE_TLSA, observedAt);
    if (result.verification.state !== 'valid') {
      const state = result.verification.state === 'bogus' ? 'bogus' : result.verification.state === 'unsupported' ? 'unsupported' : 'indeterminate';
      return unavailableTlsa(state, result.verification.detail);
    }
    const records = result.records.filter((record): record is DnsWireRecord & { data: TlsaData } => record.data.kind === 'TLSA');
    if (!records.length) return unavailableTlsa('not_published', 'A validated DNSSEC denial showed no TLSA RRset for the selected SMTP service.');
    const dane = analyzeTlsaEvidence({
      serviceName,
      dnssecState: 'validated',
      pkixValidationState: certificate.observation.pkixState,
      records: records.map(({ data }) => ({ usage: data.usage, selector: data.selector, matchingType: data.matchingType, associationData: data.associationData.toString('hex') })),
      certificateDerBase64: certificate.certificateDer?.toString('base64'),
      spkiDerBase64: certificate.spkiDer?.toString('base64'),
    });
    return Object.freeze({
      state: 'validated',
      recordCount: records.length,
      signatureState: 'validated',
      dane,
      limitations: Object.freeze([
        'TLSA records were validated through the separately reported DNSSEC chain before certificate comparison.',
        'A TLSA association match is endpoint evidence only and does not establish successful message delivery, ownership, safety, or maliciousness.',
      ]),
    });
  } catch (error) {
    const timedOut = /timed out/iu.test(boundedError(error));
    return unavailableTlsa(timedOut ? 'timed_out' : 'indeterminate', boundedError(error));
  }
}

function addressObservation(
  selected: Readonly<{ address: string; family: 4 | 6 }> | null,
  state: MailTransportEndpoint['address']['state'],
): MailTransportEndpoint['address'] {
  return Object.freeze({ value: selected?.address ?? null, family: selected?.family ?? null, state });
}

function addressAuthentication(selected: Readonly<{ address: string; family: 4 | 6 }> | null): MailTransportEndpoint['addressAuthentication'] {
  return selected
    ? Object.freeze({
      state: 'not_evaluated' as const,
      detail: 'The selected A or AAAA RRset and any CNAME chain were not cryptographically validated; public-address revalidation is a separate transport control.',
    })
    : Object.freeze({ state: 'unavailable' as const, detail: 'No address candidate was retained for cryptographic authentication review.' });
}

function endpointLimitations(addressState: MailTransportEndpoint['address']['state']): readonly string[] {
  const addressLimitation = addressState === 'connected'
    ? 'The endpoint observation is one point-in-time connection to one revalidated and pinned public address. Other addresses or later observations may differ.'
    : 'The endpoint did not produce confirmed connection evidence. Its address field retains only the highest completed public selection or revalidation stage, if any.';
  return Object.freeze([
    addressLimitation,
    'Public-address validation, fresh revalidation, and connection pinning do not cryptographically authenticate the selected A or AAAA RRset or any CNAME chain.',
    'Only the SMTP greeting, EHLO capability names, and optional STARTTLS negotiation were observed. No authentication, recipient, mailbox, catch-all, relay, or message command was attempted.',
    'The raw SMTP greeting, reply text, certificate bytes, TLS session material, and DNS wire responses are not retained.',
    'Shared addresses, greeting digests, or certificate digests are exact relationship leads only; they do not establish a rogue server, common ownership, coordination, safety, or maliciousness.',
  ]);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  setTimer: (callback: () => void, milliseconds: number) => unknown,
  clearTimer: (handle: unknown) => void,
  onTimeout: () => void,
): Promise<T> {
  let timer: unknown;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimer(() => {
          onTimeout();
          reject(new Error('SMTP endpoint review timed out.'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimer(timer);
  }
}

function validatedResolution(value: ResolvedMailHost): ResolvedMailHost {
  if (!value || !Array.isArray(value.addresses) || !Array.isArray(value.aliases)
    || value.addresses.length < 1 || value.addresses.length > MAX_MAIL_TRANSPORT_ADDRESS_CANDIDATES
    || value.aliases.length > MAX_MAIL_TRANSPORT_DNS_ALIASES) {
    throw new Error('Selected MX host returned an invalid or oversized resolution result.');
  }
  const addresses = value.addresses.map((entry) => {
    if (!entry || net.isIP(entry.address) !== entry.family || isPrivateAddress(entry.address)) {
      throw new Error('Selected MX host returned a private, reserved, or invalid address candidate.');
    }
    return Object.freeze({ address: entry.address.toLowerCase(), family: entry.family });
  });
  const aliases = value.aliases.map((entry) => normalizeDnsName(entry));
  if (aliases.some((entry) => entry === null) || new Set(aliases).size !== aliases.length) {
    throw new Error('Selected MX host returned an invalid DNS alias chain.');
  }
  return Object.freeze({ addresses, aliases: Object.freeze(aliases as string[]) });
}

function emptyCertificate(): CertificateObservation {
  return Object.freeze({ state: 'unavailable', sha256: null, spkiSha256: null, protocol: null, cipherName: null, pkixState: 'unavailable', identityState: 'unavailable', authorizationError: null, identityError: null });
}

async function collectEndpoint(options: Readonly<{
  host: string;
  resolver: string;
  anchor: DnssecTrustAnchor;
  session: DnssecQuerySession;
  probe: SmtpProbe;
  resolveHost: NonNullable<MailTransportDependencies['resolveHost']>;
  validateDnssec: NonNullable<MailTransportDependencies['validateDnssec']>;
  collectTlsaEvidence: NonNullable<MailTransportDependencies['collectTlsaEvidence']>;
  observedAt: string;
  remainingMs: () => number;
  setTimer: (callback: () => void, milliseconds: number) => unknown;
  clearTimer: (handle: unknown) => void;
}>): Promise<MailTransportEndpoint> {
  let initial: ResolvedMailHost | null = null;
  let revalidated: ResolvedMailHost | null = null;
  let dnssec: Awaited<ReturnType<typeof validateDnssecChainWithContext>> | null = null;
  let smtp: SmtpConversationResult | null = null;
  let selected: { address: string; family: 4 | 6 } | null = null;
  let addressState: MailTransportEndpoint['address']['state'] = 'unavailable';
  let revalidationMatched = false;
  let certificate: ReturnType<typeof certificateObservation> = { observation: emptyCertificate(), certificateDer: null, spkiDer: null };
  let stage = 'resolution';
  try {
    initial = validatedResolution(await options.resolveHost(options.session, options.host));
    selected = initial.addresses[0] ?? null;
    if (!selected || net.isIP(selected.address) !== selected.family || isPrivateAddress(selected.address)) {
      throw new Error('Selected MX host returned no validated public address.');
    }
    addressState = 'selected';
    stage = 'dnssec';
    dnssec = await options.validateDnssec({ target: options.host, resolver: options.resolver, trustAnchor: options.anchor, observedAt: options.observedAt, ownedOrAuthorized: true, session: options.session });
    stage = 'revalidation';
    revalidated = validatedResolution(await options.resolveHost(options.session, options.host));
    if (!revalidated.addresses.some((entry) => entry.address === selected?.address && entry.family === selected?.family)) {
      throw new Error('Selected MX address changed during mandatory pre-connection revalidation.');
    }
    revalidationMatched = true;
    addressState = 'revalidated';
    stage = 'smtp';
    const remainingMs = options.remainingMs();
    if (remainingMs <= 0) throw new Error('Mail transport total run timed out before the SMTP connection.');
    const probeTimeout = Math.max(1, Math.min(SMTP_ENDPOINT_TIMEOUT_MS, remainingMs));
    const controller = new AbortController();
    try {
      smtp = await withTimeout(options.probe({ hostname: options.host, address: selected.address, family: selected.family, timeoutMs: probeTimeout, signal: controller.signal }), probeTimeout, options.setTimer, options.clearTimer, () => controller.abort());
    } finally {
      controller.abort();
    }
    if (smtp.connectedAddress !== selected.address) throw new Error('SMTP connection did not use the selected pinned address.');
    addressState = 'connected';
    if (smtp.tls?.remoteAddress && smtp.tls.remoteAddress !== selected.address) throw new Error('SMTP STARTTLS connection did not remain pinned to the selected address.');
    stage = 'tlsa';
    certificate = certificateObservation(options.host, smtp.tls);
    const tlsa = await options.collectTlsaEvidence(options.session, options.host, dnssec, certificate, options.observedAt);
    const smtpState = smtp.greeting.code === 220 && smtp.ehlo?.code === 250 ? 'observed' : 'rejected';
    const tlsaComplete = !['indeterminate', 'timed_out', 'unavailable'].includes(tlsa.state)
      && (tlsa.state !== 'validated' || !tlsa.dane || !['partial', 'unavailable', 'invalid'].includes(tlsa.dane.state));
    const certificateComplete = smtp.starttlsState !== 'negotiated' || certificate.observation.state === 'observed';
    const complete = smtpState === 'observed'
      && dnssec.report.completeness === 'complete'
      && tlsaComplete
      && certificateComplete;
    return Object.freeze({
      host: options.host,
      observedAt: options.observedAt,
      state: complete ? 'complete' : 'partial',
      address: addressObservation(selected, addressState),
      addressAuthentication: addressAuthentication(selected),
      resolution: Object.freeze({ state: 'public_revalidated', initialAddressCount: initial.addresses.length, revalidatedAddressCount: revalidated.addresses.length, aliasCount: Math.max(initial.aliases.length, revalidated.aliases.length) }),
      smtp: Object.freeze({ state: smtpState, greetingCode: smtp.greeting.code, greetingSha256: smtp.greeting.sha256, capabilities: smtp.capabilities, starttlsAdvertised: smtp.starttlsAdvertised, responseBytes: smtp.bytesRead, responseLines: smtp.lineCount }),
      starttls: Object.freeze({ state: smtp.starttlsState }),
      certificate: certificate.observation,
      dnssec: dnssec.report,
      tlsa,
      failure: null,
      limitations: endpointLimitations(addressState),
    });
  } catch (error) {
    const detail = boundedError(error);
    const timedOut = /timed out/iu.test(detail);
    const connectedSmtp = addressState === 'connected' ? smtp : null;
    const connected = connectedSmtp !== null;
    const smtpState = connectedSmtp ? connectedSmtp.greeting.code === 220 && connectedSmtp.ehlo?.code === 250 ? 'observed' : 'rejected'
      : timedOut && stage === 'smtp' ? 'timed_out' : 'unavailable';
    return Object.freeze({
      host: options.host,
      observedAt: options.observedAt,
      state: connected ? 'partial' : timedOut ? 'timed_out' : 'unavailable',
      address: addressObservation(selected, addressState),
      addressAuthentication: addressAuthentication(selected),
      resolution: Object.freeze({ state: revalidationMatched ? 'public_revalidated' : timedOut && !initial ? 'timed_out' : 'failed', initialAddressCount: initial?.addresses.length ?? 0, revalidatedAddressCount: revalidated?.addresses.length ?? 0, aliasCount: Math.max(initial?.aliases.length ?? 0, revalidated?.aliases.length ?? 0) }),
      smtp: Object.freeze({ state: smtpState, greetingCode: connectedSmtp?.greeting.code ?? null, greetingSha256: connectedSmtp?.greeting.sha256 ?? null, capabilities: connectedSmtp?.capabilities ?? Object.freeze([]), starttlsAdvertised: connectedSmtp?.starttlsAdvertised ?? null, responseBytes: connectedSmtp?.bytesRead ?? 0, responseLines: connectedSmtp?.lineCount ?? 0 }),
      starttls: Object.freeze({ state: connectedSmtp?.starttlsState ?? (timedOut && stage === 'smtp' ? 'timed_out' : 'unavailable') }),
      certificate: connected ? certificate.observation : emptyCertificate(),
      dnssec: dnssec?.report ?? null,
      tlsa: unavailableTlsa('unavailable', 'TLSA and DANE comparison was unavailable because endpoint collection did not complete.'),
      failure: Object.freeze({ stage, detail }),
      limitations: endpointLimitations(addressState),
    });
  }
}

function buildRelationships(endpoints: readonly MailTransportEndpoint[]): readonly MailTransportRelationship[] {
  const definitions = [
    ['connected_address', (endpoint: MailTransportEndpoint) => endpoint.address.state === 'connected' ? endpoint.address.value : null],
    ['greeting_sha256', (endpoint: MailTransportEndpoint) => endpoint.smtp.greetingSha256],
    ['certificate_sha256', (endpoint: MailTransportEndpoint) => endpoint.certificate.sha256],
  ] as const;
  const relationships: MailTransportRelationship[] = [];
  for (const [basis, valueFor] of definitions) {
    const groups = new Map<string, string[]>();
    for (const endpoint of endpoints) {
      const value = valueFor(endpoint);
      if (!value) continue;
      const hosts = groups.get(value) ?? [];
      hosts.push(endpoint.host);
      groups.set(value, hosts);
    }
    for (const [value, hosts] of groups) {
      const unique = [...new Set(hosts)].sort();
      if (unique.length < 2) continue;
      relationships.push(Object.freeze({
        basis,
        value,
        endpoints: Object.freeze(unique),
        interpretation: 'review_lead',
        limitation: 'An exact shared transport value is a review lead only and does not establish a rogue endpoint, ownership, coordination, intent, safety, or maliciousness.',
      }));
    }
  }
  return Object.freeze(relationships.sort((left, right) => left.basis.localeCompare(right.basis) || left.value.localeCompare(right.value)));
}

async function collectMailTransportReview(inputValue: unknown, options: Readonly<{
  resolver: unknown;
  trustAnchor: unknown;
  ownedOrAuthorized: boolean;
  activeProbeAcknowledged: boolean;
}>, dependencies: MailTransportDependencies = {}): Promise<MailTransportReview> {
  if (options.ownedOrAuthorized !== true || options.activeProbeAcknowledged !== true) {
    throw new TypeError('Mail transport review requires explicit owned-or-authorised scope and active-probing acknowledgement for every run.');
  }
  const input = parseMailTransportInput(inputValue);
  const resolver = normalizeResolverEndpoint(options.resolver);
  if (!resolver) throw new TypeError('Mail transport review requires one analyst-selected public resolver IP address.');
  const anchor = parseDnssecTrustAnchor(options.trustAnchor);
  const now = dependencies.now ?? Date.now;
  const observedAt = dependencies.observedAt ?? (() => new Date().toISOString());
  const setTimer = dependencies.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
  const clearTimer = dependencies.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  const started = now();
  const generatedAt = timestamp(observedAt(), 'generatedAt');
  const session = new DnssecQuerySession({
    resolver,
    totalTimeoutMs: MAIL_TRANSPORT_TOTAL_TIMEOUT_MS,
    ...dependencies.dnsSessionOptions,
  });
  const endpoints: MailTransportEndpoint[] = [];
  for (const host of input.mxHosts) {
    const remainingMs = MAIL_TRANSPORT_TOTAL_TIMEOUT_MS - Math.max(0, now() - started);
    if (remainingMs <= 0) {
      endpoints.push(Object.freeze({
        host, observedAt: timestamp(observedAt(), 'observedAt'), state: 'timed_out',
        address: addressObservation(null, 'unavailable'), addressAuthentication: addressAuthentication(null),
        resolution: Object.freeze({ state: 'timed_out', initialAddressCount: 0, revalidatedAddressCount: 0, aliasCount: 0 }),
        smtp: Object.freeze({ state: 'timed_out', greetingCode: null, greetingSha256: null, capabilities: Object.freeze([]), starttlsAdvertised: null, responseBytes: 0, responseLines: 0 }),
        starttls: Object.freeze({ state: 'timed_out' }), certificate: emptyCertificate(), dnssec: null,
        tlsa: unavailableTlsa('timed_out', 'The total mail-transport run limit expired before this endpoint was queried.'),
        failure: Object.freeze({ stage: 'total_run', detail: 'Mail transport total run timed out.' }), limitations: endpointLimitations('unavailable'),
      }));
      continue;
    }
    endpoints.push(await collectEndpoint({
      host,
      resolver: resolver.address,
      anchor,
      session,
      probe: dependencies.probe ?? defaultSmtpProbe,
      resolveHost: dependencies.resolveHost ?? resolveSelectedHost,
      validateDnssec: dependencies.validateDnssec ?? validateDnssecChainWithContext,
      collectTlsaEvidence: dependencies.collectTlsaEvidence ?? collectTlsa,
      observedAt: timestamp(observedAt(), 'observedAt'),
      remainingMs: () => MAIL_TRANSPORT_TOTAL_TIMEOUT_MS - Math.max(0, now() - started),
      setTimer,
      clearTimer,
    }));
  }
  const runState = endpoints.every((endpoint) => endpoint.state === 'complete') ? 'complete'
    : endpoints.some((endpoint) => endpoint.state === 'complete' || endpoint.state === 'partial') ? 'partial' : 'unavailable';
  return Object.freeze({
    schema: MAIL_TRANSPORT_REVIEW_SCHEMA,
    version: MAIL_TRANSPORT_REVIEW_VERSION,
    generatedAt,
    domain: input.domain,
    runState,
    authorization: Object.freeze({ ownedOrAuthorized: true, activeProbeAcknowledged: true }),
    resolver: Object.freeze({ address: resolver.address, port: 53 }),
    trustAnchor: Object.freeze({ zone: anchor.zone, source: anchor.source, reviewedAt: anchor.reviewedAt }),
    policyContext: input.policyContext,
    endpoints: Object.freeze(endpoints),
    relationships: buildRelationships(endpoints),
    bounds: Object.freeze({
      targets: endpoints.length,
      targetLimit: MAX_MAIL_TRANSPORT_TARGETS,
      concurrency: MAX_MAIL_TRANSPORT_CONCURRENCY,
      dnsQueries: session.queryCount,
      dnsQueryLimit: session.maximumQueries,
      dnsResponseBytes: session.responseBytes,
      dnsResponseByteLimit: session.maximumResponseBytes,
      smtpResponseByteLimitPerTarget: MAX_SMTP_RESPONSE_BYTES,
      smtpReplyLineLimitPerTarget: MAX_SMTP_REPLY_LINES,
      smtpLineByteLimit: MAX_SMTP_LINE_BYTES,
      smtpCapabilityLimitPerTarget: MAX_SMTP_CAPABILITIES,
      addressCandidateLimitPerResolution: MAX_MAIL_TRANSPORT_ADDRESS_CANDIDATES,
      dnsAliasLimitPerResolution: MAX_MAIL_TRANSPORT_DNS_ALIASES,
      certificateByteLimitPerTarget: MAX_SMTP_CERTIFICATE_BYTES,
      connectionsPerTarget: 1,
      endpointTimeoutMs: SMTP_ENDPOINT_TIMEOUT_MS,
      totalTimeoutMs: MAIL_TRANSPORT_TOTAL_TIMEOUT_MS,
      retries: 0,
    }),
    limitations: Object.freeze([
      'This command performs active network collection only for the selected MX hosts in this explicitly authorised run. It is not invoked by Lookup, Bulk, monitoring, or automatic recipes.',
      'DNSSEC, TLSA or DANE, PKIX, certificate identity, STARTTLS, SMTP transport, MTA-STS context, and TLS-RPT context retain separate states and provenance. One family never supplies or upgrades another family.',
      'Public-address validation, fresh resolution, and connection pinning are reported separately from DNSSEC. They do not cryptographically authenticate the selected A or AAAA RRset or any CNAME chain.',
      'No message is sent; no authentication, relay, recipient, mailbox, user, or catch-all test is performed; and no retry is attempted.',
      'MTA-STS and TLS-RPT fields are bounded supplied context only. This action does not fetch an MTA-STS policy or a reporting-provider record.',
      'The review does not affect Risk, Opportunity, registration availability, ownership, activity, safety, or maliciousness.',
    ]),
  });
}

function formatMailTransportReview(review: MailTransportReview): string {
  const lines = [
    'Authorised mail transport review',
    `Domain    ${review.domain}`,
    `State     ${review.runState}`,
    `Resolver  ${review.resolver.address}:${review.resolver.port}`,
    `Targets   ${review.endpoints.length}/${review.bounds.targetLimit}`,
    '',
    'Selected MX endpoints:',
  ];
  for (const endpoint of review.endpoints) {
    lines.push(
      `  - ${endpoint.host}: ${endpoint.state}`,
      `    address=${endpoint.address.value ?? 'unavailable'} address_state=${endpoint.address.state} address_authentication=${endpoint.addressAuthentication.state} smtp=${endpoint.smtp.state} starttls=${endpoint.starttls.state} dnssec_chain=${endpoint.dnssec?.state ?? 'unavailable'} tlsa=${endpoint.tlsa.state} pkix=${endpoint.certificate.pkixState}`,
    );
    if (endpoint.failure) lines.push(`    failure=${endpoint.failure.stage}: ${endpoint.failure.detail}`);
  }
  if (review.relationships.length) {
    lines.push('', 'Exact relationship leads:');
    for (const relationship of review.relationships) {
      lines.push(`  - ${relationship.basis}: ${relationship.endpoints.join(', ')}`);
    }
  }
  lines.push('', 'Limitations:');
  for (const limitation of review.limitations) lines.push(`  - ${limitation}`);
  return `${lines.join('\n')}\n`;
}

export {
  EHLO_COMMAND,
  MAIL_TRANSPORT_INPUT_SCHEMA,
  MAIL_TRANSPORT_INPUT_VERSION,
  MAIL_TRANSPORT_REVIEW_SCHEMA,
  MAIL_TRANSPORT_REVIEW_VERSION,
  MAIL_TRANSPORT_TOTAL_TIMEOUT_MS,
  MAX_MAIL_TRANSPORT_CONCURRENCY,
  MAX_MAIL_TRANSPORT_ADDRESS_CANDIDATES,
  MAX_MAIL_TRANSPORT_DNS_ALIASES,
  MAX_MAIL_TRANSPORT_INPUT_BYTES,
  MAX_MAIL_TRANSPORT_TARGETS,
  MAX_SMTP_CAPABILITIES,
  MAX_SMTP_LINE_BYTES,
  MAX_SMTP_REPLY_LINES,
  MAX_SMTP_RESPONSE_BYTES,
  SMTP_ENDPOINT_TIMEOUT_MS,
  STARTTLS_COMMAND,
  collectMailTransportReview,
  certificateObservation,
  formatMailTransportReview,
  normalizeSmtpReply,
  parseMailTransportInput,
  resolveSelectedHost,
  runSmtpConversation,
  smtpStartTlsOptions,
  smtpCapabilities,
};

export type {
  CertificateObservation,
  MailTransportDependencies,
  MailTransportEndpoint,
  MailTransportInput,
  MailTransportRelationship,
  MailTransportReview,
  RawTlsEvidence,
  SmtpConversationConnection,
  SmtpConversationResult,
  SmtpProbe,
  SmtpReply,
  TlsaObservation,
};
