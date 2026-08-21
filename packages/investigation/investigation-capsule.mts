import type { CaseRecord } from '../cases/case-model.mts';
import {
  canonicalArtifactJson,
  canonicalArtifactJsonV2,
  sha256ArtifactDigest,
  sha256ArtifactDigestV2,
  SORTED_JSON_V2,
} from '../evidence/artifact-integrity.mts';
import {
  LOOKUP_ASSET_GRAPH_SCHEMA,
  type LookupAssetGraph,
} from './lookup-asset-graph.mts';
import {
  LOOKUP_INVESTIGATION_BRIEF_SCHEMA,
  LOOKUP_INVESTIGATION_BRIEF_VERSION,
  type LookupInvestigationBrief,
} from './lookup-investigation-brief.mts';
import {
  INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA,
  INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION,
  INVESTIGATION_CAPSULE_SCHEMA,
  INVESTIGATION_CAPSULE_VERSION,
  LEGACY_INVESTIGATION_CAPSULE_VERSION,
  PREVIOUS_INVESTIGATION_CAPSULE_VERSION,
  SUPPORTED_INVESTIGATION_CAPSULE_VERSIONS,
} from '../contracts/investigation-portability.mts';

export {
  INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA,
  INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION,
  INVESTIGATION_CAPSULE_SCHEMA,
  INVESTIGATION_CAPSULE_VERSION,
  LEGACY_INVESTIGATION_CAPSULE_VERSION,
  PREVIOUS_INVESTIGATION_CAPSULE_VERSION,
  SUPPORTED_INVESTIGATION_CAPSULE_VERSIONS,
};

export type InvestigationCapsuleAnalystRecords = Readonly<{
  caseId: string;
  status: string;
  disposition: string;
  decisions: readonly Readonly<{
    id: string;
    summary: string;
    rationale: string;
    evidencePinIds: readonly string[];
    createdAt: string;
  }>[];
  assertions: readonly Readonly<{
    id: string;
    kind: string;
    statement: string;
    rationale: string | null;
    evidencePinIds: readonly string[];
    state: string;
    createdAt: string;
    updatedAt: string;
  }>[];
}>;

export type InvestigationCapsule = Readonly<{
  schema: typeof INVESTIGATION_CAPSULE_SCHEMA;
  schemaVersion: typeof INVESTIGATION_CAPSULE_VERSION;
  generatedAt: string;
  application: Readonly<{
    name: 'WHOISleuth';
    version: string;
  }>;
  target: Readonly<{
    value: string;
    type: string;
  }>;
  sourceContracts: readonly Readonly<{
    id: string;
    schema: string;
    version: number;
    digest: string;
    embedded: boolean;
  }>[];
  investigationBrief: LookupInvestigationBrief;
  graphSnapshot: LookupAssetGraph;
  analystRecords: InvestigationCapsuleAnalystRecords | null;
  integrity: Readonly<{
    algorithm: 'SHA-256';
    canonicalization: typeof SORTED_JSON_V2;
    scope: 'capsule excluding integrity';
    briefDigest: string;
    graphDigest: string;
    analystRecordsDigest: string | null;
    digestSha256: string;
  }>;
  limitations: readonly string[];
}>;

type BuildInvestigationCapsuleInput = Readonly<{
  applicationVersion: string;
  lookupEvidence: Readonly<Record<string, unknown> & { schema?: unknown; schemaVersion?: unknown }>;
  brief: LookupInvestigationBrief;
  graph: LookupAssetGraph;
  caseRecord?: CaseRecord | null;
  includeAnalystRecords?: boolean;
  generatedAt?: string;
}>;

function safeVersion(value: unknown): string {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value)
    ? value
    : '0.0.0';
}

function safeSchema(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9.-]{1,120}$/u.test(value) ? value : 'unknown';
}

function safeSchemaVersion(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 10_000 ? Number(value) : 0;
}

function iso(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return new Date().toISOString();
  return new Date(value).toISOString();
}

