// Bounded WHOIS port-43 transport with public-address validation and
// connection pinning. Referral orchestration and response parsing remain in
// lib/whois.mts so this module has one responsibility: safely query one
// validated WHOIS server.

import net from 'node:net';

import { resolvePublicAddresses } from './safe-fetch.mts';

type UnknownRecord = Record<string, unknown>;
type PublicAddressRecord = { address: string; family: number };

type WhoisSocket = {
  write(value: string): unknown;
  destroy(): unknown;
  setTimeout(timeoutMs: number): unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'end' | 'close' | 'timeout', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
};

type CreateWhoisConnection = (
  options: { host: string; port: number },
  connected: () => void,
) => WhoisSocket;

type QueryAddress = (
  address: string,
  server: string,
  query: string,
  options: { port?: number; timeoutMs?: number; totalDeadlineMs?: number },
) => Promise<string>;

type WhoisQuery = (
  server: string,
  query: string,
  options: {
    port?: number;
    timeoutMs?: number;
    totalDeadlineMs?: number;
    onAddressSelected?: (address: string) => void;
  },
) => Promise<string>;

const MAX_WHOIS_BYTES = 200000;
const WHOIS_HOP_DEADLINE_MS = 12000;
const MAX_WHOIS_ADDRESSES = 3;

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const message = (value as UnknownRecord).message;
  return message ? String(message) : fallback;
}

// A referral hostname is upstream-controlled, so resolve and validate its
// addresses before connecting. Connect to the selected address directly to
// prevent a second DNS lookup from bypassing the public-address decision.
function queryWhoisAddress(address: string, server: string, query: string, {
  port = 43,
  timeoutMs = 10000,
  totalDeadlineMs = WHOIS_HOP_DEADLINE_MS,
  createConnection = net.createConnection,
}: {
  port?: number;
  timeoutMs?: number;
  totalDeadlineMs?: number;
  createConnection?: CreateWhoisConnection;
} = {}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: address, port }, () => {
      socket.write(query + '\r\n');
    });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const deadline = setTimeout(() => {
      settled = true;
      socket.destroy();
      reject(new Error(`WHOIS request to ${server} exceeded the total time limit`));
    }, totalDeadlineMs);

    function settle<T>(fn: (value: T) => void, value: T) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    }

    socket.setTimeout(Math.min(timeoutMs, totalDeadlineMs));
    socket.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_WHOIS_BYTES) {
        socket.destroy();
        settle(reject, new Error(`WHOIS response from ${server} exceeded ${MAX_WHOIS_BYTES} bytes`));
        return;
      }
      chunks.push(buffer);
    });

    const settleResponse = () => {
      try {
        const responseText = new TextDecoder('utf-8', { fatal: true })
          .decode(Buffer.concat(chunks, totalBytes));
        settle(resolve, responseText);
      } catch {
        settle(reject, new Error(`WHOIS response from ${server} was not valid UTF-8`));
      }
    };
    socket.on('end', settleResponse);
    socket.on('close', settleResponse);
    socket.on('timeout', () => {
      socket.destroy();
      settle(reject, new Error(`WHOIS request to ${server} timed out`));
    });
    socket.on('error', (error) => settle(reject, error));
  });
}

async function whoisQuery(server: string, query: string, {
  port = 43,
  timeoutMs = 10000,
  totalDeadlineMs = WHOIS_HOP_DEADLINE_MS,
  resolveAddresses = resolvePublicAddresses,
  queryAddress = queryWhoisAddress,
  now = Date.now,
  onAddressSelected = (_address) => {},
}: {
  port?: number;
  timeoutMs?: number;
  totalDeadlineMs?: number;
  resolveAddresses?: (hostname: string) => Promise<PublicAddressRecord[]>;
  queryAddress?: QueryAddress;
  now?: () => number;
  onAddressSelected?: (address: string) => void;
} = {}): Promise<string> {
  const startedAt = now();
  let resolutionTimer: NodeJS.Timeout | undefined;
  const records = await Promise.race([
    resolveAddresses(server),
    new Promise<never>((_, reject) => {
      resolutionTimer = setTimeout(
        () => reject(new Error(`WHOIS request to ${server} timed out during DNS resolution`)),
        totalDeadlineMs,
      );
    }),
  ]).finally(() => clearTimeout(resolutionTimer));

  const candidates = records.slice(0, MAX_WHOIS_ADDRESSES);
  const failures: string[] = [];
  let attempts = 0;
  for (const { address } of candidates) {
    const remainingMs = totalDeadlineMs - (now() - startedAt);
    if (remainingMs <= 0) break;
    attempts += 1;
    try {
      const response = await queryAddress(address, server, query, {
        port,
        timeoutMs: Math.min(timeoutMs, remainingMs),
        totalDeadlineMs: remainingMs,
      });
      try {
        onAddressSelected(address);
      } catch {
        // Diagnostics must not break a successful lookup.
      }
      return response;
    } catch (error) {
      failures.push(errorMessage(error, 'connection failed').slice(0, 200));
    }
  }

  const detail = failures.length
    ? `: ${failures.join('; ')}`
    : ' because the total time limit expired';
  throw new Error(
    `WHOIS request to ${server} failed after ${attempts} of ${candidates.length} validated address(es)${detail}`,
  );
}

export {
  MAX_WHOIS_BYTES,
  queryWhoisAddress,
  whoisQuery,
  type WhoisQuery,
};
