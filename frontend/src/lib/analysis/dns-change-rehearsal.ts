export const DNS_CHANGE_REHEARSAL_VERSION = 1;
export const MAX_REHEARSAL_NAMESERVERS = 8;
export const MAX_REHEARSAL_GLUE = 16;

export type DnssecChange = 'unchanged' | 'enable' | 'rotate' | 'disable';
export type DnsChangeFinding = Readonly<{
  id: string;
  state: 'ready' | 'review' | 'blocked' | 'unknown';
  label: string;
  detail: string;
}>;
export type DnsChangeRehearsal = Readonly<{
  version: 1;
  ready: boolean;
  currentNameservers: readonly string[];
  proposedNameservers: readonly string[];
  glue: readonly { nameserver: string; addresses: readonly string[] }[];
  findings: readonly DnsChangeFinding[];
  sequence: readonly string[];
  rollback: readonly string[];
  limitations: readonly string[];
}>;

type Input = Readonly<{
  domain: string;
  currentNameservers: readonly string[];
  registryNameservers: readonly string[];
  proposedNameservers: string;
  proposedGlue: string;
  dnssecChange: DnssecChange;
  ttlLowered: boolean;
  zonePrepublished: boolean;
  currentEvidenceComplete: boolean;
}>;

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

function hostname(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.+$/u, '');
  return normalized && !CONTROL.test(normalized) && HOSTNAME.test(normalized) ? normalized : '';
}

function nameservers(value: string | readonly string[]): string[] {
  const source: readonly string[] = typeof value === 'string'
    ? value.split(/[\s,]+/u)
    : value;
  return [...new Set(source.slice(0, MAX_REHEARSAL_NAMESERVERS * 3)
    .map((item) => hostname(String(item)))
    .filter(Boolean))]
    .sort()
    .slice(0, MAX_REHEARSAL_NAMESERVERS);
}

function address(value: string): string {
  const candidate = value.trim().toLowerCase();
  if (candidate.length > 80 || CONTROL.test(candidate) || candidate.includes('%')) return '';
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(candidate)) {
    const parts = candidate.split('.').map(Number);
    return parts.every((part) => part >= 0 && part <= 255) ? candidate : '';
  }
  return /^[a-f0-9:]+$/u.test(candidate) && candidate.includes(':') ? candidate : '';
}