function analystProjection(record: CaseRecord | null | undefined): InvestigationCapsuleAnalystRecords | null {
  if (!record) return null;
  return {
    caseId: record.id,
    status: record.status,
    disposition: record.disposition,
    decisions: record.decisions.map(({ id, summary, rationale, evidencePinIds, createdAt }) => ({
      id,
      summary,
      rationale,
      evidencePinIds: [...evidencePinIds],
      createdAt,
    })),
    assertions: record.assertions.map(({ id, kind, statement, rationale, evidencePinIds, state, createdAt, updatedAt }) => ({
      id,
      kind,
      statement,
      rationale,
      evidencePinIds: [...evidencePinIds],
      state,
      createdAt,
      updatedAt,
    })),
  };
}

export async function buildInvestigationCapsule(input: BuildInvestigationCapsuleInput): Promise<InvestigationCapsule> {
  const analystRecords = input.includeAnalystRecords ? analystProjection(input.caseRecord) : null;
  const [evidenceDigest, briefDigest, graphDigest, analystRecordsDigest] = await Promise.all([
    sha256ArtifactDigestV2(input.lookupEvidence),
    sha256ArtifactDigestV2(input.brief),
    sha256ArtifactDigestV2(input.graph),
    analystRecords ? sha256ArtifactDigestV2(analystRecords) : Promise.resolve(null),
  ]);
  const evidenceSchema = safeSchema(input.lookupEvidence.schema);
  const evidenceVersion = safeSchemaVersion(input.lookupEvidence.schemaVersion);

  const unsigned: Omit<InvestigationCapsule, 'integrity'> = {
    schema: INVESTIGATION_CAPSULE_SCHEMA,
    schemaVersion: INVESTIGATION_CAPSULE_VERSION,
    generatedAt: iso(input.generatedAt),
    application: { name: 'WHOISleuth', version: safeVersion(input.applicationVersion) },
    target: { value: input.brief.target, type: input.brief.targetType },
    sourceContracts: [
      { id: 'lookup-evidence', schema: evidenceSchema, version: evidenceVersion, digest: evidenceDigest, embedded: false },
      { id: 'investigation-brief', schema: LOOKUP_INVESTIGATION_BRIEF_SCHEMA, version: LOOKUP_INVESTIGATION_BRIEF_VERSION, digest: briefDigest, embedded: true },
      { id: 'asset-graph', schema: LOOKUP_ASSET_GRAPH_SCHEMA, version: input.graph.version, digest: graphDigest, embedded: true },
      ...(analystRecords && analystRecordsDigest
        ? [{
            id: 'analyst-records',
            schema: INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA,
            version: INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION,
            digest: analystRecordsDigest,
            embedded: true,
          }]
        : []),
    ],
    investigationBrief: input.brief,
    graphSnapshot: input.graph,
    analystRecords,
    limitations: [
      'The Lookup evidence file is linked by digest but is not embedded; keep or share that exact file separately when verification is required.',
      'Digest verification can detect changed content but does not establish who created the capsule. No digital signature is applied.',
      'The graph and canonical Decision Fact brief are bounded projections of collected and derived evidence, not attribution, ownership, safety, availability, or maliciousness conclusions.',
      analystRecords
        ? 'Analyst decisions and assertions were deliberately included; review them for sensitive or personal information before sharing.'
        : 'Analyst decisions, assertions, notes, contacts, actions, and raw source payloads are excluded.',
    ],
  };
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: SORTED_JSON_V2,
      scope: 'capsule excluding integrity',
      briefDigest,
      graphDigest,
      analystRecordsDigest,
      digestSha256: await sha256ArtifactDigestV2(unsigned),
    },
  };
}

type PreviousInvestigationCapsule = Omit<InvestigationCapsule, 'schemaVersion' | 'investigationBrief'> & Readonly<{
  schemaVersion: typeof PREVIOUS_INVESTIGATION_CAPSULE_VERSION;
  investigationBrief: Readonly<Record<string, unknown>>;
}>;

