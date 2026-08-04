const ENCRYPTED_DNS_CONTRACT_SCHEMA = 'whoisleuth.encrypted-dns-adapter';
const ENCRYPTED_DNS_CONTRACT_VERSION = 1;
const DNS_TYPES = new Set(['A', 'AAAA', 'CAA', 'CNAME', 'DNSKEY', 'DS', 'HTTPS', 'MX', 'NS', 'RRSIG', 'SOA', 'SVCB', 'TLSA', 'TXT']);

type EncryptedDnsAdapter = Readonly<{
  id: string;
  label: string;
  endpoint: string;
  method: 'GET' | 'POST';
  representation: 'dns-json' | 'dns-wire';
  termsUrl: string;
  privacyUrl: string;
  reviewedAt: string;
  queryRetention: 'none' | 'limited' | 'provider_defined' | 'unknown';
  maxResponseBytes: number;
  timeoutMs: number;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeEncryptedDnsAdapter(value: unknown): EncryptedDnsAdapter {
  const source = record(value);
  if (!source) throw new TypeError('Encrypted DNS adapter must be an object.');
  const id = typeof source.id === 'string' && /^[a-z][a-z0-9-]{0,47}$/u.test(source.id) ? source.id : null;
  const label = typeof source.label === 'string' && source.label.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(source.label)
    ? source.label.trim()
    : null;
  const endpoint = httpsUrl(source.endpoint);
  const termsUrl = httpsUrl(source.termsUrl);
  const privacyUrl = httpsUrl(source.privacyUrl);
  const reviewedAt = typeof source.reviewedAt === 'string' && Number.isFinite(Date.parse(source.reviewedAt))
    ? new Date(source.reviewedAt).toISOString()
    : null;
  const method = source.method === 'GET' || source.method === 'POST' ? source.method : null;
  const representation = source.representation === 'dns-json' || source.representation === 'dns-wire'
    ? source.representation
    : null;
  const retention = source.queryRetention;
  const maxResponseBytes = Number(source.maxResponseBytes);
  const timeoutMs = Number(source.timeoutMs);
  if (!id || !label || !endpoint || !termsUrl || !privacyUrl || !reviewedAt || !method || !representation
    || !['none', 'limited', 'provider_defined', 'unknown'].includes(String(retention))
    || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 2 * 1024 * 1024
    || !Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 15_000) {
    throw new TypeError('Encrypted DNS adapter did not satisfy the bounded privacy and transport contract.');
  }
  return Object.freeze({
    id,
    label,
    endpoint,
    method,
    representation,
    termsUrl,
    privacyUrl,
    reviewedAt,
    queryRetention: retention as EncryptedDnsAdapter['queryRetention'],
    maxResponseBytes,
    timeoutMs,
  });
}

function planEncryptedDnsQuery(adapter: EncryptedDnsAdapter, input: Readonly<{ name: unknown; type: unknown }>) {
  const name = typeof input.name === 'string' ? input.name.trim().toLowerCase().replace(/\.$/u, '') : '';
  const type = typeof input.type === 'string' ? input.type.trim().toUpperCase() : '';
  if (!name || name.length > 253 || !/^[a-z0-9._-]+$/u.test(name) || !DNS_TYPES.has(type)) {
    throw new TypeError('Encrypted DNS query name or record type was invalid or unsupported.');
  }
  return Object.freeze({
    schema: ENCRYPTED_DNS_CONTRACT_SCHEMA,
    version: ENCRYPTED_DNS_CONTRACT_VERSION,
    state: 'approval_required' as const,
    adapter: Object.freeze({ id: adapter.id, label: adapter.label, endpoint: adapter.endpoint }),
    query: Object.freeze({ name, type }),
    disclosure: Object.freeze({
      target: name,
      recipient: new URL(adapter.endpoint).hostname,
      queryRetention: adapter.queryRetention,
    }),
    limitation: 'This plan does not execute a request. Provider availability, answer authority, validation, filtering, retention, and regional behavior remain untested.',
  });
}

export {
  ENCRYPTED_DNS_CONTRACT_SCHEMA,
  ENCRYPTED_DNS_CONTRACT_VERSION,
  normalizeEncryptedDnsAdapter,
  planEncryptedDnsQuery,
};
export type { EncryptedDnsAdapter };
