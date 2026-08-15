import { normalizeDomain } from './case-model.ts';
import {
  MAX_NAMESERVERS_PER_ROW,
  RELATIONSHIP_EVIDENCE_SCHEMA,
  RELATIONSHIP_EVIDENCE_VERSION,
} from './relationship-evidence.ts';
import type {
  ObservationEnvelopeDerivation,
  RelationshipObservationAdapterResult,
} from './observation-envelope.ts';
import type {
  InvestigationEntity,
  InvestigationEntityType,
  InvestigationObservation,
  InvestigationRelationship,
  InvestigationRelationshipClassification,
  InvestigationRelationshipType,
  InvestigationScanDepth,
  NormalizedBrandProfile,
  NormalizedCampaign,
  NormalizedCaseEvidenceSnapshot,
  NormalizedCaseEvidencePin,
  NormalizedCaseRecord,
  ObservationCandidate,
  RelationshipCandidate,
  StoreRead,
} from './investigation-projection.ts';

export interface InvestigationCollectionProjectionContext {
  cases: StoreRead<NormalizedCaseRecord>;
  campaigns: StoreRead<NormalizedCampaign>;
  brands: StoreRead<NormalizedBrandProfile>;
  relationshipRows: StoreRead<unknown>;
  relationshipObservationEnvelope: RelationshipObservationAdapterResult | null;
  projectionLimitations: string[];
  markTruncated: () => void;
  addEntity: (
    type: InvestigationEntityType,
    canonical: string,
    label: string,
    properties: Record<string, unknown>,
  ) => InvestigationEntity | null;
  addObservation: (
    candidate: ObservationCandidate,
  ) => InvestigationObservation | null;
  linkObservationEntity: (
    observation: InvestigationObservation | null,
    entity: InvestigationEntity | null,
  ) => void;
  addRelationship: (
    candidate: RelationshipCandidate,
    observation: InvestigationObservation | null,
  ) => InvestigationRelationship | null;
  stableId: (prefix: string, value: string) => string;
  text: (value: unknown, maximum?: number) => string;
  timestamp: (value: unknown) => string | null;
  positiveInteger: (value: unknown) => number | null;
  scanDepth: (value: unknown) => InvestigationScanDepth;
  httpOrigin: (value: unknown) => string;
  sha256: (value: unknown) => string;
  record: (value: unknown) => Record<string, unknown> | null;
  projectionEntityType: (value: string) => InvestigationEntityType | null;
  projectionRelationshipType: (
    value: string,
  ) => InvestigationRelationshipType | null;
  projectionClassification: (
    value: ObservationEnvelopeDerivation,
  ) => InvestigationRelationshipClassification;
}

