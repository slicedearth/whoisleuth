import { parseSavedLookupDocument, type UnknownRecord } from './saved-lookup.mts';
import { safeTerminalValue } from './formatters/terminal.mts';

export const CLI_LOOKUP_BRIEF_SCHEMA = 'whoisleuth.cli.lookup-brief';
export const CLI_LOOKUP_BRIEF_VERSION = 2;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown, maximum = 300): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
  return normalized || null;
}

function sourceState(value: unknown): string {
  return text(value, 40)?.toLowerCase() ?? 'unavailable';
}

export function buildCliLookupBrief(input: string, generatedAt = new Date().toISOString()) {
  const document = parseSavedLookupDocument(input, { label: 'Lookup brief input' });
  const diagnostics = record(document.diagnostics);
  const availability = record(document.availability);
  const rdap = record(record(document.rdap).parsed);
  const whois = record(record(document.whois).parsed);
  const preferred = Object.keys(rdap).length ? rdap : whois;
  const sources = ['rdap', 'whois', 'availability', 'dns', 'http', 'tls'].map((id) => {
    const nested = id === 'dns' || id === 'http' || id === 'tls' ? record(availability[id]) : record(diagnostics[id]);
    return Object.freeze({ id, state: sourceState(nested.status ?? nested.state), observedAt: text(nested.observedAt ?? nested.fetchedAt ?? nested.queriedAt, 64) });
  });
  const facts = [
    ['Registration state', availability.state, 'Authority-aware availability'],
    ['Registrar', record(preferred.registrar).name ?? preferred.registrar, Object.keys(rdap).length ? 'Registry RDAP' : 'WHOIS'],
    ['Created', record(preferred.lifecycle).createdIso ?? preferred.createdDateIso, Object.keys(rdap).length ? 'Registry RDAP' : 'WHOIS'],
    ['Expires', record(preferred.lifecycle).expiryIso ?? preferred.expiryDateIso, Object.keys(rdap).length ? 'Registry RDAP' : 'WHOIS'],
    ['Website activity', availability.activityStatus, 'HTTP'],
    ['Page title', availability.pageTitle, 'Static page identity'],
  ].flatMap(([label, value, source]) => {
    const normalized = text(value);
    return normalized ? [Object.freeze({ label: String(label), value: normalized, source: String(source) })] : [];
  });
  const incomplete = sources.filter((item) => !['complete', 'success'].includes(item.state));
  const analysis = record(document.analysis);
  const contradictions = [analysis.registryComparison, document.registryComparison, document.registrarPublicationComparison]
    .flatMap((value) => Array.isArray(record(value).fields) ? (record(value).fields as unknown[]) : [])
    .flatMap((value) => {
      const item = record(value);
      return item.status === 'conflict' ? [text(item.label, 120) ?? 'Registration publication conflict'] : [];
    }).slice(0, 16);
  const actionPlan = [
    ...(contradictions.length ? [{
      id: 'registration-publication-review',
      action: 'Review the separately attributed registration publications before relying on the conflicting fields.',
      reason: `${contradictions.length} conflicting publication field${contradictions.length === 1 ? '' : 's'} were retained.`,
      expectedOutcome: 'Establish which observation is current, authoritative, or still unresolved.',
      evidence: 'registry publication comparison',
    }] : []),
    ...(incomplete.length ? [{
      id: 'source-state-review',
      action: `Refresh or explain the ${incomplete.map((item) => item.id).join(', ')} source state before treating missing values as meaningful.`,
      reason: 'At least one source was not complete in the saved observation.',
      expectedOutcome: 'Determine whether each limitation is transient, persistent, or expected for that source.',
      evidence: 'source health',
    }] : []),
    ...(document.mode === 'fast' ? [{
      id: 'collection-depth-review',
      action: 'Run a deliberate Deep lookup if DNS, HTTP, TLS, page, or network evidence is required.',
      reason: 'The saved observation used the intentionally narrower Fast contract.',
      expectedOutcome: 'Collect the explicitly selected additional source classes without implying that unavailable evidence is absent.',
      evidence: 'collection mode',
    }] : []),
    {
      id: 'case-evidence-review',
      action: 'Pin only the facts needed for the decision and keep analyst hypotheses separate from observations.',
      reason: 'The brief organises one observation but does not create an analyst decision.',
      expectedOutcome: 'Preserve a reviewable boundary between observed facts, hypotheses, unknowns, and decisions.',
      evidence: 'case workflow',
    },
  ].slice(0, 6).map((item) => Object.freeze(item));
  const recommendedActions = actionPlan.map((item) => item.action);
  return Object.freeze({
    schema: CLI_LOOKUP_BRIEF_SCHEMA,
    version: CLI_LOOKUP_BRIEF_VERSION,
    generatedAt,
    target: document.registrableDomain,
    observedAt: document.generatedAt,
    mode: document.mode,
    facts: Object.freeze(facts),
    sourceHealth: Object.freeze(sources),
    contradictions: Object.freeze(contradictions),
    unknowns: Object.freeze(incomplete.map((item) => `${item.id}: ${item.state}`)),
    actionPlan: Object.freeze(actionPlan),
    recommendedActions: Object.freeze(recommendedActions.slice(0, 6)),
    limitations: Object.freeze([
      'This brief is derived from one saved Lookup and makes no request.',
      'It organises bounded facts and uncertainty but does not create an analyst assertion, decide maliciousness, or establish current state.',
      'Raw registry, provider, HTTP and page payloads are excluded.',
    ]),
  });
}

export function formatCliLookupBrief(document: ReturnType<typeof buildCliLookupBrief>): string {
  return [
    `Lookup brief: ${safeTerminalValue(document.target)}`,
    `Observed  ${safeTerminalValue(document.observedAt)}`,
    `Mode      ${safeTerminalValue(document.mode)}`,
    '',
    'Verified facts',
    ...(document.facts.length ? document.facts.map((item) => `  ${safeTerminalValue(item.label)}: ${safeTerminalValue(item.value)} (${safeTerminalValue(item.source)})`) : ['  No bounded fact was available.']),
    '',
    'Unknown or incomplete',
    ...(document.unknowns.length ? document.unknowns.map((item) => `  ${safeTerminalValue(item)}`) : ['  No incomplete source state was identified.']),
    '',
    'Recommended manual actions',
    ...document.actionPlan.flatMap((item, index) => [
      `  ${index + 1}. ${safeTerminalValue(item.action)}`,
      `     Expected outcome: ${safeTerminalValue(item.expectedOutcome)}`,
    ]),
    '',
  ].join('\n');
}
