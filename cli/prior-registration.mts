import { LOOKUP_EVIDENCE_SCHEMA } from '../packages/contracts/lookup-evidence.mts';
import { MAX_CT_RESPONSE_RESULTS } from '../packages/analysis/ct-response-bounds.mts';
import { boundedJsonLimitsForBytes, parseBoundedJsonObject } from '../packages/analysis/bounded-json.mts';
import { canonicalRegistrableDomain } from '../packages/analysis/registrable-domain.mts';
import {
  PRIOR_REGISTRATION_STATE_LABELS, reviewPriorRegistration, type PriorRegistrationReview, type PriorRegistrationSource,
} from '../packages/evidence/prior-registration.mts';
import { readWebArchiveHistory } from '../packages/evidence/web-archive-history.mts';
import { buildLookupKeyFacts } from '../lib/lookup-key-facts.mts';
import { parseLookupEvidenceReplay } from '../lib/lookup-evidence-replay.mts';
import { CliUsageError } from './errors.mts';
import { safeTerminalValue } from './formatters/terminal-shared.mts';
import { parseCliLookupDocument } from './saved-lookup.mts';

// Compares a saved Lookup's registration creation date with a certificate-log
// search and a web archive history for the same domain, offline, using the
// same assessment as browser Bulk review and Lookup's web archive panel.

export const CLI_PRIOR_REGISTRATION_SCHEMA = 'whoisleuth.cli.prior-registration';
export const CLI_PRIOR_REGISTRATION_VERSION = 1;
export const MAX_PRIOR_REGISTRATION_SUPPORTING_BYTES = 4 * 1024 * 1024;

export type CliPriorRegistrationDocument = Readonly<{
  schema: typeof CLI_PRIOR_REGISTRATION_SCHEMA;
  version: typeof CLI_PRIOR_REGISTRATION_VERSION;
  generatedAt: string;
  domain: string;
  registrationSource: string | null;
  review: PriorRegistrationReview;
}>;

type Registration = Readonly<{ domain: string; createdAt: string | null; source: string | null }>;

async function readRegistration(raw: string): Promise<Registration> {
  let schema: unknown;
  try { schema = (JSON.parse(raw) as Record<string, unknown> | null)?.schema; } catch { schema = undefined; }
  if (schema === LOOKUP_EVIDENCE_SCHEMA) {
    let replay;
    try { replay = await parseLookupEvidenceReplay(raw); }
    catch (error) { throw new CliUsageError(`Evidence export: ${error instanceof Error ? error.message : 'the file is invalid.'}`); }
    const created = replay.facts.find((fact) => fact.id === 'registration.created');
    const domain = canonicalRegistrableDomain(replay.caseDomain ?? replay.target);
    if (!domain) throw new CliUsageError('The evidence export does not describe a registrable domain.');
    return { domain, createdAt: created?.value ?? null, source: created?.source ?? null };
  }
  let document;
  try { document = parseCliLookupDocument(raw); }
  catch (error) { throw new CliUsageError(`Saved Lookup: ${error instanceof Error ? error.message : 'the file is invalid.'}`); }
  const domain = typeof document.registrableDomain === 'string' ? canonicalRegistrableDomain(document.registrableDomain) : null;
  if (document.type !== 'domain' || !domain) throw new CliUsageError('prior-registration needs a saved domain Lookup or its evidence export.');
  const created = buildLookupKeyFacts(document).find((fact) => fact.id === 'registration.created');
  return { domain, createdAt: created?.value ?? null, source: created?.value ? created.source : null };
}

function certificateObservation(raw: string, domain: string): string | null {
  const document = parseBoundedJsonObject(raw, { label: 'Certificate search result', maximumBytes: MAX_PRIOR_REGISTRATION_SUPPORTING_BYTES,
    limits: boundedJsonLimitsForBytes(MAX_PRIOR_REGISTRATION_SUPPORTING_BYTES) });
  if (document.schema !== 'whoisleuth.cli.ct-search' || !Array.isArray(document.matches) || document.matches.length > MAX_CT_RESPONSE_RESULTS) {
    throw new CliUsageError('--ct-results expects JSON written by whoisleuth ct-search --json.');
  }
  const match = (document.matches as unknown[]).find((item) => item && typeof item === 'object'
    && canonicalRegistrableDomain((item as Record<string, unknown>).domain) === domain) as Record<string, unknown> | undefined;
  return typeof match?.firstObservedAt === 'string' ? match.firstObservedAt : null;
}

function archiveObservation(raw: string, domain: string): string | null {
  let report;
  try { report = readWebArchiveHistory(parseBoundedJsonObject(raw, { label: 'Web archive history', maximumBytes: MAX_PRIOR_REGISTRATION_SUPPORTING_BYTES })); }
  catch { throw new CliUsageError('--archive-history expects JSON written by whoisleuth archive-history --json.'); }
  if (report.domain !== domain) throw new CliUsageError('The web archive history describes a different domain from the Lookup.');
  return report.queries.find((query) => query.kind === 'earliest')?.capturedAt ?? null;
}

export async function buildCliPriorRegistration(input: Readonly<{
  registration: string; certificateResults?: string | null; archiveHistory?: string | null;
}>, generatedAt = new Date().toISOString()): Promise<CliPriorRegistrationDocument> {
  if (!input.certificateResults && !input.archiveHistory) {
    throw new CliUsageError('prior-registration needs --ct-results, --archive-history or both.');
  }
  const registration = await readRegistration(input.registration);
  const observations: Array<{ source: PriorRegistrationSource; observedAt: string | null }> = [
    ...(input.certificateResults ? [{ source: 'certificate_log' as const, observedAt: certificateObservation(input.certificateResults, registration.domain) }] : []),
    ...(input.archiveHistory ? [{ source: 'web_archive' as const, observedAt: archiveObservation(input.archiveHistory, registration.domain) }] : []),
  ];
  return Object.freeze({
    schema: CLI_PRIOR_REGISTRATION_SCHEMA,
    version: CLI_PRIOR_REGISTRATION_VERSION,
    generatedAt,
    domain: registration.domain,
    registrationSource: registration.source,
    review: reviewPriorRegistration({ registrationCreatedAt: registration.createdAt, observations }),
  });
}

export function formatCliPriorRegistration(document: CliPriorRegistrationDocument): string {
  const { review } = document;
  const lines = [
    'Prior registration review',
    `Domain           ${safeTerminalValue(document.domain)}`,
    `Created          ${safeTerminalValue(review.registrationCreatedAt, 'Unavailable')}${document.registrationSource ? ` (${safeTerminalValue(document.registrationSource)})` : ''}`,
    `Result           ${PRIOR_REGISTRATION_STATE_LABELS[review.state]}`,
  ];
  for (const observation of review.observations) {
    lines.push(`${observation.label.padEnd(29)}${safeTerminalValue(observation.observedAt)}${observation.daysBeforeRegistration !== null
      ? ` · ${observation.daysBeforeRegistration} days before creation` : ''}`);
  }
  lines.push('', ...review.limitations);
  return `${lines.join('\n')}\n`;
}
