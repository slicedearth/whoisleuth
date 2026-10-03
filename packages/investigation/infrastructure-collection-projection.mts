import { readInfrastructureObservation, type InfrastructureObservation } from './infrastructure-observation.mts';
import type { InvestigationCollectionProjectionContext } from './investigation-projection-collections.mts';
import type { InvestigationEntity, NormalizedCaseEvidencePin, NormalizedCaseRecord } from './investigation-projection.mts';

export function projectInfrastructureObservation(context: InvestigationCollectionProjectionContext, pin: NormalizedCaseEvidencePin, record: NormalizedCaseRecord, caseEntity: InvestigationEntity): boolean {
  const raw = pin.infrastructureObservation;
  if (!raw) return false;
  let snapshot: InfrastructureObservation;
  try { snapshot = readInfrastructureObservation(raw); }
  catch { context.projectionLimitations.push('A malformed or unsupported infrastructure snapshot was withheld without inferring hosts or relationships.'); context.markTruncated(); return true; }
  const { addEntity, addObservation, addRelationship, linkObservationEntity, stableId } = context;
  const sources = new Map(snapshot.sources.map(source => [source.id, source]));
  const makeObservation = (sourceId: string, observedAt: string, suffix: string, complete: boolean, truncated = false) => {
    const source = sources.get(sourceId)!;
    return addObservation({ id: stableId('observation', JSON.stringify(['infrastructure', record.id, pin.id, snapshot.id, sourceId, suffix, observedAt])), kind: 'case_external_observation', entityIds: [caseEntity.id], store: 'cases', recordId: record.id,
      source: `${source.evidenceClass === 'provider_report' ? 'Provider-reported' : 'Supplied local observation'} · ${source.name}`, observedAt, scanDepth: null, status: complete && !truncated ? 'success' : 'partial', complete, truncated,
      schemaVersions: { case: context.cases.version, externalObservation: snapshot.version }, limitations: [`Snapshot ${snapshot.id}; target ${snapshot.target}; mode ${snapshot.mode}; scope ${snapshot.scope.selection}.`, 'Source descriptions are supplied, not authenticated by this importing session.', ...snapshot.limitations] });
  };
  // A summary observation preserves the exact snapshot for disposable local
  // comparison, while every DNS/certificate/provider edge gets its own source.
  const summary = addObservation({ id: stableId('observation', JSON.stringify(['infrastructure-snapshot', record.id, pin.id, snapshot.id])), kind: 'case_external_observation', entityIds: [caseEntity.id], store: 'cases', recordId: record.id, source: `Retained snapshot ${snapshot.id}`, observedAt: snapshot.observedAt, scanDepth: null, status: snapshot.coverage.state === 'complete' ? 'success' : 'partial', complete: snapshot.coverage.state === 'complete', truncated: snapshot.coverage.truncated, schemaVersions: { case: context.cases.version, externalObservation: snapshot.version }, limitations: [snapshot.coverage.detail, ...snapshot.limitations] });
  if (summary) summary.infrastructureObservation = snapshot;
  const host = (value: string) => addEntity('domain', value, value, { domain: value });
  for (const value of snapshot.scope.hostnames) { const entity = host(value); if (entity) linkObservationEntity(summary, entity); }
  for (const [index, row] of snapshot.dns.entries()) {
    const observation = makeObservation(row.sourceId, row.observedAt, `dns-${index}:${row.queriedName}:${row.ownerName}:${row.type}:${row.outcome}`, row.complete, row.truncated);
    const queried = host(row.queriedName), owner = host(row.ownerName);
    if (queried) linkObservationEntity(observation, queried);
    if (!owner) continue;
    linkObservationEntity(observation, owner);
    if (observation) observation.limitations.push(`Queried ${row.queriedName} ${row.type}; response owner ${row.ownerName}; outcome ${row.outcome}. Failed/no-data outcomes are not domain absence.`);
    for (const value of row.values) {
      const targetValue = row.type === 'MX' ? value.split(' ')[1]! : value;
      const entity = row.type === 'A' || row.type === 'AAAA' ? addEntity('ip_address', value, value, { address: value })
        : row.type === 'NS' ? addEntity('nameserver_set', targetValue, targetValue, { nameservers: [targetValue] }) : host(targetValue);
      if (!entity) continue;
      linkObservationEntity(observation, entity);
      const type = row.type === 'A' || row.type === 'AAAA' ? 'domain_resolved_to_ip' : row.type === 'CNAME' ? 'domain_aliases_to_domain' : row.type === 'NS' ? 'domain_uses_nameserver_set' : row.type === 'MX' ? 'domain_uses_mail_server' : null;
      if (type) addRelationship({ type, from: owner.id, to: entity.id, classification: 'direct', method: `Exact retained DNS ${row.type}; queried ${row.queriedName}; owner ${row.ownerName}${row.type === 'MX' ? `; preference ${value.split(' ')[0]}` : ''}` }, observation);
    }
  }
  for (const [index, row] of snapshot.certificates.entries()) {
    const observation = makeObservation(row.sourceId, row.observedAt, `certificate-${index}:${row.fingerprintSha256}`, row.namesComplete);
    const certificate = addEntity('certificate', row.fingerprintSha256, row.fingerprintSha256, { fingerprintSha256: row.fingerprintSha256 });
    if (!certificate) continue;
    linkObservationEntity(observation, certificate);
    for (const value of row.names) {
      const pattern = value.startsWith('*.');
      const entity = pattern ? addEntity('certificate_pattern', value, value, { value }) : host(value);
      if (!entity) continue;
      linkObservationEntity(observation, entity);
      addRelationship({ type: pattern ? 'certificate_contains_pattern' : 'certificate_contains_name', from: certificate.id, to: entity.id, classification: 'direct', method: `Exact retained ${sources.get(row.sourceId)!.family === 'certificate_log' ? 'certificate-log' : 'TLS certificate'} name; not a resolution or an enumerated wildcard host` }, observation);
    }
  }
  for (const [index, row] of snapshot.roles.entries()) {
    const observation = makeObservation(row.sourceId, row.observedAt, `role-${index}:${row.role}:${row.subject}:${row.providerId}`, row.complete);
    const subject = row.subjectType === 'address' ? addEntity('ip_address', row.subject, row.subject, { address: row.subject }) : host(row.subject);
    const target = row.role === 'routing_origin' ? addEntity('routing_asn', row.value, row.value, { value: row.value }) : addEntity('provider', JSON.stringify([row.role, row.providerId]), `${row.providerLabel} · ${row.role.replaceAll('_', ' ')}`, { identifier: row.providerId, value: row.role });
    if (!subject || !target) continue;
    linkObservationEntity(observation, subject); linkObservationEntity(observation, target);
    addRelationship({ type: row.role === 'routing_origin' ? 'ip_observed_routing_origin' : 'subject_observed_provider_role', from: subject.id, to: target.id, classification: 'direct', method: `${row.role.replaceAll('_', ' ')}: ${row.value}. Independently source-qualified; not common control, physical location or an inferred hidden origin.` }, observation);
  }
  return true;
}
