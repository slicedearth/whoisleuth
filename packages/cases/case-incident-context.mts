// Pure incident context parsing and retention projection; no storage or Case mutation.

import { canonicalRegistrableDomain } from '../analysis/registrable-domain.mts';
import { MAX_CASE_OBJECTIVE_LENGTH } from '../contracts/case-portability.mts';
import { parseCredentialFreeHttpUrl } from '../evidence/lookup-target.mts';
import type { CaseRecord } from './case-record-contracts.mts';

export const MAX_CASE_INCIDENT_URL_LENGTH = 1_850;

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
  id: string;
  updatedAt: string;
}>;

function boundedContextText(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

export function normalizeCaseObjective(value: unknown): string {
  return boundedContextText(value, MAX_CASE_OBJECTIVE_LENGTH);
}

export function parseIncidentUrlContext(value: unknown): IncidentUrlContext | null {
  const parsed = parseCredentialFreeHttpUrl(value, MAX_CASE_INCIDENT_URL_LENGTH);
  if (!parsed) return null;
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
  return record?.workflowMetadata?.investigationContext ?? null;
}

export function prepareCaseInvestigationContext(input: Readonly<{
  objective: unknown;
  incidentUrl: unknown;
  retainExactUrl: boolean;
}>): Omit<CaseInvestigationContext, 'id' | 'updatedAt'> {
  const objective = normalizeCaseObjective(input.objective);
  if (!objective) throw new Error('Enter the investigation objective before retaining Incident context.');
  const parsed = parseIncidentUrlContext(input.incidentUrl);
  if (!parsed) throw new Error(`Enter one absolute HTTP(S) Incident URL of at most ${MAX_CASE_INCIDENT_URL_LENGTH} characters without credentials.`);
  const retention = input.retainExactUrl ? 'exact' : 'origin_only';
  const retainedUrl = input.retainExactUrl ? parsed.exactUrl : parsed.originUrl;
  return Object.freeze({
    objective,
    incidentUrl: retainedUrl,
    urlRetention: retention,
  });
}
