import {
  DNS_CHANGE_REHEARSAL_EXPORT_SCHEMA,
  DNS_CHANGE_REHEARSAL_VERSION,
} from '../contracts/analyst-interchange.mts';
import { canonicalPublicIpAddress } from '../evidence/public-address-policy.mts';
import { canonicalCaaRecord, canonicalDsRecord, canonicalMxRecord } from '../evidence/domain-control-runtime.mts';

export {
  DNS_CHANGE_REHEARSAL_EXPORT_SCHEMA,
  DNS_CHANGE_REHEARSAL_VERSION,
} from '../contracts/analyst-interchange.mts';
export const MAX_REHEARSAL_NAMESERVERS = 8;
export const MAX_REHEARSAL_GLUE = 16;
export const MAX_REHEARSAL_RECORDS = 32;

export type DnssecChange = 'unchanged' | 'enable' | 'rotate' | 'disable';
export type RegistrarLockChange = 'unchanged' | 'enable' | 'disable';
export type CertificateKeyChange = 'unchanged' | 'rotate';
export type DnsChangeFinding = Readonly<{
  id: string;
  state: 'ready' | 'review' | 'blocked' | 'unknown';
  label: string;
  detail: string;
}>;
export type DnsChangeRehearsal = Readonly<{
  version: 2;
  ready: boolean;
  observed: Readonly<{
    nameservers: readonly string[];
    registryNameservers: readonly string[];
    glue: readonly { nameserver: string; addresses: readonly string[] }[];
    ds: readonly string[];
    mx: readonly string[];
    caa: readonly string[];
    criticalAddresses: readonly { hostname: string; addresses: readonly string[] }[];
    registrarLock: 'observed' | 'unknown';
    tlsSpkiSha256: string | null;
    complete: boolean;
  }>;
  proposed: Readonly<{
    nameservers: readonly string[];
    glue: readonly { nameserver: string; addresses: readonly string[] }[];
    ds: readonly string[];
    mx: readonly string[];
    caa: readonly string[];
    criticalAddresses: readonly { hostname: string; addresses: readonly string[] }[];
    dnssecChange: DnssecChange;
    registrarLockChange: RegistrarLockChange;
    certificateKeyChange: CertificateKeyChange;
    tlsSpkiSha256: string | null;
    certificateReplacementReady: boolean;
  }>;
  findings: readonly DnsChangeFinding[];
  sequence: readonly string[];
  rollback: readonly string[];
  unknowns: readonly string[];
  limitations: readonly string[];
}>;