export function projectInvestigationCollections(
  context: InvestigationCollectionProjectionContext,
): void {
  const {
    cases,
    campaigns,
    brands,
    relationshipRows,
    relationshipObservationEnvelope,
    projectionLimitations,
    markTruncated,
    addEntity,
    addObservation,
    linkObservationEntity,
    addRelationship,
    stableId,
    text,
    timestamp,
    positiveInteger,
    scanDepth,
    httpOrigin,
    sha256,
    record,
    projectionEntityType,
    projectionRelationshipType,
    projectionClassification,
} = context;
const EXTERNAL_OBSERVATION_SCHEMAS = new Set([
  'whoisleuth.domain-observation-rows',
  'whoisleuth.dns-observation-rows',
  'whoisleuth.certificate-observation-rows',
]);

function normalizedIp(value: string): string {
  const candidate = value.trim().toLowerCase();
  const ipv4Parts = candidate.split('.');
  if (
    ipv4Parts.length === 4
    && ipv4Parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
  ) return ipv4Parts.map((part) => String(Number(part))).join('.');
  if (candidate.includes(':') && candidate.length <= 45 && /^[0-9a-f:.]+$/u.test(candidate)) return candidate;
  return '';
}

function dnsTarget(value: string, field: string): string {
  const candidate = field === 'MX'
    ? value.trim().split(/\s+/u).at(-1) ?? ''
    : value.trim();
  return normalizeDomain(candidate.replace(/\.$/u, ''));
}

function projectExternalObservation(
  pin: NormalizedCaseEvidencePin,
  caseRecord: NormalizedCaseRecord,
  domainEntity: InvestigationEntity,
  caseEntity: InvestigationEntity,
): void {
  const sourceSchema = pin.sourceSchema;
  const observedAt = timestamp(pin.observedAt);
  if (
    !sourceSchema
    || sourceSchema.collection !== 'external_observations'
    || !EXTERNAL_OBSERVATION_SCHEMAS.has(sourceSchema.schema)
    || !observedAt
    || !pin.field
  ) return;
  const completeness = pin.completeness === 'complete'
    ? true
    : pin.completeness === 'unknown'
      ? null
      : false;
  const observation = addObservation({
    id: stableId('observation', `case-external|${caseRecord.id}|${pin.id}|${observedAt}`),
    kind: 'case_external_observation',
    entityIds: [caseEntity.id, domainEntity.id],
    store: 'cases',
    recordId: caseRecord.id,
    source: text(pin.source, 80) || 'external observation',
    observedAt,
    scanDepth: null,
    status: pin.completeness === 'complete' ? 'success' : 'partial',
    complete: completeness,
    truncated: pin.truncated,
    schemaVersions: { case: cases.version, externalObservation: sourceSchema.version },
    limitations: [
      'This observation was imported and was not independently collected by this browser session.',
      ...pin.limitations,
    ],
  });
  if (!observation) return;

  if (sourceSchema.schema === 'whoisleuth.certificate-observation-rows' && pin.field === 'fingerprintSha256') {
    const fingerprint = sha256(pin.value);
    const entity = fingerprint ? addEntity('certificate', fingerprint, fingerprint, { fingerprintSha256: fingerprint }) : null;
    if (entity) {
      linkObservationEntity(observation, entity);
      addRelationship({
        type: 'domain_presented_certificate',
        from: domainEntity.id,
        to: entity.id,
        classification: 'direct',
        method: 'Imported exact leaf-certificate SHA-256 observation',
      }, observation);
    }
    return;
  }
  if (sourceSchema.schema !== 'whoisleuth.dns-observation-rows') return;
  const field = pin.field.toUpperCase();
  if (field === 'A' || field === 'AAAA') {
    const address = normalizedIp(pin.value);
    const entity = address ? addEntity('ip_address', address, address, { address }) : null;
    if (entity) {
      linkObservationEntity(observation, entity);
      addRelationship({
        type: 'domain_resolved_to_ip',
        from: domainEntity.id,
        to: entity.id,
        classification: 'direct',
        method: `Imported exact DNS ${field} observation`,
      }, observation);
    }
    return;
  }
  if (field === 'NS') {
    const target = dnsTarget(pin.value, field);
    const entity = target ? addEntity('nameserver_set', target, target, { nameservers: [target] }) : null;
    if (entity) {
      linkObservationEntity(observation, entity);
      addRelationship({
        type: 'domain_uses_nameserver_set',
        from: domainEntity.id,
        to: entity.id,
        classification: 'direct',
        method: 'Imported exact DNS NS observation',
      }, observation);
    }
    return;
  }
  if (field === 'CNAME' || field === 'MX') {
    const target = dnsTarget(pin.value, field);
    const entity = target ? addEntity('domain', target, target, { domain: target }) : null;
    if (entity) {
      linkObservationEntity(observation, entity);
      addRelationship({
        type: field === 'CNAME' ? 'domain_aliases_to_domain' : 'domain_uses_mail_server',
        from: domainEntity.id,
        to: entity.id,
        classification: 'direct',
        method: `Imported exact DNS ${field} observation`,
      }, observation);
    }
  }
}

function projectCaseSnapshot(
  snapshot: NormalizedCaseEvidenceSnapshot,
  caseRecord: NormalizedCaseRecord,
  domainEntity: InvestigationEntity,
  caseEntity: InvestigationEntity,
): void {
  const observedAt = timestamp(snapshot.capturedAt);
  if (!observedAt) return;
  const observation = addObservation({
    id: stableId('observation', `case-evidence|${caseRecord.id}|${snapshot.id}|${observedAt}`),
    kind: 'case_evidence',
    entityIds: [caseEntity.id, domainEntity.id],
    store: 'cases',
    recordId: caseRecord.id,
    source: text(snapshot.source, 40) || 'unknown',
    observedAt,
    firstObservedAt: timestamp(snapshot.firstCapturedAt) || observedAt,
    scanDepth: scanDepth(snapshot.scanDepth),
    status: 'partial',
    complete: null,
    truncated: null,
    schemaVersions: {
      case: cases.version,
      riskModel: positiveInteger(snapshot.riskModelVersion),
      httpSummary: positiveInteger(snapshot.httpSummaryVersion),
    },
    limitations: [
      'Compact case evidence does not retain a complete source-health or source-truncation envelope.',
      ...(snapshot.scanDepth === 'unknown' ? ['Scan depth is unknown, so deep-only fields are not comparable.'] : []),
    ],
  });
  if (!observation) return;

  const nameservers = [...new Set(snapshot.nameservers.map(normalizeDomain).filter(Boolean))].sort();
  if (nameservers.length) {
    const value = nameservers.join('|');
    const entity = addEntity('nameserver_set', value, nameservers.join(' · '), { nameservers });
    if (entity) {
      linkObservationEntity(observation, entity);
      addRelationship({
        type: 'domain_uses_nameserver_set',
        from: domainEntity.id,
        to: entity.id,
        classification: 'normalized',
        method: 'Exact retained normalised nameserver set',
      }, observation);
    }
  }
  if (snapshot.scanDepth === 'deep' && snapshot.httpEvidenceStatus
    && ['success', 'partial'].includes(snapshot.httpEvidenceStatus)) {
    const origin = httpOrigin(snapshot.httpFinalOrigin);
    const entity = origin ? addEntity('http_origin', origin, origin, { origin }) : null;
    if (entity) {
      linkObservationEntity(observation, entity);
      addRelationship({
        type: 'domain_reached_http_origin',
        from: domainEntity.id,
        to: entity.id,
        classification: 'normalized',
        method: 'Exact normalised final HTTP(S) origin from comparable deep evidence',
      }, observation);
    }
  }
}

const caseByDomain = new Map<string, InvestigationEntity>();
const orderedCases = [...cases.records].sort((left, right) => (
  String(right.updatedAt).localeCompare(String(left.updatedAt))
  || String(left.domain).localeCompare(String(right.domain))
  || String(left.id).localeCompare(String(right.id))
));
for (const caseRecord of orderedCases) {
  const domain = normalizeDomain(caseRecord.domain);
  if (!domain) continue;
  const domainEntity = addEntity('domain', domain, domain, { domain });
  const caseEntity = addEntity('case', caseRecord.id, domain, {
    caseId: caseRecord.id,
    domain,
    status: text(caseRecord.status, 40),
    disposition: text(caseRecord.disposition, 40),
  });
  if (!domainEntity || !caseEntity) continue;
  caseByDomain.set(domain, caseEntity);
  const observedAt = timestamp(caseRecord.updatedAt);
  if (!observedAt) continue;
  const caseObservation = addObservation({
    id: stableId('observation', `case-record|${caseRecord.id}|${observedAt}`),
    kind: 'case_record',
    entityIds: [caseEntity.id, domainEntity.id],
    store: 'cases',
    recordId: caseRecord.id,
    source: text(caseRecord.source, 40) || 'unknown',
    observedAt,
    scanDepth: null,
    status: 'success',
    complete: true,
    truncated: false,
    schemaVersions: { case: cases.version },
    limitations: [],
  });
  addRelationship({
    type: 'case_documents_domain',
    from: caseEntity.id,
    to: domainEntity.id,
    classification: 'direct',
    method: 'Canonical domain stored on the analyst case',
  }, caseObservation);
  for (const snapshot of [...caseRecord.evidenceHistory].reverse()) {
    projectCaseSnapshot(snapshot, caseRecord, domainEntity, caseEntity);
  }
  for (const pin of caseRecord.evidencePins) {
    projectExternalObservation(pin, caseRecord, domainEntity, caseEntity);
  }
}

for (const profile of brands.records) {
  const brandEntity = addEntity('brand', profile.id, profile.name, { profileId: profile.id, name: profile.name });
  const observedAt = timestamp(profile.updatedAt);
  if (!brandEntity || !observedAt) continue;
  const profileObservation = addObservation({
    id: stableId('observation', `brand-profile|${profile.id}|${observedAt}`),
    kind: 'brand_profile',
    entityIds: [brandEntity.id],
    store: 'brandProfiles',
    recordId: profile.id,
    source: 'analyst_profile',
    observedAt,
    scanDepth: null,
    status: 'success',
    complete: true,
    truncated: false,
    schemaVersions: { brandProfile: brands.version },
    limitations: [],
  });
  for (const domain of profile.officialDomains) {
    const domainEntity = addEntity('domain', domain, domain, { domain });
    if (!domainEntity || !profileObservation) continue;
    linkObservationEntity(profileObservation, domainEntity);
    addRelationship({
      type: 'brand_declares_official_domain',
      from: brandEntity.id,
      to: domainEntity.id,
      classification: 'direct',
      method: 'Domain configured as official in the Brand Profile',
    }, profileObservation);
  }
  const officialFavicon = sha256(profile.officialFaviconHash);
  const faviconEntity = officialFavicon
    ? addEntity('favicon', officialFavicon, `${officialFavicon.slice(0, 12)}…`, { sha256: officialFavicon })
    : null;
  if (faviconEntity && profileObservation) {
    linkObservationEntity(profileObservation, faviconEntity);
    addRelationship({
      type: 'brand_declares_official_favicon',
      from: brandEntity.id,
      to: faviconEntity.id,
      classification: 'direct',
      method: 'Exact SHA-256 configured in the Brand Profile',
    }, profileObservation);
  }

  const baseline = record(profile.pageBaseline);
  const baselineDomain = normalizeDomain(baseline?.domain);
  const baselineObservedAt = timestamp(baseline?.observedAt);
  const baselineFavicon = sha256(baseline?.faviconHash);
  if (baseline && baselineDomain && baselineObservedAt) {
    const domainEntity = addEntity('domain', baselineDomain, baselineDomain, { domain: baselineDomain });
    const baselineFaviconEntity = baselineFavicon
      ? addEntity('favicon', baselineFavicon, `${baselineFavicon.slice(0, 12)}…`, { sha256: baselineFavicon })
      : null;
    if (!domainEntity) continue;
    const baselineObservation = addObservation({
      id: stableId('observation', `brand-baseline|${profile.id}|${baselineObservedAt}`),
      kind: 'brand_page_baseline',
      entityIds: [brandEntity.id, domainEntity.id, ...(baselineFaviconEntity ? [baselineFaviconEntity.id] : [])],
      store: 'brandProfiles',
      recordId: profile.id,
      source: 'official_site_baseline',
      observedAt: baselineObservedAt,
      scanDepth: 'deep',
      status: baseline.complete === true ? 'success' : 'partial',
      complete: baseline.complete === true,
      truncated: baseline.truncated === true,
      schemaVersions: {
        brandProfile: brands.version,
        pageBaseline: positiveInteger(baseline.baselineVersion),
        pageIdentity: positiveInteger(baseline.pageIdentityVersion),
        pageFingerprint: positiveInteger(baseline.fingerprintVersion),
      },
      limitations: baseline.complete === true ? [] : ['The retained official-site baseline is partial or truncated.'],
    });
    if (baselineFaviconEntity) addRelationship({
      type: 'domain_observed_favicon',
      from: domainEntity.id,
      to: baselineFaviconEntity.id,
      classification: 'normalized',
      method: 'Exact retained favicon SHA-256 from the official-site baseline',
    }, baselineObservation);
  }
}

for (const campaign of campaigns.records) {
  const campaignEntity = addEntity('campaign', campaign.id, campaign.name, { campaignId: campaign.id, name: campaign.name });
  const observedAt = timestamp(campaign.updatedAt);
  if (!campaignEntity || !observedAt) continue;
  const campaignObservation = addObservation({
    id: stableId('observation', `campaign|${campaign.id}|${observedAt}`),
    kind: 'campaign_record',
    entityIds: [campaignEntity.id],
    store: 'campaigns',
    recordId: campaign.id,
    source: 'analyst_campaign',
    observedAt,
    scanDepth: null,
    status: 'success',
    complete: true,
    truncated: false,
    schemaVersions: { campaign: campaigns.version },
    limitations: [],
  });
  for (const domain of campaign.domains) {
    const domainEntity = addEntity('domain', domain, domain, { domain });
    if (!domainEntity || !campaignObservation) continue;
    linkObservationEntity(campaignObservation, domainEntity);
    addRelationship({
      type: 'campaign_contains_domain',
      from: campaignEntity.id,
      to: domainEntity.id,
      classification: 'direct',
      method: 'Canonical domain membership stored on the analyst campaign',
    }, campaignObservation);
    const caseEntity = caseByDomain.get(domain);
    if (caseEntity) {
      linkObservationEntity(campaignObservation, caseEntity);
      addRelationship({
        type: 'campaign_contains_case',
        from: campaignEntity.id,
        to: caseEntity.id,
        classification: 'derived',
        method: 'Exact canonical-domain match between campaign membership and a local case',
      }, campaignObservation);
    }
  }
}

for (const row of relationshipRows.records) {
  const value = record(row);
  const domain = normalizeDomain(value?.domain);
  const observedAt = timestamp(value?.observedAt);
  const relation = record(value?.relationship);
  if (!value || !domain || !observedAt || !relation || relation.version !== RELATIONSHIP_EVIDENCE_VERSION) {
    const relationVersion = relation ? positiveInteger(relation.version) : null;
    if (relationVersion !== null && relationVersion > RELATIONSHIP_EVIDENCE_VERSION) {
      projectionLimitations.push(`A relationship observation used unsupported schema ${relationVersion} and was not interpreted.`);
    }
    continue;
  }
  const domainEntity = addEntity('domain', domain, domain, { domain });
  if (!domainEntity) continue;
  const nameserverInput = Array.isArray(relation.nameservers) ? relation.nameservers : [];
  const relationshipInputTruncated = relation.truncated === true || nameserverInput.length > MAX_NAMESERVERS_PER_ROW;
  if (relationshipInputTruncated) markTruncated();
  const nameservers = [...new Set(nameserverInput.slice(0, MAX_NAMESERVERS_PER_ROW)
    .map(normalizeDomain).filter(Boolean))].sort();
  const favicon = sha256(relation.faviconHash);
  const certificate = sha256(relation.certificateFingerprint);
  const observationIdentity = JSON.stringify({ nameservers, favicon, certificate, truncated: relationshipInputTruncated });
  const observation = addObservation({
    id: stableId('observation', `relationship-row|${domain}|${observedAt}|${observationIdentity}`),
    kind: 'scan_relationship_evidence',
    entityIds: [domainEntity.id],
    store: 'relationshipRows',
    recordId: domain,
    source: text(value.source, 40) || 'bulk',
    observedAt,
    scanDepth: scanDepth(value.scanDepth),
    status: relationshipInputTruncated ? 'partial' : 'success',
    complete: null,
    truncated: relationshipInputTruncated,
    schemaVersions: { relationshipEvidence: RELATIONSHIP_EVIDENCE_VERSION },
    limitations: ['Scan-local relationship evidence does not retain a complete source-health envelope.'],
  });
  if (!observation) continue;
  if (nameservers.length) {
    const entity = addEntity('nameserver_set', nameservers.join('|'), nameservers.join(' · '), { nameservers });
    if (entity) {
      linkObservationEntity(observation, entity);
      addRelationship({
        type: 'domain_uses_nameserver_set',
        from: domainEntity.id,
        to: entity.id,
        classification: 'normalized',
        method: 'Exact normalised nameserver set from scan-local relationship evidence',
      }, observation);
    }
  }
  const faviconEntity = favicon
    ? addEntity('favicon', favicon, `${favicon.slice(0, 12)}…`, { sha256: favicon })
    : null;
  if (faviconEntity) {
    linkObservationEntity(observation, faviconEntity);
    addRelationship({
      type: 'domain_observed_favicon',
      from: domainEntity.id,
      to: faviconEntity.id,
      classification: 'normalized',
      method: 'Exact retained favicon SHA-256 from scan-local evidence',
    }, observation);
  }
  const certificateEntity = certificate
    ? addEntity('certificate', certificate, `${certificate.slice(0, 12)}…`, { sha256: certificate })
    : null;
  if (certificateEntity) {
    linkObservationEntity(observation, certificateEntity);
    addRelationship({
      type: 'domain_presented_certificate',
      from: domainEntity.id,
      to: certificateEntity.id,
      classification: 'normalized',
      method: 'Exact native TLS leaf-certificate SHA-256 from scan-local evidence',
    }, observation);
  }
}

if (relationshipObservationEnvelope?.state === 'ready') {
  const envelopeEntityIds = new Map<string, string>();
  for (const envelopeEntity of relationshipObservationEnvelope.document.entities) {
    const type = projectionEntityType(envelopeEntity.type);
    if (!type) continue;
    const projected = addEntity(type, envelopeEntity.canonical, envelopeEntity.label, envelopeEntity.properties);
    if (projected) envelopeEntityIds.set(envelopeEntity.id, projected.id);
  }
  const envelopeObservations = new Map<string, InvestigationObservation>();
  for (const envelopeObservation of relationshipObservationEnvelope.document.observations) {
    const mappedEntityIds = envelopeObservation.entityIds
      .map((entityId) => envelopeEntityIds.get(entityId))
      .filter((entityId): entityId is string => typeof entityId === 'string');
    const evidenceSchema = envelopeObservation.upstreamSchemas.find(
      (source) => source.schema === RELATIONSHIP_EVIDENCE_SCHEMA,
    );
    const projected = addObservation({
      id: stableId(
        'observation',
        `retained-relationship|${envelopeObservation.sourceRecordId}|${envelopeObservation.observedAt}`,
      ),
      kind: 'retained_relationship_observation',
      entityIds: mappedEntityIds,
      store: 'relationshipObservations',
      recordId: envelopeObservation.sourceRecordId,
      source: envelopeObservation.source,
      observedAt: envelopeObservation.observedAt,
      scanDepth: envelopeObservation.collectionDepth === null
        ? null
        : scanDepth(envelopeObservation.collectionDepth),
      status: envelopeObservation.status,
      complete: envelopeObservation.complete,
      truncated: envelopeObservation.truncated,
      schemaVersions: {
        relationshipEvidence: evidenceSchema?.version ?? null,
        relationshipObservation: envelopeObservation.sourceSchema.version,
      },
      limitations: envelopeObservation.limitations,
    });
    if (projected) envelopeObservations.set(envelopeObservation.id, projected);
  }
  for (const envelopeRelationship of relationshipObservationEnvelope.document.relationships) {
    const type = projectionRelationshipType(envelopeRelationship.type);
    const from = envelopeEntityIds.get(envelopeRelationship.from);
    const to = envelopeEntityIds.get(envelopeRelationship.to);
    if (!type || !from || !to) continue;
    for (const sourceObservationId of envelopeRelationship.sourceObservationIds) {
      addRelationship({
        type,
        from,
        to,
        classification: projectionClassification(envelopeRelationship.derivation),
        method: envelopeRelationship.method,
      }, envelopeObservations.get(sourceObservationId) ?? null);
    }
  }
}

}
