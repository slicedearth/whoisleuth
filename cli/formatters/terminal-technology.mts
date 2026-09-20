import {
  MAX_EVIDENCE_PER_TECHNOLOGY,
  MAX_LIBRARY_FINDINGS,
  MAX_TECHNOLOGY_FINDINGS,
} from '../../lib/lookup-child-profile-contract.mts';
import {
  TECHNOLOGY_EVIDENCE_ROLE_ORDER,
  technologyEvidenceRoles,
  type TechnologyEvidenceRole,
} from '../../lib/technology-evidence-role.mts';
import { MAX_OBSERVATION_LIMITATIONS, readObservationTime } from '../../packages/evidence/observation.mts';
import { boundedTerminalList, safeTerminalValue, terminalCount, terminalRecord, titleCase, type TerminalRecord } from './terminal-shared.mts';

const ROLE_LABELS: Record<TechnologyEvidenceRole, string> = {
  observed_edge: 'Observed edge',
  application_platform: 'App platform',
  framework_runtime: 'Framework/run',
  embedded_dependency: 'Embedded deps',
};
const SUMMARY_FINDINGS = 6;
const SUMMARY_NAMESERVERS = 5;

function observationLine(label: string, value: unknown, generatedAt: unknown): string {
  const time = readObservationTime(value, generatedAt);
  if (!time.observedAt) return `${label.padEnd(15)}Observed time unavailable`;
  const age = time.ageDays === null ? 'age unavailable'
    : time.ageDays === 0 ? 'less than a day old at output generation'
      : `${time.ageDays} day${time.ageDays === 1 ? '' : 's'} old at output generation`;
  return `${label.padEnd(15)}${time.observedAt} · ${age}`;
}

function appendLimitations(lines: string[], value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const limitation of value.slice(0, MAX_OBSERVATION_LIMITATIONS)) {
    lines.push(`  Limit        ${safeTerminalValue(limitation)}`);
  }
}

