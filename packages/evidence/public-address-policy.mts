// Browser-safe canonical public-address policy for analyst-supplied address
// evidence. This performs no resolution or network work; transport owners must
// still revalidate and pin addresses before making a request.

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
const IPV6_RE = /^[0-9a-f:]+$/iu;

function canonicalIpv4(value: unknown): string | null {
  if (typeof value !== 'string' || !IPV4_RE.test(value.trim())) return null;
  const octets = value.trim().split('.').map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets.join('.');
}

function isPublicIpv4(value: string): boolean {
  const octets = value.split('.').map(Number);
  const [first = -1, second = -1, third = -1] = octets;
  return octets.length === 4
    && first !== 0
    && first !== 10
    && first !== 127
    && first < 224
    && !(first === 100 && second >= 64 && second <= 127)
    && !(first === 169 && second === 254)
    && !(first === 172 && second >= 16 && second <= 31)
    && !(first === 192 && second === 168)
    && !(first === 198 && (second === 18 || second === 19))
    && !(first === 192 && second === 0 && third === 0)
    && !(first === 192 && second === 0 && third === 2)
    && !(first === 192 && second === 88 && third === 99)
    && !(first === 198 && second === 51 && third === 100)
    && !(first === 203 && second === 0 && third === 113);
}

function canonicalIpv6(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase();
  if (!candidate.includes(':') || candidate.includes('%') || candidate.includes('.') || !IPV6_RE.test(candidate)) {
    return null;
  }
  try {
    const host = new URL(`https://[${candidate}]/`).hostname;
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : null;
  } catch {
    return null;
  }
}

function expandedIpv6Groups(value: string): string[] {
  const [head = '', tail = ''] = value.includes('::') ? value.split('::') : [value, ''];
  const headGroups = head ? head.split(':') : [];
  const tailGroups = value.includes('::') && tail ? tail.split(':') : [];
  if (!value.includes('::')) return headGroups.length === 8 ? headGroups.map((group) => group.padStart(4, '0')) : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 1) return [];
  return [...headGroups, ...new Array(missing).fill('0'), ...tailGroups]
    .map((group) => group.padStart(4, '0'));
}

function isPublicIpv6(value: string): boolean {
  const groups = expandedIpv6Groups(value);
  if (groups.length !== 8) return false;
  const [first = '', second = '', third = ''] = groups;
  if (groups.every((group) => group === '0000')) return false;
  if (groups.slice(0, 7).every((group) => group === '0000') && groups[7] === '0001') return false;
  if (first.startsWith('ff') || /^fe[89ab]/u.test(first) || /^fe[cdef]/u.test(first) || /^f[cd]/u.test(first)) return false;
  if (first === '0100' && groups.slice(1, 4).every((group) => group === '0000')) return false;
  if (first === '2001' && second === '0db8') return false;
  if (first === '3fff' && Number.parseInt(second, 16) <= 0x0fff) return false;
  if (first === '2001' && second === '0002' && third === '0000') return false;
  if (first === '2001' && /^00[1-2][0-9a-f]$/u.test(second)) return false;
  if (first === '2001' && second === '0000') return false;
  if (first === '2002') return false;
  const firstValue = Number.parseInt(first, 16);
  return Number.isInteger(firstValue) && firstValue >= 0x2000 && firstValue <= 0x3fff;
}

export function canonicalPublicIpAddress(value: unknown): string | null {
  const ipv4 = canonicalIpv4(value);
  if (ipv4) return isPublicIpv4(ipv4) ? ipv4 : null;
  const ipv6 = canonicalIpv6(value);
  return ipv6 && isPublicIpv6(ipv6) ? ipv6 : null;
}
