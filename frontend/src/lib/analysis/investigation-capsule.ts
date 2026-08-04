import type { CaseRecord } from './case-model.ts';
import { canonicalArtifactJson, sha256ArtifactDigest } from './artifact-integrity.ts';
import type { LookupAssetGraph } from './lookup-asset-graph.ts';
import type { LookupInvestigationBrief } from './lookup-investigation-brief.ts';

export const INVESTIGATION_CAPSULE_SCHEMA = 'whoisleuth.investigation-capsule';
export const INVESTIGATION_CAPSULE_VERSION = 1;

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
    briefDigest: string;
    graphDigest: string;
    analystRecordsDigest: string | null;
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
    sha256ArtifactDigest(input.lookupEvidence),
    sha256ArtifactDigest(input.brief),
    sha256ArtifactDigest(input.graph),
    analystRecords ? sha256ArtifactDigest(analystRecords) : Promise.resolve(null),
  ]);
  const evidenceSchema = safeSchema(input.lookupEvidence.schema);
  const evidenceVersion = safeSchemaVersion(input.lookupEvidence.schemaVersion);

  return {
    schema: INVESTIGATION_CAPSULE_SCHEMA,
    schemaVersion: INVESTIGATION_CAPSULE_VERSION,
    generatedAt: iso(input.generatedAt),
    application: { name: 'WHOISleuth', version: safeVersion(input.applicationVersion) },
    target: { value: input.brief.target, type: input.brief.targetType },
    sourceContracts: [
      { id: 'lookup-evidence', schema: evidenceSchema, version: evidenceVersion, digest: evidenceDigest, embedded: false },
      { id: 'investigation-brief', schema: input.brief.schema, version: input.brief.schemaVersion, digest: briefDigest, embedded: true },
      { id: 'asset-graph', schema: 'whoisleuth.lookup-asset-graph', version: input.graph.version, digest: graphDigest, embedded: true },
      ...(analystRecords && analystRecordsDigest
        ? [{ id: 'analyst-records', schema: 'whoisleuth.case-analyst-records', version: 1, digest: analystRecordsDigest, embedded: true }]
        : []),
    ],
    investigationBrief: input.brief,
    graphSnapshot: input.graph,
    analystRecords,
    integrity: { algorithm: 'SHA-256', briefDigest, graphDigest, analystRecordsDigest },
    limitations: [
      'The Lookup evidence file is linked by digest but is not embedded; keep or share that exact file separately when verification is required.',
      'Digest verification can detect changed content but does not establish who created the capsule. No digital signature is applied.',
      'The graph and brief are bounded projections of collected and derived evidence, not attribution, ownership, safety, availability, or maliciousness conclusions.',
      analystRecords
        ? 'Analyst decisions and assertions were deliberately included; review them for sensitive or personal information before sharing.'
        : 'Analyst decisions, assertions, notes, contacts, actions, and raw source payloads are excluded.',
    ],
  };
}

export async function verifyInvestigationCapsule(capsule: InvestigationCapsule): Promise<Readonly<{
  valid: boolean;
  brief: boolean;
  graph: boolean;
  analystRecords: boolean | null;
}>> {
  const [briefDigest, graphDigest, analystRecordsDigest] = await Promise.all([
    sha256ArtifactDigest(capsule.investigationBrief),
    sha256ArtifactDigest(capsule.graphSnapshot),
    capsule.analystRecords ? sha256ArtifactDigest(capsule.analystRecords) : Promise.resolve(null),
  ]);
  const brief = briefDigest === capsule.integrity.briefDigest;
  const graph = graphDigest === capsule.integrity.graphDigest;
  const analystRecords = capsule.analystRecords
    ? analystRecordsDigest === capsule.integrity.analystRecordsDigest
    : capsule.integrity.analystRecordsDigest === null
      ? null
      : false;
  return { valid: brief && graph && analystRecords !== false, brief, graph, analystRecords };
}

export function investigationCapsuleFilename(capsule: InvestigationCapsule): string {
  const target = capsule.target.value.toLowerCase().replace(/[^a-z0-9.-]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 80) || 'lookup';
  return `whoisleuth-investigation-capsule-${target}-${capsule.generatedAt.slice(0, 10)}.json`;
}

export function serializeInvestigationCapsule(capsule: InvestigationCapsule): string {
  return `${canonicalArtifactJson(capsule)}\n`;
}
