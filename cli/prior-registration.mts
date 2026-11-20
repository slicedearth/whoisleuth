import { boundedJsonLimitsForBytes, parseBoundedJsonObject } from '../packages/analysis/bounded-json.mts';
import { canonicalRegistrableDomain } from '../packages/analysis/registrable-domain.mts';
import {
  certificatePriorRegistrationObservations, PRIOR_REGISTRATION_STATE_LABELS, reviewPriorRegistration, selectRegistrationCreation,
  type PriorRegistrationReview, type PriorRegistrationSource,
} from '../packages/evidence/prior-registration.mts';
import { readWebArchiveHistory } from '../packages/evidence/web-archive-history.mts';
import { normalizeCtResponse } from '../packages/investigation/ct-results.mts';
import { certificateChronologyEligibility } from '../packages/evidence/evidence-eligibility.mts';
import { lookupRegistrationCreatedObservations } from '../lib/lookup-key-facts.mts';
import { parseLookupEvidenceReplay } from '../lib/lookup-evidence-replay.mts';
import { CliUsageError } from './errors.mts';
import { isLookupEvidenceText } from './lookup-evidence-format.mts';
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
  /** Supporting observations that were supplied but not used, and why. */
  excludedObservations?: readonly string[];
}>;

type Registration = Readonly<{ domain: string; createdAt: string | null; source: string | null }>;

async function readRegistration(raw: string): Promise<Registration> {
  if (isLookupEvidenceText(raw)) {
    let replay;
    try { replay = await parseLookupEvidenceReplay(raw); }
    catch (error) { throw new CliUsageError(`Evidence export: ${error instanceof Error ? error.message : 'the file is invalid.'}`); }
    const domain = canonicalRegistrableDomain(replay.caseDomain ?? replay.target);
    if (!domain) throw new CliUsageError('The evidence export does not describe a registrable domain.');
    return { domain, createdAt: replay.registrationCreation?.createdAt ?? null, source: replay.registrationCreation?.source ?? null };
  }
  let document;
  try { document = parseCliLookupDocument(raw); }
  catch (error) { throw new CliUsageError(`Saved Lookup: ${error instanceof Error ? error.message : 'the file is invalid.'}`); }
  const domain = typeof document.registrableDomain === 'string' ? canonicalRegistrableDomain(document.registrableDomain) : null;
  if (document.type !== 'domain' || !domain) throw new CliUsageError('prior-registration needs a saved domain Lookup or its evidence export.');
  const selected = selectRegistrationCreation(lookupRegistrationCreatedObservations(document).map((fact) => ({
    source: fact.source, value: fact.value, sourceState: fact.sourceState, complete: fact.complete,
  })));
  return { domain, createdAt: selected?.createdAt ?? null, source: selected?.source ?? null };
}

function certificateObservations(raw: string, domain: string): Readonly<{ observations: readonly Readonly<{ source: PriorRegistrationSource; observedAt: string }>[]; excluded?: string }> {
  const document = parseBoundedJsonObject(raw, { label: 'Certificate search result', maximumBytes: MAX_PRIOR_REGISTRATION_SUPPORTING_BYTES,
    limits: boundedJsonLimitsForBytes(MAX_PRIOR_REGISTRATION_SUPPORTING_BYTES) });
  if (document.schema !== 'whoisleuth.cli.ct-search' || document.version !== 1) {
    throw new CliUsageError('--ct-results expects JSON written by whoisleuth ct-search --json.');
  }
  // The shared normaliser validates counts and dates and merges duplicate
  // domains, keeping the earliest observation, exactly as Discover does.
  let result;
  try { result = normalizeCtResponse(document, document.keyword); }
  catch (error) { throw new CliUsageError(`--ct-results: ${error instanceof Error ? error.message : 'the certificate search result is invalid.'}`); }
  const provenance = result.candidates.find((candidate) => candidate.domain === domain)?.certificateTransparency ?? null;
  // The shared helper admits only an eligible log observation and adds any
  // validity start as context, exactly as Lookup and Bulk do.
  const observations = certificatePriorRegistrationObservations(provenance);
  if (certificateChronologyEligibility(provenance).reason === 'chronology_contradictory') {
    return { observations, excluded: `The certificate search result reports a first observation later than the last for ${domain}, so it was not used.` };
  }
  return { observations };
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
  const certificate = input.certificateResults ? certificateObservations(input.certificateResults, registration.domain) : null;
  const observations: Array<{ source: PriorRegistrationSource; observedAt: string | null }> = [
    ...(certificate?.observations ?? []),
    ...(input.archiveHistory ? [{ source: 'web_archive' as const, observedAt: archiveObservation(input.archiveHistory, registration.domain) }] : []),
  ];
  return Object.freeze({
    schema: CLI_PRIOR_REGISTRATION_SCHEMA,
    version: CLI_PRIOR_REGISTRATION_VERSION,
    generatedAt,
    domain: registration.domain,
    registrationSource: registration.source,
    review: reviewPriorRegistration({ registrationCreatedAt: registration.createdAt, observations }),
    ...(certificate?.excluded ? { excludedObservations: Object.freeze([certificate.excluded]) } : {}),
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
    lines.push(`${observation.label.padEnd(Math.max(29, observation.label.length + 1))}${safeTerminalValue(observation.observedAt)}${observation.daysBeforeRegistration !== null
      ? ` · ${observation.daysBeforeRegistration} days before creation` : ''}${observation.context ? ' · context only' : ''}`);
  }
  lines.push('', ...(document.excludedObservations ?? []), ...review.limitations);
  return `${lines.join('\n')}\n`;
}
