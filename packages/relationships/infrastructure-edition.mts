import { decodeRetainedSourceEdition } from '../evidence/retained-source-edition.mts';
import { parseCommonInfrastructureSnapshot } from './common-infrastructure.mts';
import { commonInfrastructureHealth } from './common-infrastructure-health.mts';
import bundled from './common-infrastructure-snapshot.json' with { type: 'json' };

export function admitInfrastructureEdition(value: unknown, now: Date) {
  const data = parseCommonInfrastructureSnapshot(value);
  const { source } = data;
  if (source.project !== bundled.source.project || source.repository !== bundled.source.repository
    || source.licence !== bundled.source.licence || data.sources.some(entry =>
      entry.values.length === 0 || !entry.label || entry.label.length > 100 || /[\u0000-\u001f\u007f]/u.test(entry.label))) {
    throw new TypeError('Infrastructure edition has invalid source provenance.');
  }
  const health = commonInfrastructureHealth(now, value, data);
  if (health.state === 'unavailable') throw new TypeError('Infrastructure edition has invalid dates.');
  return { data, current: health.state === 'current' } as const;
}

export async function readCurrentInfrastructureEdition(text: string, digest: string, now = new Date()) {
  const { data } = await decodeRetainedSourceEdition(text, digest, 'infrastructure');
  const edition = admitInfrastructureEdition(data, now);
  if (!edition.current) throw new TypeError('Infrastructure edition is outside its review window.');
  return edition.data;
}