function glueRows(value: string): Array<{ nameserver: string; addresses: string[] }> {
  const byHost = new Map<string, Set<string>>();
  for (const line of value.split(/\r?\n/u).slice(0, MAX_REHEARSAL_GLUE * 2)) {
    const [rawHost, ...rawAddresses] = line.trim().split(/[\s,]+/u);
    const host = hostname(rawHost ?? '');
    if (!host) continue;
    const current = byHost.get(host) ?? new Set<string>();
    for (const rawAddress of rawAddresses.slice(0, 4)) {
      const normalized = address(rawAddress);
      if (normalized) current.add(normalized);
      if (current.size >= 2) break;
    }
    byHost.set(host, current);
    if (byHost.size >= MAX_REHEARSAL_GLUE) break;
  }
  return [...byHost.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([nameserver, values]) => ({ nameserver, addresses: [...values] }));
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function finding(
  id: string,
  state: DnsChangeFinding['state'],
  label: string,
  detail: string,
): DnsChangeFinding {
  return { id, state, label, detail };
}

export function buildDnsChangeRehearsal(input: Input): DnsChangeRehearsal {
  const domain = hostname(input.domain);
  const current = nameservers(input.currentNameservers);
  const registry = nameservers(input.registryNameservers);
  const proposed = nameservers(input.proposedNameservers);
  const glue = glueRows(input.proposedGlue);
  const inBailiwick = proposed.filter((item) => item === domain || item.endsWith(`.${domain}`));
  const missingGlue = inBailiwick.filter((item) => !glue.some((row) => (
    row.nameserver === item && row.addresses.length > 0
  )));
  const changingNameservers = proposed.length > 0 && !sameSet(current, proposed);
  const findings: DnsChangeFinding[] = [];

  findings.push(!input.currentEvidenceComplete
    ? finding('current_evidence', 'unknown', 'Current evidence is incomplete', 'Refresh and review the registry, parent, and direct nameserver observations before using this rehearsal.')
    : current.length && registry.length && sameSet(current, registry)
      ? finding('current_evidence', 'ready', 'Current delegation agrees', 'The retained parent view and registry nameserver publication are equivalent.')
      : finding('current_evidence', 'review', 'Resolve the current delegation first', 'The retained parent and registry nameserver sets are unavailable or differ.'));
  findings.push(proposed.length
    ? finding('proposed_nameservers', changingNameservers ? 'review' : 'ready', changingNameservers ? 'Nameserver change proposed' : 'Nameserver set is unchanged', changingNameservers ? `${proposed.length} proposed nameserver${proposed.length === 1 ? '' : 's'} will replace the retained parent view.` : 'No parent nameserver change is represented by this input.')
    : finding('proposed_nameservers', 'blocked', 'Enter the intended nameservers', 'A rehearsal cannot be evaluated until the complete intended nameserver set is entered.'));
  findings.push(!inBailiwick.length
    ? finding('glue', 'ready', 'No proposed in-bailiwick glue dependency', 'None of the proposed nameservers is inside the domain being changed.')
    : missingGlue.length
      ? finding('glue', 'blocked', 'Proposed in-bailiwick glue is incomplete', `Add a public address for: ${missingGlue.join(', ')}.`)
      : finding('glue', 'ready', 'Proposed in-bailiwick glue is represented', `${inBailiwick.length} in-bailiwick nameserver${inBailiwick.length === 1 ? '' : 's'} has an entered address.`));
  findings.push(changingNameservers && !input.ttlLowered
    ? finding('ttl', 'review', 'TTL reduction is not confirmed', 'Lower relevant TTLs before the change and wait for the previous TTL window when operationally appropriate.')
    : finding('ttl', 'ready', changingNameservers ? 'TTL preparation confirmed' : 'TTL preparation is not required by this rehearsal', changingNameservers ? 'The analyst confirmed that relevant TTL preparation was completed.' : 'The nameserver set is unchanged.'));
  findings.push(changingNameservers && !input.zonePrepublished
    ? finding('zone', 'blocked', 'Proposed authorities are not confirmed ready', 'Publish and verify the complete zone on every proposed authority before changing the parent delegation.')
    : finding('zone', 'ready', changingNameservers ? 'Proposed zone readiness confirmed' : 'No new authority readiness gate', changingNameservers ? 'The analyst confirmed that the proposed authorities are already serving the intended zone.' : 'The nameserver set is unchanged.'));

  if (input.dnssecChange === 'enable') {
    findings.push(finding('dnssec', 'review', 'DNSSEC enablement needs a validated DS sequence', 'Verify the signed zone on every authority before publishing the matching DS at the registry.'));
  } else if (input.dnssecChange === 'rotate') {
    findings.push(finding('dnssec', 'review', 'DNSSEC rotation needs overlap', 'Maintain the required overlap by publishing and validating the new signing material before retiring the previous DS or key according to the chosen rollover method.'));
  } else if (input.dnssecChange === 'disable') {
    findings.push(finding('dnssec', 'review', 'DNSSEC removal order matters', 'Remove the parent DS and allow caches to expire before serving an unsigned zone.'));
  } else {
    findings.push(finding('dnssec', 'ready', 'No DNSSEC publication change declared', 'This rehearsal assumes the current DNSSEC relationship remains unchanged.'));
  }

  const ready = proposed.length > 0 && !findings.some((item) => item.state === 'blocked' || item.state === 'unknown');
  const sequence = [
    'Confirm the retained current parent, registry, and direct-authority evidence is fresh enough for the planned change.',
    ...(changingNameservers ? [
      'Lower relevant TTLs and wait for the prior cache window when the operating plan requires it.',
      'Publish the complete intended zone on every proposed authority and verify it directly.',
      ...(inBailiwick.length ? ['Publish or update required registry glue before relying on an in-bailiwick nameserver.'] : []),
    ] : []),
    ...(input.dnssecChange === 'enable' ? ['Validate the signed zone first, then publish the matching parent DS.'] : []),
    ...(input.dnssecChange === 'rotate' ? ['Maintain the required DNSSEC overlap until old validation paths can be retired safely.'] : []),
    ...(input.dnssecChange === 'disable' ? ['Remove the parent DS and wait for expiry before making the zone unsigned.'] : []),
    ...(changingNameservers ? ['Submit the parent nameserver change only after all readiness gates are reviewed.'] : []),
    'Re-run a complete external check after the change and keep failed or location-dependent observations inconclusive.',
  ];

  return {
    version: DNS_CHANGE_REHEARSAL_VERSION,
    ready,
    currentNameservers: current,
    proposedNameservers: proposed,
    glue,
    findings,
    sequence,
    rollback: [
      'Retain the previous nameserver, glue, zone, and DS values in the approved change record.',
      'Define the condition that triggers rollback before making a parent or DNSSEC change.',
      'Restore the last reviewed parent and DNSSEC publication only through the registry or DNS provider control plane.',
      'Verify the rolled-back state directly and through recursive observations; cached disagreement can persist temporarily.',
    ],
    limitations: [
      'This is a local planning aid. It does not change DNS, query a provider account, submit a registry update, or verify authorization.',
      'Entered nameservers and glue are analyst assertions, not observed evidence.',
      'Point-in-time observations and generic sequencing cannot replace the registry, DNS operator, and DNSSEC rollover procedures for the affected zone.',
      'A ready rehearsal means the entered gates are represented; it does not guarantee propagation, correctness, availability, or a successful change.',
    ],
  };
}