/** Presents admitted source records; it never collects or infers a hidden origin. */
export function appendTechnologyLines(lines: string[], input: {
  technology: TerminalRecord;
  libraries: TerminalRecord;
  nameservers: unknown;
  generatedAt: unknown;
  detail: 'summary' | 'standard' | 'verbose';
}): void {
  const { technology, libraries, nameservers, generatedAt, detail } = input;
  if (!technology.status && technology.source !== 'derived') return;
  const suppliedFindings = Array.isArray(technology.findings) ? technology.findings : [];
  const findings = suppliedFindings.slice(0, MAX_TECHNOLOGY_FINDINGS).map((value) => {
    const finding = terminalRecord(value);
    return { finding, roles: technologyEvidenceRoles(finding) };
  });
  lines.push(`Technology     ${titleCase(technology.status)} · ${findings.length} indicator${findings.length === 1 ? '' : 's'}`);
  if (suppliedFindings.length > findings.length) lines.push('Technology     Additional findings exceed the admitted profile limit');
  if (detail === 'summary') return;

  lines.push(observationLine('Tech observed', technology.observedAt, generatedAt));
  if (detail === 'standard' && findings.length) {
    const visible = findings.slice(0, SUMMARY_FINDINGS).map(({ finding }) => {
      const qualifiers = [finding.category, finding.confidence ? `${safeTerminalValue(finding.confidence)} signature strength` : null]
        .filter(Boolean).map((value) => safeTerminalValue(value));
      return `${safeTerminalValue(finding.name, 'Unnamed indicator')}${qualifiers.length ? ` (${qualifiers.join(', ')})` : ''}`;
    });
    lines.push(`Indicators     ${boundedTerminalList(visible, findings.length - visible.length)}`);
  }
  const retainedNameservers = Array.isArray(nameservers) ? nameservers : [];
  const visibleNameservers = retainedNameservers.slice(0, SUMMARY_NAMESERVERS).map((value) => safeTerminalValue(value));
  lines.push(`Nameservers   ${visibleNameservers.length ? boundedTerminalList(visibleNameservers, retainedNameservers.length - visibleNameservers.length) : 'Unavailable'} · identity does not establish operator or web-host ownership`);
  for (const role of TECHNOLOGY_EVIDENCE_ROLE_ORDER) {
    const matching = findings.filter((item) => item.roles.includes(role));
    const names = matching.slice(0, SUMMARY_FINDINGS).map(({ finding }) => safeTerminalValue(finding.name, 'Unnamed indicator'));
    lines.push(`${ROLE_LABELS[role].padEnd(15)}${names.length ? boundedTerminalList(names, matching.length - names.length) : 'None retained'}`);
  }
  lines.push('Origin host    Not established from retained evidence');

  if (detail === 'verbose') {
    for (const { finding, roles } of findings) {
      lines.push(`Indicator      ${safeTerminalValue(finding.name, 'Unnamed indicator')}`);
      lines.push(`  Role         ${roles.map((role) => ROLE_LABELS[role]).join(', ') || 'Not retained'}`);
      lines.push(`  Strength     ${safeTerminalValue(finding.confidence, 'Unknown')} signature strength`);
      const suppliedEvidence = Array.isArray(finding.evidence) ? finding.evidence : [];
      const evidence = suppliedEvidence.slice(0, MAX_EVIDENCE_PER_TECHNOLOGY);
      if (!evidence.length) lines.push('  Signal       No detailed signal was retained');
      for (const value of evidence) {
        const item = terminalRecord(value);
        if (typeof item.source !== 'string' || !item.source.trim()
          || typeof item.description !== 'string' || !item.description.trim()) {
          lines.push('  Signal       Incomplete retained signal record');
          continue;
        }
        const role = TECHNOLOGY_EVIDENCE_ROLE_ORDER.find((candidate) => candidate === item.role);
        lines.push(`  Source       ${safeTerminalValue(item.source, 'Not retained')} · ${role ? ROLE_LABELS[role] : 'Role not retained'}`);
        lines.push(`  Signal       ${safeTerminalValue(item.description, 'Not retained')}`);
      }
      if (suppliedEvidence.length > evidence.length) lines.push('  Limit        Additional signals exceed the admitted profile limit');
    }
    appendLimitations(lines, technology.limitations);
  }

  if (libraries.profileVersion !== 1 && libraries.profileVersion !== 2 && libraries.source !== 'derived') return;
  const suppliedLibraries = Array.isArray(libraries.findings) ? libraries.findings : [];
  const libraryFindings = suppliedLibraries.slice(0, MAX_LIBRARY_FINDINGS).map(terminalRecord);
  const advisoryMatches = libraryFindings.filter((finding) => terminalCount(finding.advisoryCount) > 0).length;
  lines.push(`JS libraries   ${titleCase(libraries.status)} · ${libraryFindings.length} apparent · ${advisoryMatches} with catalogue advisory match${advisoryMatches === 1 ? '' : 'es'}`);
  lines.push(observationLine('Lib observed', libraries.observedAt, generatedAt));
  if (suppliedLibraries.length > libraryFindings.length) lines.push('JS libraries   Additional findings exceed the admitted profile limit');
  if (detail !== 'verbose') return;
  const catalogue = terminalRecord(libraries.catalog);
  lines.push(`Catalogue      ${safeTerminalValue(catalogue.name, 'Component catalogue')} · ${safeTerminalValue(catalogue.version, 'Version unavailable')}`);
  for (const library of libraryFindings) {
    lines.push(`Library        ${safeTerminalValue(library.name, 'Unnamed library')} · ${safeTerminalValue(library.apparentVersion, 'Version unavailable')}`);
    const methods = Array.isArray(library.detectionMethods) ? library.detectionMethods.slice(0, 4).map((value) => safeTerminalValue(value)) : [];
    lines.push(`  Detected by  ${methods.join(', ') || 'Not retained'}`);
    lines.push(`  Advisories   ${terminalCount(library.advisoryCount)} catalogue matches`);
    if (library.highestSeverity) lines.push(`  Severity     ${safeTerminalValue(library.highestSeverity)}`);
    for (const [field, label] of [['advisoryIdentifiers', 'Identifier'], ['knownExploitedIdentifiers', 'Known exploited']] as const) {
      const values = Array.isArray(library[field]) ? library[field] : [];
      for (const value of values.slice(0, 16)) lines.push(`  ${label.padEnd(15)} ${safeTerminalValue(value)}`);
    }
  }
  appendLimitations(lines, libraries.limitations);
}
