export type LookupEvidencePivotInput = {
  type: unknown;
  query: unknown;
  registrableDomain?: unknown;
  observedAddress?: unknown;
  observedCidrs?: unknown;
  startAutnum?: unknown;
  endAutnum?: unknown;
};

export type AnalystEvidencePivot = {
  id: string;
  destination: string;
  label: string;
  description: string;
  href: string;
  sharedValue: string;
  disclosure: string;
  category: 'registration' | 'history' | 'certificate' | 'network' | 'reputation';
};

const MAX_PIVOTS = 8;
const MAX_ASN = 4_294_967_295;
const CONTROL_OR_SPACE_RE = /[\u0000-\u0020\u007f]/u;
const DOMAIN_LABEL_RE = /^(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
const IPV6_RE = /^[0-9a-f:.]+$/iu;
const PRIVATE_ASN_RANGES = Object.freeze([
  [64_496, 64_511],
  [64_512, 65_534],
  [65_536, 65_551],
  [4_200_000_000, 4_294_967_294],
] as const);

function canonicalDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().replace(/\.$/u, '').toLowerCase();
  if (
    !candidate
    || candidate.length > 253
    || CONTROL_OR_SPACE_RE.test(candidate)
    || /[/\\:@?#]/u.test(candidate)
  ) return null;
  try {
    const hostname = new URL(`https://${candidate}/`).hostname.toLowerCase();
    const labels = hostname.split('.');
    if (
      hostname.length > 253
      || labels.length < 2
      || labels.some((label) => label.length > 63 || !DOMAIN_LABEL_RE.test(label))
    ) return null;
    return hostname;
  } catch {
    return null;
  }
}

function canonicalIpv4(value: unknown): string | null {
  if (typeof value !== 'string' || !IPV4_RE.test(value.trim())) return null;
  const octets = value.trim().split('.').map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets.join('.');
}

function isPublicIpv4(value: string): boolean {
  const octets = value.split('.').map(Number);
  const [first, second, third] = octets;
  if (
    first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
  ) return false;
  return true;
}

function canonicalIpv6(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase();
  if (
    !candidate.includes(':')
    || candidate.includes('%')
    || candidate.includes('.')
    || !IPV6_RE.test(candidate)
  ) return null;
  try {
    const hostname = new URL(`https://[${candidate}]/`).hostname;
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : null;
  } catch {
    return null;
  }
}

function isPublicIpv6(value: string): boolean {
  const normalized = value.toLowerCase();
  if (
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/u.test(normalized)
    || normalized.startsWith('ff')
    || normalized.startsWith('::ffff:')
    || normalized.startsWith('2001:db8:')
  ) return false;
  return true;
}

function canonicalPublicIp(value: unknown): string | null {
  const ipv4 = canonicalIpv4(value);
  if (ipv4) return isPublicIpv4(ipv4) ? ipv4 : null;
  const ipv6 = canonicalIpv6(value);
  return ipv6 && isPublicIpv6(ipv6) ? ipv6 : null;
}

function canonicalPublicCidr(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 96) return null;
  const parts = value.trim().split('/');
  if (parts.length !== 2 || !/^\d{1,3}$/u.test(parts[1])) return null;
  const address = canonicalPublicIp(parts[0]);
  const prefix = Number(parts[1]);
  if (!address || !Number.isInteger(prefix)) return null;
  if (address.includes(':') ? prefix < 0 || prefix > 128 : prefix < 0 || prefix > 32) return null;
  return `${address}/${prefix}`;
}

function canonicalAsn(value: unknown): { display: string; number: number } | null {
  let number: number;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string' && /^(?:AS)?\d{1,10}$/iu.test(value.trim())) {
    number = Number(value.trim().replace(/^AS/iu, ''));
  } else return null;
  if (
    !Number.isSafeInteger(number)
    || number <= 0
    || number >= MAX_ASN
    || number === 23_456
    || PRIVATE_ASN_RANGES.some(([start, end]) => number >= start && number <= end)
  ) return null;
  return { display: `AS${number}`, number };
}

