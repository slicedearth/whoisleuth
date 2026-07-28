import { boundedTechnologyText, rec, type JsonRecord } from './lookup-display-model.ts';
import type { PageBaseline } from './page-baseline.ts';
import type {
  WebsiteProfileSnapshot,
  WebsiteSnapshotPosture,
  WebsiteSnapshotTechnology,
} from './website-snapshot-model.ts';

export type LookupSnapshotInput = Readonly<{
  id: string;
  domain: string;
  observedAt: string;
  savedAt: string;
  lookupEvidenceDepth: 'fast' | 'deep';
  technologyProfile: JsonRecord;
  securityPosture: JsonRecord;
  baseline: PageBaseline | null;
  technologyFindings: readonly WebsiteSnapshotTechnology[];
  securityPostureFindings: readonly WebsiteSnapshotPosture[];
  diagnostics: JsonRecord;
}>;

const SNAPSHOT_SOURCES = Object.freeze(['rdap', 'whois', 'availability', 'dns', 'http', 'tls']);

export function buildLookupWebsiteSnapshot(input: LookupSnapshotInput): WebsiteProfileSnapshot {
  const {
    baseline,
    diagnostics,
    lookupEvidenceDepth,
    securityPosture,
    technologyProfile,
  } = input;
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
    technologies: input.technologyFindings.map(({ id, name, category, confidence }) => ({
      id,
      name,
      category,
      confidence,
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
    sources: SNAPSHOT_SOURCES.flatMap((source) => {
      const state = boundedTechnologyText(rec(diagnostics[source]).status, 40);
      return state ? [{ source, state }] : [];
    }),
  };
}
