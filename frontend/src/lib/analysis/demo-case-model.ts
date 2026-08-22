import { normalizeCase } from './case-model.ts';
import { deriveTimeline } from './evidence-display.ts';
import {
  normalizeSyntheticDemoState,
  SYNTHETIC_DEMO_EXPORT_SCHEMA,
  SYNTHETIC_DEMO_EXPORT_VERSION,
  SYNTHETIC_DEMO_PROFILE,
  SYNTHETIC_DEMO_VERSION,
  syntheticDemoCandidate,
  syntheticDemoLookupView,
} from './demo-model-core.ts';

export function syntheticDemoCaseRecord(state: unknown) {
  const normalized = normalizeSyntheticDemoState(state);
  const candidate = syntheticDemoCandidate(normalized.selectedCandidateId);
  if (!normalized.caseReady || !candidate) return null;
  const observations = normalized.followUpReady ? candidate.observations : candidate.observations.slice(0, 1);
  return normalizeCase({
    id: `demo-${candidate.id}`,
    domain: candidate.domain,
    status: normalized.caseStatus,
    disposition: 'unreviewed',
    tags: ['synthetic-demo'],
    notes: normalized.note ? [{ id: 'demo-note', body: normalized.note, createdAt: '2026-07-01T11:20:00.000Z' }] : [],
    source: 'lookup',
    evidenceHistory: observations,
    createdAt: '2026-06-26T11:15:00.000Z',
    updatedAt: normalized.followUpReady ? '2026-07-01T11:20:00.000Z' : '2026-06-26T11:15:00.000Z',
  }, undefined, '2026-07-01T11:20:00.000Z');
}

export function syntheticDemoTimeline(id: string, includeFollowUp = false) {
  const candidate = syntheticDemoCandidate(id);
  if (!candidate) return [];
  const record = syntheticDemoCaseRecord({
    version: SYNTHETIC_DEMO_VERSION,
    started: true,
    profileReady: true,
    candidatesReady: true,
    selectedCandidateId: id,
    caseReady: true,
    caseStatus: 'monitoring',
    note: '',
    followUpReady: includeFollowUp,
  });
  if (!record) return [];
  return deriveTimeline(record.evidenceHistory).reverse().map((entry) => ({
    id: entry.snapshot.id,
    capturedAt: entry.snapshot.capturedAt,
    label: entry.isBaseline ? 'Baseline' : 'Material change',
    repeated: entry.hasRepeatedObservation,
    changes: (entry.changes || []).map((change) => ({
      field: change.label,
      before: change.before,
      after: change.after,
      tone: change.tone,
    })),
  }));
}

export function buildSyntheticDemoExport(state: unknown, generatedAt: string) {
  const normalized = normalizeSyntheticDemoState(state);
  const candidate = syntheticDemoCandidate(normalized.selectedCandidateId);
  if (!normalized.caseReady || !normalized.followUpReady || !candidate) throw new Error('Complete the monitored synthetic case before exporting it.');
  if (typeof generatedAt !== 'string' || generatedAt.length > 64 || /[\x00-\x1f\x7f]/.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt))) throw new Error('A valid export timestamp is required.');
  const lookupView = syntheticDemoLookupView(candidate.id);
  if (!lookupView) throw new Error('The selected synthetic lookup fixture is unavailable.');
  return {
    schema: SYNTHETIC_DEMO_EXPORT_SCHEMA,
    version: SYNTHETIC_DEMO_EXPORT_VERSION,
    synthetic: true,
    generatedAt: new Date(generatedAt).toISOString(),
    warning: 'Synthetic demonstration data only. This is not a live finding and must not be used as evidence or an abuse report.',
    profile: { name: SYNTHETIC_DEMO_PROFILE.name, officialDomain: SYNTHETIC_DEMO_PROFILE.officialDomains[0], products: [...SYNTHETIC_DEMO_PROFILE.productNames] },
    case: { domain: candidate.domain, status: normalized.caseStatus, note: normalized.note || null },
    assessment: { availability: candidate.availability, risk: candidate.risk, mutation: candidate.mutation, signals: [...candidate.signals], riskFactors: candidate.riskFactors.map((factor) => ({ ...factor })) },
    provenance: { ...candidate.provenance, hostnames: [...candidate.provenance.hostnames] },
    relationship: candidate.relationship ? { ...candidate.relationship } : null,
    evidence: {
      registry: { ...candidate.evidence.registry },
      dns: { ...candidate.evidence.dns, nameservers: [...candidate.evidence.dns.nameservers] },
      website: { ...candidate.evidence.website },
      certificate: { ...candidate.evidence.certificate },
      securityTxt: structuredClone(lookupView.securityTxt),
      structuredIdentity: structuredClone(lookupView.structuredIdentity),
      credentialSurface: structuredClone(lookupView.credentialSurface),
      securityPosture: structuredClone(lookupView.securityPosture),
      technology: structuredClone(lookupView.technology),
      observedNetwork: structuredClone(lookupView.network),
    },
    timeline: syntheticDemoTimeline(candidate.id, true),
    limitations: ['All values are fixed local fixtures using reserved domains and addresses.', 'No registry, DNS, website, certificate, or other investigation request was performed.', 'Synthetic risk values and relationships demonstrate presentation only and are not a live assessment.'],
  };
}
