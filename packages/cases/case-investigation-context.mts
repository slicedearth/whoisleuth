import { canonicalRegistrableDomain } from '../../lib/registrable-domain.mts';
import type { CaseRecord } from './case-record-contracts.mts';

export const MAX_CASE_OBJECTIVE_LENGTH = 320;
export const MAX_CASE_INCIDENT_URL_LENGTH = 1_850;
export const INCIDENT_CONTEXT_STATEMENT_PREFIX = 'Investigate incident URL: ';
const OBJECTIVE_PREFIX = 'Objective: ';
const RETENTION_SEPARATOR = ' | URL retained: ';

export type IncidentUrlContext = Readonly<{
  exactUrl: string;
  hostname: string;
  registrableDomain: string;
  originUrl: string;
  hasPath: boolean;
  hasQuery: boolean;
  hasFragment: boolean;
}>;

export type CaseInvestigationContext = Readonly<{
  objective: string;
  incidentUrl: string;
  urlRetention: 'exact' | 'origin_only';
  assertionId: string;
  updatedAt: string;
}>;

function boundedText(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

export function normalizeCaseObjective(value: unknown): string {
  return boundedText(value, MAX_CASE_OBJECTIVE_LENGTH);
}

export function parseIncidentUrlContext(value: unknown): IncidentUrlContext | null {
  if (typeof value !== 'string' || !value || value.length > MAX_CASE_INCIDENT_URL_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/u.test(value) || value.trim() !== value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  const registrableDomain = canonicalRegistrableDomain(hostname);
  if (!registrableDomain) return null;
  const exactUrl = parsed.toString();
  if (exactUrl.length > MAX_CASE_INCIDENT_URL_LENGTH) return null;
  return Object.freeze({
    exactUrl,
    hostname,
    registrableDomain,
    originUrl: parsed.origin,
    hasPath: parsed.pathname !== '/',
    hasQuery: Boolean(parsed.search),
    hasFragment: Boolean(parsed.hash),
  });
}

export function caseInvestigationContext(record: CaseRecord | null | undefined): CaseInvestigationContext | null {
  if (!record) return null;
  for (const assertion of [...record.assertions].reverse()) {
    if (assertion.kind !== 'next_step' || assertion.state !== 'open'
      || !assertion.statement.startsWith(INCIDENT_CONTEXT_STATEMENT_PREFIX)) continue;
    const incidentUrl = assertion.statement.slice(INCIDENT_CONTEXT_STATEMENT_PREFIX.length);
    const parsed = parseIncidentUrlContext(incidentUrl);
    if (!parsed || parsed.registrableDomain !== record.domain) continue;
    const rationale = assertion.rationale ?? '';
    const separatorIndex = rationale.lastIndexOf(RETENTION_SEPARATOR);
    const objective = separatorIndex > OBJECTIVE_PREFIX.length && rationale.startsWith(OBJECTIVE_PREFIX)
      ? normalizeCaseObjective(rationale.slice(OBJECTIVE_PREFIX.length, separatorIndex))
      : '';
    const retention = separatorIndex >= 0 ? rationale.slice(separatorIndex + RETENTION_SEPARATOR.length) : '';
    if (!objective || (retention !== 'exact' && retention !== 'origin_only')) continue;
    return Object.freeze({
      objective,
      incidentUrl: parsed.exactUrl,
      urlRetention: retention,
      assertionId: assertion.id,
      updatedAt: assertion.updatedAt,
    });
  }
  return null;
}

export function caseInvestigationContextAssertion(input: Readonly<{
  objective: unknown;
  incidentUrl: unknown;
  retainExactUrl: boolean;
}>): Readonly<{ statement: string; rationale: string; retainedUrl: string; retention: 'exact' | 'origin_only' }> {
  const objective = normalizeCaseObjective(input.objective);
  if (!objective) throw new Error('Enter the investigation objective before retaining Incident context.');
  const parsed = parseIncidentUrlContext(input.incidentUrl);
  if (!parsed) throw new Error(`Enter one absolute HTTP(S) Incident URL of at most ${MAX_CASE_INCIDENT_URL_LENGTH} characters without credentials.`);
  const retention = input.retainExactUrl ? 'exact' : 'origin_only';
  const retainedUrl = input.retainExactUrl ? parsed.exactUrl : parsed.originUrl;
  return Object.freeze({
    statement: `${INCIDENT_CONTEXT_STATEMENT_PREFIX}${retainedUrl}`,
    rationale: `${OBJECTIVE_PREFIX}${objective}${RETENTION_SEPARATOR}${retention}`,
    retainedUrl,
    retention,
  });
}