function requestedAsn(input: LookupEvidencePivotInput): { display: string; number: number } | null {
  const direct = canonicalAsn(input.query);
  if (direct) return direct;
  const start = canonicalAsn(input.startAutnum);
  const end = canonicalAsn(input.endAutnum);
  return start && end && start.number === end.number ? start : null;
}

function observedNetworkResource(input: LookupEvidencePivotInput): string | null {
  if (Array.isArray(input.observedCidrs)) {
    for (const value of input.observedCidrs.slice(0, 16)) {
      const cidr = canonicalPublicCidr(value);
      if (cidr) return cidr;
    }
  }
  return canonicalPublicIp(input.observedAddress);
}

function pivot(
  id: string,
  destination: string,
  label: string,
  description: string,
  href: string,
  sharedValue: string,
  category: AnalystEvidencePivot['category'],
): AnalystEvidencePivot {
  return {
    id,
    destination,
    label,
    description,
    href,
    sharedValue,
    disclosure: `Shares ${sharedValue} with ${destination} only after you open this link.`,
    category,
  };
}

export function buildAnalystEvidencePivots(input: LookupEvidencePivotInput): AnalystEvidencePivot[] {
  const pivots: AnalystEvidencePivot[] = [];
  const type = typeof input.type === 'string' ? input.type : '';
  const domain = type === 'domain' ? canonicalDomain(input.registrableDomain) : null;

  if (domain) {
    const tld = domain.split('.').at(-1) as string;
    pivots.push(
      pivot(
        'icann-registration',
        'ICANN Lookup',
        'Compare registration data',
        'Open ICANN’s public RDAP-based lookup to compare its current registration presentation.',
        `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}`,
        domain,
        'registration',
      ),
      pivot(
        'iana-delegation',
        'IANA Root Zone Database',
        `Review .${tld} delegation`,
        'Open the authoritative top-level-domain delegation record and published registry service details.',
        `https://www.iana.org/domains/root/db/${encodeURIComponent(tld)}.html`,
        `.${tld}`,
        'registration',
      ),
      pivot(
        'certificate-transparency',
        'crt.sh',
        'Search certificate history',
        'Search public Certificate Transparency records for identities matching this domain.',
        `https://crt.sh/?q=${encodeURIComponent(domain)}`,
        domain,
        'certificate',
      ),
      pivot(
        'historical-captures',
        'Internet Archive',
        'Browse historical captures',
        'Review archived public captures for this domain. Missing captures do not establish that a site was inactive.',
        `https://web.archive.org/web/*/${domain}/`,
        domain,
        'history',
      ),
      pivot(
        'safe-browsing-status',
        'Google Safe Browsing',
        'Check reported site status',
        'Open the public site-status search. A neutral result is not evidence that the domain is safe.',
        `https://transparencyreport.google.com/safe-browsing/search?url=${encodeURIComponent(domain)}`,
        domain,
        'reputation',
      ),
    );
  }

  const asn = type === 'asn' ? requestedAsn(input) : null;
  const networkResource = asn?.display
    || (type === 'ipv4' || type === 'ipv6' ? canonicalPublicIp(input.query) : observedNetworkResource(input));
  if (networkResource) {
    pivots.push(pivot(
      'ripestat-resource',
      'RIPEstat',
      'Explore routing and registration context',
      'Open the RIPEstat Launchpad for public routing, allocation, and related network context.',
      `https://stat.ripe.net/app/launchpad/${encodeURIComponent(networkResource)}`,
      networkResource,
      'network',
    ));
  }
  if (asn) {
    pivots.push(pivot(
      'peeringdb-asn',
      'PeeringDB',
      'Review interconnection profile',
      'Search the community-maintained network record for published interconnection context.',
      `https://www.peeringdb.com/net?asn=${asn.number}`,
      asn.display,
      'network',
    ));
  }

  return pivots.slice(0, MAX_PIVOTS);
}
