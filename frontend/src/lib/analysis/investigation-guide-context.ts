import type { InvestigationProjection } from './investigation-projection.ts';
import type { CaseRecord } from './case-record-model.ts';
import { canonicalRegistrableDomain } from '../../../../lib/registrable-domain.mts';
import { latestObservationCohort } from '../../../../packages/evidence/latest-observations.mts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

/** Disposable exact-target context; record updates are not evidence capture times. */
export function investigationGuideEvidenceContext(projection: InvestigationProjection | null, target: string, now: string) {
  const entity = projection?.entities.find((item) => item.type === 'domain' && item.canonical === target);
  const ids = new Set(entity?.observationIds ?? []);
  const observations = projection?.observations.filter((item) => ids.has(item.id)) ?? [];
  const captures = observations.filter((item) => !['case_record', 'brand_profile', 'campaign_record'].includes(item.kind));
  const relationships = entity ? projection!.relationships.filter((item) => item.from === entity.id || item.to === entity.id) : [];
  const cohort = latestObservationCohort(captures, (item) => item.observedAt);
  const clock = normalizeExplicitIsoTimestamp(now);
  const future = captures.filter((item) => {
    const at = normalizeExplicitIsoTimestamp(item.observedAt);
    return at !== null && clock !== null && Date.parse(at) > Date.parse(clock);
  }).length;
  const latest = cohort.observedAt && !future && clock ? cohort.observedAt : null;
  const date = latest ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(latest)) : '';
  const timeLabel = !captures.length ? observations.length ? 'Retained context only; no evidence captures' : 'No retained evidence'
    : !clock || future ? 'Capture time needs review (clock unavailable or future-dated)'
      : !latest ? 'Retained evidence; capture time unavailable'
        : `${cohort.undated.length ? 'Latest known' : 'Latest'} capture ${date} UTC${cohort.undated.length ? `; ${cohort.undated.length} undated` : ''}`;
  return {
    observations: captures.length,
    relationships: relationships.length,
    partial: observations.some((item) => item.status === 'partial' || item.complete !== true),
    truncated: Boolean(projection?.truncated || entity?.observationsTruncated
      || observations.some((item) => item.truncated === true || item.entityReferencesTruncated)
      || relationships.some((item) => item.truncated === true || item.sourceObservationsTruncated)),
    timeLabel,
  };
}

/** An explicit selection cannot be silently replaced by another Case for the target. */
export function investigationGuideCaseContext(records: readonly CaseRecord[], target: string, selectedId: string | null) {
  const domain = canonicalRegistrableDomain(target);
  const matchesTarget = (record: CaseRecord) => record.domain === target || record.domain === domain;
  const matches = records.filter(matchesTarget);
  const selected = selectedId ? records.find((record) => record.id === selectedId) : null;
  const record = selectedId ? selected && matchesTarget(selected) ? selected : null : matches.length === 1 ? matches[0]! : null;
  return {
    record,
    choices: matches.map(({ id, domain }) => ({ id, domain })),
    label: record ? `${record.status} · ${record.disposition}`
      : selectedId ? selected ? 'Selected Case has another target' : 'Selected Case is no longer retained'
        : matches.length > 1 ? `Choose a Case (${matches.length} match this target)` : 'Not retained',
  };
}
