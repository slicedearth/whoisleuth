import type { CaseRecord } from './case-model.ts';

export const CASE_SIGHTING_STIX_EXPORT_VERSION = 1;
export const MAX_CASE_SIGHTING_STIX_OBJECTS = 180;

type IdFactory = (type: string) => unknown;
type ExportOptions = Readonly<{
  generatedAt?: unknown;
  idFactory?: unknown;
}>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const AFFIRMATIVE_STATES = new Set([
  'analyst_confirmed',
  'observed_by_deployment',
  'reported_by_provider',
]);

function text(value: unknown, maximum: number): string {
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function defaultIdFactory(type: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error('Secure random identifiers are unavailable for the STIX export.');
  return `${type}--${uuid}`;
}

function stixId(type: string, factory: IdFactory, used: Set<string>): string {
  const value = factory(type);
  const prefix = `${type}--`;
  if (typeof value !== 'string' || !value.startsWith(prefix) || !UUID_RE.test(value.slice(prefix.length))) {
    throw new Error(`The STIX identifier factory returned an invalid ${type} identifier.`);
  }
  const normalized = value.toLowerCase();
  if (used.has(normalized)) throw new Error('The STIX identifier factory returned a duplicate identifier.');
  used.add(normalized);
  return normalized;
}

function domain(value: unknown): string {
  const normalized = text(value, 253).toLowerCase().replace(/\.$/u, '');
  if (
    !normalized
    || normalized.includes('..')
    || !/^[a-z0-9.-]+$/u.test(normalized)
    || normalized.split('.').some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))
  ) {
    throw new Error('A valid canonical case domain is required for STIX export.');
  }
  return normalized;
}

export function buildCaseSightingStixExport(
  caseRecord: CaseRecord,
  options: ExportOptions = {},
) {
  const generatedAt = timestamp(options.generatedAt) ?? new Date().toISOString();
  const idFactory = typeof options.idFactory === 'function'
    ? options.idFactory as IdFactory
    : defaultIdFactory;
  const target = domain(caseRecord.domain);
  const sightings = caseRecord.sightings.slice(0, 80);
  if (!sightings.length) throw new Error('Record at least one source-qualified sighting before exporting STIX.');

  const used = new Set<string>();
  const nextId = (type: string) => stixId(type, idFactory, used);
  const producerId = nextId('identity');
  const domainId = nextId('domain-name');
  const objects: Array<Record<string, unknown>> = [
    {
      type: 'identity',
      spec_version: '2.1',
      id: producerId,
      created: generatedAt,
      modified: generatedAt,
      name: 'WHOISleuth',
      identity_class: 'system',
      description: 'Producer of a deliberate local export of source-qualified case sightings.',
      x_whoisleuth_export_version: CASE_SIGHTING_STIX_EXPORT_VERSION,
    },
    {
      type: 'domain-name',
      spec_version: '2.1',
      id: domainId,
      value: target,
    },
  ];

  for (const sighting of sightings) {
    const observedAt = timestamp(sighting.observedAt);
    if (!observedAt) continue;
    const source = text(sighting.source, 80) || 'Source not reported';
    const state = text(sighting.state, 40);
    const objectRefs = [domainId];
    if (AFFIRMATIVE_STATES.has(state) && objects.length + 2 <= MAX_CASE_SIGHTING_STIX_OBJECTS) {
      const observedDataId = nextId('observed-data');
      objectRefs.push(observedDataId);
      objects.push({
        type: 'observed-data',
        spec_version: '2.1',
        id: observedDataId,
        created_by_ref: producerId,
        created: generatedAt,
        modified: generatedAt,
        first_observed: observedAt,
        last_observed: observedAt,
        number_observed: 1,
        object_refs: [domainId],
        x_whoisleuth_source_qualified_state: state,
        x_whoisleuth_source_class: sighting.sourceClass,
        x_whoisleuth_source: source,
        x_whoisleuth_category: sighting.category,
        x_whoisleuth_completeness: sighting.completeness,
      });
    }
    if (objects.length >= MAX_CASE_SIGHTING_STIX_OBJECTS) break;
    objects.push({
      type: 'note',
      spec_version: '2.1',
      id: nextId('note'),
      created_by_ref: producerId,
      created: generatedAt,
      modified: generatedAt,
      content: `Source-qualified case sighting: ${state.replaceAll('_', ' ')}; category ${sighting.category}; source ${source}; completeness ${sighting.completeness}.`,
      object_refs: objectRefs,
      x_whoisleuth_observed_at: observedAt,
      x_whoisleuth_source_qualified_state: state,
      x_whoisleuth_source_class: sighting.sourceClass,
      x_whoisleuth_source: source,
      x_whoisleuth_category: sighting.category,
      x_whoisleuth_completeness: sighting.completeness,
      x_whoisleuth_evidence_pin_id: sighting.evidencePinId,
      x_whoisleuth_limitations: sighting.limitations.slice(0, 8).map((item) => text(item, 240)).filter(Boolean),
      x_whoisleuth_interpretation: 'A source-qualified sighting is not an ownership, attribution, safety, or maliciousness conclusion.',
    });
  }

  const bundle = {
    type: 'bundle',
    id: nextId('bundle'),
    objects,
  };
  return {
    version: CASE_SIGHTING_STIX_EXPORT_VERSION,
    format: 'stix' as const,
    generatedAt,
    sightingCount: sightings.length,
    objectCount: objects.length,
    truncated: sightings.length < caseRecord.sightings.length || objects.length >= MAX_CASE_SIGHTING_STIX_OBJECTS,
    filename: `whoisleuth-${target}-sightings-${generatedAt.slice(0, 10)}.stix.json`,
    mimeType: 'application/stix+json;charset=utf-8',
    content: `${JSON.stringify(bundle, null, 2)}\n`,
  };
}
