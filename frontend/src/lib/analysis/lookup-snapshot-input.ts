import { boundedTechnologyText, rec, type JsonRecord } from './lookup-display-model.ts';
import type { PageBaseline } from './page-baseline.ts';
import type {
  WebsiteProfileSnapshot,
  WebsiteSnapshotPosture,
  WebsiteSnapshotTechnology,
} from './website-snapshot-model.ts';
import type { ServiceDependency } from './service-dependency-review.ts';

export type LookupSnapshotInput = Readonly<{
  id: string;
  domain: string;
  observedAt: string;
  savedAt: string;
  lookupEvidenceDepth: 'fast' | 'deep';
  technologyProfile: JsonRecord;
  securityPosture: JsonRecord;
  tlsEvidence: JsonRecord;
  baseline: PageBaseline | null;
  pageIdentity?: JsonRecord;
  technologyFindings: readonly WebsiteSnapshotTechnology[];
  securityPostureFindings: readonly WebsiteSnapshotPosture[];
  diagnostics: JsonRecord;
  dependencies?: readonly ServiceDependency[];
}>;

const SNAPSHOT_SOURCES = Object.freeze(['rdap', 'whois', 'availability', 'dns', 'http', 'tls']);
const SHA256_RE = /^[a-f0-9]{64}$/iu;

function certificateName(value: unknown): string | null {
  const name = rec(value);
  const candidates = [...(
    Array.isArray(name.commonNames) ? name.commonNames : []
  ), ...(
    Array.isArray(name.organizations) ? name.organizations : []
  )];
  const label = candidates
    .flatMap((candidate) => {
      const normalized = boundedTechnologyText(candidate, 120);
      return normalized ? [normalized] : [];
    })
    .slice(0, 2)
    .join(' · ')
    .slice(0, 180);
  return label || null;
}

function certificateObservation(input: LookupSnapshotInput): WebsiteProfileSnapshot['certificate'] {
  if (input.lookupEvidenceDepth !== 'deep' || input.tlsEvidence.source !== 'tls') return null;
  const certificate = rec(input.tlsEvidence.certificate);
  const publicKey = rec(certificate.publicKey);
  const authorization = rec(input.tlsEvidence.authorization);
  const hostname = rec(input.tlsEvidence.hostname);
  const validity = rec(input.tlsEvidence.validity);
  const fingerprintSha256 = boundedTechnologyText(certificate.fingerprintSha256, 64).toLowerCase();
  if (!SHA256_RE.test(fingerprintSha256)) return null;
  const spkiCandidate = boundedTechnologyText(publicKey.fingerprintSha256, 64).toLowerCase();
  const serialCandidate = boundedTechnologyText(certificate.serialNumber, 128).toLowerCase();
  const validFrom = boundedTechnologyText(certificate.validFrom, 64);
  const validTo = boundedTechnologyText(certificate.validTo, 64);
  return {
    observationVersion: 1,
    source: 'tls',
    collectionDepth: 'deep',
    fingerprintSha256,
    spkiFingerprintSha256: SHA256_RE.test(spkiCandidate) ? spkiCandidate : null,
    issuer: certificateName(certificate.issuer),
    subject: certificateName(certificate.subject),
    serialNumber: /^[a-f0-9]{1,128}$/iu.test(serialCandidate) ? serialCandidate : null,
    validFrom: validFrom && Number.isFinite(Date.parse(validFrom)) ? new Date(validFrom).toISOString() : null,
    validTo: validTo && Number.isFinite(Date.parse(validTo)) ? new Date(validTo).toISOString() : null,
    authorized: typeof authorization.authorized === 'boolean' ? authorization.authorized : null,
    hostnameMatches: typeof hostname.matches === 'boolean' ? hostname.matches : null,
    validity: boundedTechnologyText(validity.status, 40) || null,
    complete: input.tlsEvidence.complete === true,
    truncated: input.tlsEvidence.truncated === true,
  };
}

export function buildLookupWebsiteSnapshot(input: LookupSnapshotInput): WebsiteProfileSnapshot {
  const {
    baseline,
    diagnostics,
    lookupEvidenceDepth,
    securityPosture,
    technologyProfile,
  } = input;
  const pageIdentity = rec(input.pageIdentity);
  const externalActionOrigins = rec(pageIdentity.forms).externalActionOrigins;
  return {
    id: input.id,
    domain: input.domain,
    observedAt: input.observedAt,
    savedAt: input.savedAt,
    complete: lookupEvidenceDepth === 'deep'
      && technologyProfile.complete === true
      && securityPosture.complete === true
      && Boolean(baseline?.complete),
    truncated: Boolean(
      technologyProfile.truncated
      || securityPosture.truncated
      || baseline?.truncated,
    ),
    profileProvenance: {
      technology: {
        version: Number.isSafeInteger(technologyProfile.profileVersion)
          ? Number(technologyProfile.profileVersion)
          : null,
        state: Number.isSafeInteger(technologyProfile.profileVersion) ? 'known' : 'legacy_unknown',
      },
      securityPosture: {
        version: Number.isSafeInteger(securityPosture.postureVersion)
          ? Number(securityPosture.postureVersion)
          : null,
        state: Number.isSafeInteger(securityPosture.postureVersion) ? 'known' : 'legacy_unknown',
      },
    },
    technologies: input.technologyFindings.map(({ id, name, category, confidence, roles }) => ({
      id,
      name,
      category,
      confidence,
      roles,
    })),
    posture: input.securityPostureFindings.map(({ id, state }) => ({ id, state })),
    identity: {
      normalizedHtml: baseline?.normalizedHtml.value ?? null,
      visibleText: baseline?.visibleText?.value ?? null,
      domStructure: baseline?.domStructure.value ?? null,
      formStructure: baseline?.formStructure?.value ?? null,
      resourceHosts: baseline?.resourceHosts.value ?? null,
      trackingIdentifiers: baseline?.trackingIdentifiers.value ?? null,
      faviconHash: baseline?.faviconHash ?? null,
    },
    identityValues: {
      resourceHosts: baseline?.resourceHosts.values ?? [],
      trackingIdentifiers: baseline?.trackingIdentifiers.values ?? [],
      formActionOrigins: Array.isArray(externalActionOrigins)
        ? externalActionOrigins
            .filter((value): value is string => typeof value === 'string')
            .slice(0, 20)
        : [],
    },
    certificate: certificateObservation(input),
    dependencies: (input.dependencies ?? []).slice(0, 20).map((item) => ({
      recordType: item.recordType,
      target: item.target,
      state: item.state,
      qualification: item.qualification,
      serviceFamily: item.serviceFamily ?? null,
    })),
    sources: SNAPSHOT_SOURCES.flatMap((source) => {
      const state = boundedTechnologyText(rec(diagnostics[source]).status, 40);
      return state ? [{ source, state }] : [];
    }),
  };
}
