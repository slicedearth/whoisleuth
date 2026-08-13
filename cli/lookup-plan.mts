import type { ClassifiedQuery } from '../lib/classify.mts';

export const CLI_LOOKUP_PLAN_SCHEMA = 'whoisleuth.cli.lookup-plan';
export const CLI_LOOKUP_PLAN_VERSION = 1;

type PlannedSource = Readonly<{
  source: string;
  purpose: string;
  disclosure: string;
  conditional: boolean;
}>;

type CliLookupPlan = Readonly<{
  schema: typeof CLI_LOOKUP_PLAN_SCHEMA;
  version: typeof CLI_LOOKUP_PLAN_VERSION;
  mode: 'fast' | 'deep';
  target: Readonly<{
    query: string;
    type: ClassifiedQuery['type'];
    normalized: string;
    inputHostname?: string;
    registrableDomain?: string;
  }>;
  planning: Readonly<{
    networkRequestsMade: false;
    collectionRequiresNetwork: true;
    sources: readonly PlannedSource[];
  }>;
  limitations: readonly string[];
}>;

const RDAP: PlannedSource = Object.freeze({
  source: 'rdap',
  purpose: 'Collect authoritative registration or allocation evidence where supported.',
  disclosure: 'The normalised target is sent to the applicable RDAP bootstrap and service endpoints.',
  conditional: false,
});
const WHOIS: PlannedSource = Object.freeze({
  source: 'whois',
  purpose: 'Collect separately attributed registry and referral publications.',
  disclosure: 'The normalised target is sent over bounded TCP connections to applicable WHOIS services.',
  conditional: false,
});
const FAST_DOMAIN_EVIDENCE: PlannedSource = Object.freeze({
  source: 'domain_evidence',
  purpose: 'Derive a registration state from RDAP, with bounded DNS delegation fallback when needed.',
  disclosure: 'DNS resolvers may receive the registrable domain when RDAP does not provide a usable record.',
  conditional: true,
});
const DEEP_DOMAIN_EVIDENCE: PlannedSource = Object.freeze({
  source: 'domain_evidence',
  purpose: 'Collect bounded DNS, HTTP, TLS, page-identity, technology, and security-posture evidence.',
  disclosure: 'DNS resolvers and the target website infrastructure receive the hostname through bounded probes.',
  conditional: false,
});
const REGISTRAR_RDAP: PlannedSource = Object.freeze({
  source: 'registrar_rdap',
  purpose: 'Collect a separately attributed registrar RDAP publication when registry evidence advertises one.',
  disclosure: 'The registrable domain is sent to the advertised registrar RDAP service.',
  conditional: true,
});
const NETWORK_CONTEXT: PlannedSource = Object.freeze({
  source: 'network_context',
  purpose: 'Add allocation and routing context for public addresses observed during domain collection.',
  disclosure: 'Observed public addresses may be sent to applicable RDAP services.',
  conditional: true,
});
const REVERSE_DNS: PlannedSource = Object.freeze({
  source: 'reverse_dns',
  purpose: 'Collect operator-published reverse-DNS context for a public IP address.',
  disclosure: 'A DNS resolver receives the reverse lookup for the normalised IP address.',
  conditional: false,
});

function plannedSources(classified: ClassifiedQuery, deep: boolean): readonly PlannedSource[] {
  if (!deep) {
    return Object.freeze(classified.type === 'domain' ? [RDAP, FAST_DOMAIN_EVIDENCE] : [RDAP]);
  }
  if (classified.type === 'domain') {
    return Object.freeze([RDAP, WHOIS, DEEP_DOMAIN_EVIDENCE, REGISTRAR_RDAP, NETWORK_CONTEXT]);
  }
  if (classified.type === 'ipv4' || classified.type === 'ipv6') {
    return Object.freeze([RDAP, WHOIS, REVERSE_DNS]);
  }
  return Object.freeze([RDAP, WHOIS]);
}

function buildCliLookupPlan(query: string, classified: ClassifiedQuery, deep: boolean): CliLookupPlan {
  return Object.freeze({
    schema: CLI_LOOKUP_PLAN_SCHEMA,
    version: CLI_LOOKUP_PLAN_VERSION,
    mode: deep ? 'deep' : 'fast',
    target: Object.freeze({
      query,
      type: classified.type,
      normalized: classified.value,
      ...(classified.inputHostname ? { inputHostname: classified.inputHostname } : {}),
      ...(classified.registrableDomain ? { registrableDomain: classified.registrableDomain } : {}),
    }),
    planning: Object.freeze({
      networkRequestsMade: false,
      collectionRequiresNetwork: true,
      sources: plannedSources(classified, deep),
    }),
    limitations: Object.freeze([
      'This is a local preflight. It does not test source availability, feature configuration, cache state, redirects, referrals, or the exact number of requests a completed lookup may require.',
      'Conditional sources may be skipped when prerequisite evidence is absent, unsupported, disabled, or unavailable.',
    ]),
  });
}

function formatCliLookupPlan(plan: CliLookupPlan): string {
  const lines = [
    'WHOISleuth lookup preflight',
    `Target: ${plan.target.normalized}`,
    `Type: ${plan.target.type}`,
    `Mode: ${plan.mode}`,
    'Network requests made: no',
    'Collection requires network: yes',
    '',
    'Planned collection:',
  ];
  for (const source of plan.planning.sources) {
    lines.push(`  ${source.source}${source.conditional ? ' (conditional)' : ''}`);
    lines.push(`    ${source.purpose}`);
    lines.push(`    Disclosure: ${source.disclosure}`);
  }
  for (const limitation of plan.limitations) lines.push('', `Limitation: ${limitation}`);
  return `${lines.join('\n')}\n`;
}

export { buildCliLookupPlan, formatCliLookupPlan };
export type { CliLookupPlan, PlannedSource };