export type DnsChangeRehearsalInput = Readonly<{
  domain: string;
  currentNameservers: readonly string[];
  registryNameservers: readonly string[];
  currentGlue?: readonly unknown[];
  currentDs?: readonly unknown[];
  currentMx?: readonly unknown[];
  currentCaa?: readonly unknown[];
  currentCriticalAddresses?: readonly unknown[];
  currentRegistrationStatuses?: readonly unknown[];
  currentTlsSpkiSha256?: unknown;
  proposedNameservers: string;
  proposedGlue: string;
  proposedDs?: string;
  proposedMx?: string;
  proposedCaa?: string;
  proposedCriticalAddresses?: string;
  dnssecChange: DnssecChange;
  registrarLockChange: RegistrarLockChange;
  certificateKeyChange: CertificateKeyChange;
  proposedTlsSpkiSha256?: string;
  certificateReplacementReady: boolean;
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

type IntendedValues<T> = Readonly<{
  values: T[];
  invalid: number;
  omitted: number;
}>;

function intendedNameservers(value: string): IntendedValues<string> {
  const source = value.split(/[\s,]+/u).filter(Boolean);
  const candidates = source.slice(0, MAX_REHEARSAL_NAMESERVERS * 3);
  const valid = new Set<string>();
  let invalid = 0;
  for (const item of candidates) {
    const normalized = hostname(item);
    if (normalized) valid.add(normalized);
    else invalid += 1;
  }
  const sorted = [...valid].sort();
  return {
    values: sorted.slice(0, MAX_REHEARSAL_NAMESERVERS),
    invalid,
    omitted: Math.max(0, source.length - candidates.length)
      + Math.max(0, sorted.length - MAX_REHEARSAL_NAMESERVERS),
  };
}

function address(value: string): string {
  const candidate = value.trim().toLowerCase();
  if (candidate.length > 80 || CONTROL.test(candidate)) return '';
  return canonicalPublicIpAddress(candidate) ?? '';
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

function intendedAddressRows(
  value: string | undefined,
  maximumRows: number,
): IntendedValues<{ hostname: string; addresses: string[] }> {
  const source = (value ?? '').split(/\r?\n/u).filter((line) => line.trim());
  const candidates = source.slice(0, maximumRows * 2);
  const byHost = new Map<string, Set<string>>();
  let invalid = 0;
  let omitted = Math.max(0, source.length - candidates.length);
  for (const line of candidates) {
    const [rawHost, ...rawAddresses] = line.trim().split(/[\s,]+/u);
    const host = hostname(rawHost ?? '');
    if (!host) {
      invalid += 1;
      continue;
    }
    if (!byHost.has(host) && byHost.size >= maximumRows) {
      omitted += 1;
      continue;
    }
    const current = byHost.get(host) ?? new Set<string>();
    if (rawAddresses.length === 0) invalid += 1;
    for (const rawAddress of rawAddresses.slice(0, 4)) {
      const normalized = address(rawAddress);
      if (!normalized) {
        invalid += 1;
        continue;
      }
      if (!current.has(normalized) && current.size >= 2) omitted += 1;
      else current.add(normalized);
    }
    omitted += Math.max(0, rawAddresses.length - 4);
    byHost.set(host, current);
  }
  return {
    values: [...byHost.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([rowHostname, addresses]) => ({ hostname: rowHostname, addresses: [...addresses].sort() })),
    invalid,
    omitted,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedLine(value: unknown, maximum = 500): string {
  if (typeof value !== 'string' || CONTROL.test(value) || value.length > maximum * 2) return '';
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

function recordInput(
  value: string | readonly unknown[] | undefined,
  normalize: (value: unknown) => string,
): IntendedValues<string> {
  const values: readonly unknown[] = typeof value === 'string'
    ? value.split(/\r?\n/u).filter((line) => line.trim())
    : Array.isArray(value)
      ? value
      : [];
  const candidates = values.slice(0, MAX_REHEARSAL_RECORDS * 3);
  const output = new Set<string>();
  let invalid = value !== undefined && typeof value !== 'string' && !Array.isArray(value) ? 1 : 0;
  for (const item of candidates) {
    let normalised = '';
    try {
      normalised = normalize(item);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    if (normalised) output.add(normalised);
    else invalid += 1;
  }
  const sorted = [...output].sort();
  return {
    values: sorted.slice(0, MAX_REHEARSAL_RECORDS),
    invalid,
    omitted: values.length - candidates.length + Math.max(0, sorted.length - MAX_REHEARSAL_RECORDS),
  };
}

function addressRows(value: string | readonly unknown[] | undefined): Array<{ hostname: string; addresses: string[] }> {
  if (typeof value === 'string') {
    return glueRows(value).map((row) => ({ hostname: row.nameserver, addresses: row.addresses }));
  }
  const byHost = new Map<string, Set<string>>();
  for (const item of (Array.isArray(value) ? value : []).slice(0, MAX_REHEARSAL_RECORDS * 3)) {
    const candidate = record(item);
    const host = hostname(String(candidate.hostname ?? candidate.name ?? ''));
    if (!host) continue;
    const values = Array.isArray(candidate.addresses) ? candidate.addresses : [];
    const current = byHost.get(host) ?? new Set<string>();
    for (const itemAddress of values.slice(0, 4)) {
      const normalized = address(String(itemAddress));
      if (normalized) current.add(normalized);
      if (current.size >= 2) break;
    }
    byHost.set(host, current);
    if (byHost.size >= MAX_REHEARSAL_RECORDS) break;
  }
  return [...byHost.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([rowHostname, addresses]) => ({ hostname: rowHostname, addresses: [...addresses].sort() }));
}

function glueInputRows(value: string | readonly unknown[] | undefined): Array<{ nameserver: string; addresses: string[] }> {
  return addressRows(value).map((row) => ({ nameserver: row.hostname, addresses: row.addresses }));
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function tlsSpkiSha256(value: unknown): string | null {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replaceAll(':', '')
    : '';
  return /^[a-f0-9]{64}$/u.test(normalized) ? normalized : null;
}

function registrarLockState(value: readonly unknown[] | undefined): 'observed' | 'unknown' {
  for (const item of Array.isArray(value) ? value.slice(0, MAX_REHEARSAL_RECORDS) : []) {
    const normalized = String(item).toLowerCase().replace(/[^a-z]/gu, '');
    if (normalized === 'clienttransferprohibited') return 'observed';
  }
  return 'unknown';
}

function finding(
  id: string,
  state: DnsChangeFinding['state'],
  label: string,
  detail: string,
): DnsChangeFinding {
  return { id, state, label, detail };
}

function recordSetFinding(
  id: string,
  label: string,
  observed: readonly string[],
  proposed: readonly string[],
  qualification?: Readonly<{ intended: IntendedValues<string>; current: IntendedValues<string> }>,
): DnsChangeFinding {
  if (qualification?.intended.invalid || qualification?.intended.omitted) {
    return finding(id, 'blocked', `${label} intent is incomplete`, `${qualification.intended.values.length} admitted, ${qualification.intended.invalid} invalid and ${qualification.intended.omitted} over-bound intended records. Resolve the complete input before comparing it with observed evidence.`);
  }
  if (qualification?.current.invalid || qualification?.current.omitted) {
    return finding(id, 'unknown', `Current ${label.toLowerCase()} is incomplete`, `${qualification.current.values.length} admitted, ${qualification.current.invalid} invalid and ${qualification.current.omitted} over-bound observed records. The retained subset cannot establish equality or removal.`);
  }
  if (!proposed.length) {
    return finding(id, 'unknown', `${label} is not represented`, `No intended ${label.toLowerCase()} set was entered. An empty field is not interpreted as a request to remove current records.`);
  }
  if (!observed.length) {
    return finding(id, 'unknown', `Current ${label.toLowerCase()} is unavailable`, `The intended set contains ${proposed.length} record${proposed.length === 1 ? '' : 's'}, but no compatible current observation was retained for comparison.`);
  }
  return sameSet(observed, proposed)
    ? finding(id, 'ready', `${label} is unchanged`, `The intended and observed sets contain the same ${proposed.length} normalized record${proposed.length === 1 ? '' : 's'}.`)
    : finding(id, 'review', `${label} change proposed`, `Observed: ${observed.join(' | ')}. Intended: ${proposed.join(' | ')}.`);
}

export function buildDnsChangeRehearsal(input: DnsChangeRehearsalInput): DnsChangeRehearsal {
  const domain = hostname(input.domain);
  const current = nameservers(input.currentNameservers);
  const registry = nameservers(input.registryNameservers);
  const proposedNameserverInput = intendedNameservers(input.proposedNameservers);
  const proposed = proposedNameserverInput.values;
  const currentGlue = glueInputRows(input.currentGlue);
  const proposedGlueInput = intendedAddressRows(input.proposedGlue, MAX_REHEARSAL_GLUE);
  const glue = proposedGlueInput.values.map((row) => ({ nameserver: row.hostname, addresses: row.addresses }));
  const currentDsInput = recordInput(input.currentDs, canonicalDsRecord);
  const proposedDsInput = recordInput(input.proposedDs, canonicalDsRecord);
  const currentMxInput = recordInput(input.currentMx, canonicalMxRecord);
  const proposedMxInput = recordInput(input.proposedMx, canonicalMxRecord);
  const currentCaaInput = recordInput(input.currentCaa, canonicalCaaRecord);
  const proposedCaaInput = recordInput(input.proposedCaa, canonicalCaaRecord);
  const currentDs = currentDsInput.values;
  const proposedDs = proposedDsInput.values;
  const currentMx = currentMxInput.values;
  const proposedMx = proposedMxInput.values;
  const currentCaa = currentCaaInput.values;
  const proposedCaa = proposedCaaInput.values;
  const currentComplete = input.currentEvidenceComplete && [currentDsInput, currentMxInput, currentCaaInput]
    .every((item) => !item.invalid && !item.omitted);
  const currentCriticalAddresses = addressRows(input.currentCriticalAddresses);
  const proposedCriticalAddressInput = intendedAddressRows(input.proposedCriticalAddresses, MAX_REHEARSAL_RECORDS);
  const proposedCriticalAddresses = proposedCriticalAddressInput.values;
  const currentRegistrarLock = registrarLockState(input.currentRegistrationStatuses);
  const currentTlsSpkiSha256 = tlsSpkiSha256(input.currentTlsSpkiSha256);
  const proposedTlsSpkiSha256 = tlsSpkiSha256(input.proposedTlsSpkiSha256);
  const inBailiwick = proposed.filter((item) => item === domain || item.endsWith(`.${domain}`));
  const missingGlue = inBailiwick.filter((item) => !glue.some((row) => (
    row.nameserver === item && row.addresses.length > 0
  )));
  const changingNameservers = proposed.length > 0 && !sameSet(current, proposed);
  const findings: DnsChangeFinding[] = [];
  const invalidIntendedValues = proposedNameserverInput.invalid
    + proposedGlueInput.invalid
    + proposedCriticalAddressInput.invalid
    + proposedDsInput.invalid + proposedMxInput.invalid + proposedCaaInput.invalid;
  const omittedIntendedValues = proposedNameserverInput.omitted
    + proposedGlueInput.omitted
    + proposedCriticalAddressInput.omitted
    + proposedDsInput.omitted + proposedMxInput.omitted + proposedCaaInput.omitted;

  findings.push(invalidIntendedValues || omittedIntendedValues
    ? finding(
        'intended_input',
        'blocked',
        'Resolve invalid or omitted intended values',
        `${invalidIntendedValues} invalid and ${omittedIntendedValues} over-bound intended value${invalidIntendedValues + omittedIntendedValues === 1 ? ' was' : 's were'} not admitted. Review all intended DNS and public-address inputs before using this rehearsal.`,
      )
    : finding('intended_input', 'ready', 'Intended values fit the rehearsal contract', 'Every entered DNS record and public address was admitted to the bounded intended configuration.'));

  findings.push(!currentComplete
    ? finding('current_evidence', 'unknown', 'Current evidence is incomplete', 'Refresh and review the registry, recursive resolver, and direct nameserver observations before using this rehearsal.')
    : current.length && registry.length && sameSet(current, registry)
      ? finding('current_evidence', 'ready', 'Current nameserver observations agree', 'The retained recursive resolver observation and registry nameserver publication are equivalent; no direct parent-server observation is inferred.')
      : finding('current_evidence', 'review', 'Resolve the current delegation first', 'The retained recursive and registry nameserver sets are unavailable or differ.'));
  findings.push(proposed.length
    ? finding('proposed_nameservers', changingNameservers ? 'review' : 'ready', changingNameservers ? 'Nameserver change proposed' : 'Nameserver set is unchanged', changingNameservers ? `${proposed.length} proposed nameserver${proposed.length === 1 ? '' : 's'} differ from the retained recursive observation.` : 'No nameserver change is represented by this input.')
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
  findings.push(recordSetFinding('ds', 'DS publication', currentDs, proposedDs, { intended: proposedDsInput, current: currentDsInput }));
  findings.push(recordSetFinding('mx', 'MX routing', currentMx, proposedMx, { intended: proposedMxInput, current: currentMxInput }));
  findings.push(recordSetFinding('caa', 'CAA policy', currentCaa, proposedCaa, { intended: proposedCaaInput, current: currentCaaInput }));
  const observedAddressSet = currentCriticalAddresses.flatMap((row) => row.addresses.map((itemAddress) => `${row.hostname} ${itemAddress}`)).sort();
  const proposedAddressSet = proposedCriticalAddresses.flatMap((row) => row.addresses.map((itemAddress) => `${row.hostname} ${itemAddress}`)).sort();
  findings.push(recordSetFinding('critical_addresses', 'Critical address', observedAddressSet, proposedAddressSet));

  if (input.registrarLockChange === 'enable') {
    findings.push(currentRegistrarLock === 'observed'
      ? finding('registrar_lock', 'ready', 'Registrar transfer lock is already observed', 'A client transfer prohibited status is present in the retained registration evidence. Confirm the state in the registrar control plane before relying on it.')
      : finding('registrar_lock', 'review', 'Registrar transfer lock enablement is planned', 'No client transfer prohibited status was observed. Enable the lock through the authorised registrar control plane and verify a refreshed registration observation.'));
  } else if (input.registrarLockChange === 'disable') {
    findings.push(currentRegistrarLock === 'observed'
      ? finding('registrar_lock', 'review', 'Temporary registrar transfer unlock is planned', 'Keep the unlocked interval as short as the approved procedure permits, complete the authorised operation, then re-enable and verify the lock.')
      : finding('registrar_lock', 'unknown', 'Current registrar transfer-lock state is unknown', 'A lock removal should not be planned from evidence that does not show a client transfer prohibited status. Confirm the current control-plane state first.'));
  } else {
    findings.push(finding(
      'registrar_lock',
      'ready',
      'No registrar transfer-lock change declared',
      currentRegistrarLock === 'observed'
        ? 'A client transfer prohibited status is observed and this rehearsal leaves it unchanged.'
        : 'The retained evidence does not prove the lock state; this rehearsal makes no change to it.',
    ));
  }

  if (input.certificateKeyChange === 'rotate') {
    findings.push(!proposedTlsSpkiSha256
      ? finding('certificate_key', 'blocked', 'Enter the replacement certificate key fingerprint', 'Provide the replacement leaf-certificate SPKI SHA-256 fingerprint so the planned key differs from the retained observation.')
      : currentTlsSpkiSha256 && proposedTlsSpkiSha256 === currentTlsSpkiSha256
        ? finding('certificate_key', 'blocked', 'Replacement certificate key matches the current key', 'A key rotation needs a different reviewed SPKI SHA-256 fingerprint.')
        : !input.certificateReplacementReady
          ? finding('certificate_key', 'blocked', 'Replacement certificate is not confirmed ready', 'Issue and validate the replacement certificate and key on the intended endpoint before retiring the current key.')
          : finding('certificate_key', 'review', 'Certificate key rotation is represented', currentTlsSpkiSha256
            ? 'The entered replacement SPKI SHA-256 differs from the retained leaf-certificate key fingerprint.'
            : 'No compatible current key fingerprint was retained. The replacement is represented, but the analyst must verify the previous key separately.'));
  } else {
    findings.push(finding(
      'certificate_key',
      'ready',
      'No certificate key change declared',
      currentTlsSpkiSha256
        ? 'The retained leaf-certificate SPKI SHA-256 is recorded for rollback comparison.'
        : 'No compatible leaf-certificate key fingerprint was retained; this rehearsal does not infer that a certificate is absent.',
    ));
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
    ...(input.registrarLockChange === 'disable' ? ['Disable the registrar transfer lock only for the approved operation, then re-enable and verify it immediately afterward.'] : []),
    ...(input.registrarLockChange === 'enable' ? ['Enable the registrar transfer lock and confirm the refreshed registration status through the authorised control plane.'] : []),
    ...(input.certificateKeyChange === 'rotate' ? ['Deploy and validate the replacement certificate key before removing the previous certificate or key material.'] : []),
    'Re-run a complete external check after the change and keep failed or location-dependent observations inconclusive.',
  ];
  const unknowns = findings
    .filter((item) => item.state === 'unknown')
    .map((item) => `${item.label}: ${item.detail}`)
    .slice(0, 12);

  return {
    version: DNS_CHANGE_REHEARSAL_VERSION,
    ready,
    observed: {
      nameservers: current,
      registryNameservers: registry,
      glue: currentGlue,
      ds: currentDs,
      mx: currentMx,
      caa: currentCaa,
      criticalAddresses: currentCriticalAddresses,
      registrarLock: currentRegistrarLock,
      tlsSpkiSha256: currentTlsSpkiSha256,
      complete: currentComplete,
    },
    proposed: {
      nameservers: proposed,
      glue,
      ds: proposedDs,
      mx: proposedMx,
      caa: proposedCaa,
      criticalAddresses: proposedCriticalAddresses,
      dnssecChange: input.dnssecChange,
      registrarLockChange: input.registrarLockChange,
      certificateKeyChange: input.certificateKeyChange,
      tlsSpkiSha256: proposedTlsSpkiSha256,
      certificateReplacementReady: input.certificateReplacementReady,
    },
    findings,
    sequence,
    rollback: [
      'Retain the previous nameserver, glue, zone, DS, registrar-lock state, and certificate key fingerprint in the approved change record.',
      'Define the condition that triggers rollback before making a parent or DNSSEC change.',
      'Restore the last reviewed parent and DNSSEC publication only through the registry or DNS provider control plane.',
      'Verify the rolled-back state directly and through recursive observations; cached disagreement can persist temporarily.',
    ],
    unknowns,
    limitations: [
      'This is a local planning aid. It does not change DNS, query a provider account, submit a registry update, or verify authorisation.',
      'Entered nameservers, glue, registrar-lock intent, and replacement key fingerprint are analyst assertions, not observed evidence.',
      'Point-in-time observations and generic sequencing cannot replace the registry, DNS operator, and DNSSEC rollover procedures for the affected zone.',
      'A ready rehearsal means the entered gates are represented; it does not guarantee propagation, correctness, availability, or a successful change.',
    ],
  };
}

export function buildDnsChangeRehearsalExport(
  rehearsal: DnsChangeRehearsal,
  input: Readonly<{ domain: unknown; generatedAt?: unknown }>,
) {
  const domain = hostname(String(input.domain ?? ''));
  if (!domain) throw new Error('A valid rehearsal domain is required.');
  const generatedAtValue = typeof input.generatedAt === 'string' && Number.isFinite(Date.parse(input.generatedAt))
    ? new Date(Date.parse(input.generatedAt)).toISOString()
    : new Date().toISOString();
  return {
    schema: DNS_CHANGE_REHEARSAL_EXPORT_SCHEMA,
    schemaVersion: DNS_CHANGE_REHEARSAL_VERSION,
    generatedAt: generatedAtValue,
    domain,
    reviewState: rehearsal.ready ? 'ready_for_procedural_review' : 'unresolved',
    observed: rehearsal.observed,
    analystProposed: rehearsal.proposed,
    findings: rehearsal.findings,
    sequence: rehearsal.sequence,
    rollback: rehearsal.rollback,
    unknowns: rehearsal.unknowns,
    limitations: rehearsal.limitations,
  };
}
