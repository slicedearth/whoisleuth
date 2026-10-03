import type { ClassifiedQuery } from '../lib/classify.mts';
import { plannedLookupSources } from '../lib/lookup-progress.mts';

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
  disclosure: 'DNS, TLS and website probes use the submitted hostname. Registration-delegation queries use the registrable domain.',
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

function plannedSources(classified: ClassifiedQuery, deep: boolean, selectedUrl: boolean): readonly PlannedSource[] {
  const domainEvidence = selectedUrl && deep ? Object.freeze({
      ...DEEP_DOMAIN_EVIDENCE,
      disclosure: 'The selected URL path and query are sent to the website and followed redirects. The fragment is not sent. DNS and TLS use its hostname; registration uses the registrable domain. Saved HTTP provenance omits queries, but page-derived text may contain sensitive information.',
    }) : deep ? DEEP_DOMAIN_EVIDENCE : FAST_DOMAIN_EVIDENCE;
  const sources: Readonly<Record<string, PlannedSource>> = {
    rdap: RDAP, whois: WHOIS, domain_evidence: domainEvidence,
    registrar_rdap: REGISTRAR_RDAP, network_context: NETWORK_CONTEXT, reverse_dns: REVERSE_DNS,
  };
  return Object.freeze(plannedLookupSources(classified.type, deep ? 'deep' : 'fast').map(id => sources[id]!));
}

function buildCliLookupPlan(query: string, classified: ClassifiedQuery, deep: boolean, selectedUrl = false): CliLookupPlan {
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
      sources: plannedSources(classified, deep, selectedUrl),
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
    ...(plan.target.inputHostname && plan.target.inputHostname !== plan.target.normalized
      ? [`Submitted hostname: ${plan.target.inputHostname}`] : []),
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