type LegacyInvestigationCapsule = Omit<InvestigationCapsule, 'schemaVersion' | 'investigationBrief' | 'integrity'> & Readonly<{
  schemaVersion: typeof LEGACY_INVESTIGATION_CAPSULE_VERSION;
  investigationBrief: Readonly<Record<string, unknown>>;
  integrity: Readonly<{
    algorithm: 'SHA-256';
    briefDigest: string;
    graphDigest: string;
    analystRecordsDigest: string | null;
  }>;
}>;

export type SupportedInvestigationCapsule = InvestigationCapsule
  | PreviousInvestigationCapsule
  | LegacyInvestigationCapsule;

export async function verifyInvestigationCapsule(capsule: SupportedInvestigationCapsule): Promise<Readonly<{
  valid: boolean;
  brief: boolean;
  graph: boolean;
  analystRecords: boolean | null;
  whole: boolean | null;
}>> {
  const current = capsule.schemaVersion === INVESTIGATION_CAPSULE_VERSION;
  const previous = capsule.schemaVersion === PREVIOUS_INVESTIGATION_CAPSULE_VERSION;
  const legacy = capsule.schemaVersion === LEGACY_INVESTIGATION_CAPSULE_VERSION;
  const wholeIntegrity = current || previous;
  const integrityRecord = capsule.integrity as unknown as Record<string, unknown>;
  if ((!current && !previous && !legacy)
    || (wholeIntegrity && (integrityRecord.canonicalization !== SORTED_JSON_V2
      || integrityRecord.scope !== 'capsule excluding integrity'))
    || (legacy && (Object.hasOwn(integrityRecord, 'canonicalization')
      || Object.hasOwn(integrityRecord, 'scope')
      || Object.hasOwn(integrityRecord, 'digestSha256')))) {
    return { valid: false, brief: false, graph: false, analystRecords: null, whole: wholeIntegrity ? false : null };
  }
  const projectionDigest = wholeIntegrity ? sha256ArtifactDigestV2 : sha256ArtifactDigest;
  const [briefDigest, graphDigest, analystRecordsDigest] = await Promise.all([
    projectionDigest(capsule.investigationBrief),
    projectionDigest(capsule.graphSnapshot),
    capsule.analystRecords ? projectionDigest(capsule.analystRecords) : Promise.resolve(null),
  ]);
  const brief = briefDigest === capsule.integrity.briefDigest;
  const graph = graphDigest === capsule.integrity.graphDigest;
  const analystRecords = capsule.analystRecords
    ? analystRecordsDigest === capsule.integrity.analystRecordsDigest
    : capsule.integrity.analystRecordsDigest === null
      ? null
      : false;
  let whole: boolean | null = null;
  if (wholeIntegrity) {
    const { integrity: _integrity, ...unsigned } = capsule;
    whole = integrityRecord.algorithm === 'SHA-256'
      && integrityRecord.canonicalization === SORTED_JSON_V2
      && integrityRecord.scope === 'capsule excluding integrity'
      && integrityRecord.digestSha256 === await sha256ArtifactDigestV2(unsigned);
  }
  return { valid: brief && graph && analystRecords !== false && whole !== false, brief, graph, analystRecords, whole };
}

export function investigationCapsuleFilename(capsule: SupportedInvestigationCapsule): string {
  const target = capsule.target.value.toLowerCase().replace(/[^a-z0-9.-]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 80) || 'lookup';
  return `whoisleuth-investigation-capsule-${target}-${capsule.generatedAt.slice(0, 10)}.json`;
}

export function serializeInvestigationCapsule(capsule: SupportedInvestigationCapsule): string {
  return `${capsule.schemaVersion !== LEGACY_INVESTIGATION_CAPSULE_VERSION
    ? canonicalArtifactJsonV2(capsule)
    : canonicalArtifactJson(capsule)}\n`;
}
