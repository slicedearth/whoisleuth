import { readManagedIndicatorSet, serializeManagedIndicatorSet } from './managed-indicator-set.mts';
import { terminalSafeJson } from './json-output.mts';
import { stixIndicatorObjects, stixIndicatorProducer } from './stix-indicator-export.mts';
import { mispIndicatorAttribute, mispIndicatorEvent } from './misp-indicator-export.mts';

/** Re-exporting a revision is deterministic; revoked object versions never advance. */
export async function exportManagedIndicators(input: unknown, format: 'manifest' | 'stix' | 'misp') {
  const manifest = await readManagedIndicatorSet(input);
  let document: unknown = manifest;
  if (format === 'stix') {
    const producer = `identity--${manifest.producerId}`;
    document = { type: 'bundle', id: `bundle--${manifest.revisionId}`, objects: [
      stixIndicatorProducer(producer, manifest.createdAt),
      ...manifest.entries.flatMap(entry => stixIndicatorObjects(entry.domain, entry.observation.availability, entry.observation, entry.createdAt, producer, type => `${type}--${entry.id}`)
        .map(object => object.type !== 'indicator' ? object : { ...object,
          modified: entry.modifiedAt, valid_until: entry.expiresAt, revoked: entry.withdrawal !== null,
          x_whoisleuth_managed_set: manifest.id, x_whoisleuth_original_review_basis: entry.basis,
          x_whoisleuth_review_basis: entry.reviewBasis,
          ...(entry.withdrawal ? { x_whoisleuth_withdrawal_reason: entry.withdrawal.reason } : {}),
        })),
    ] };
  } else if (format === 'misp') {
    const attributes = manifest.entries.map(entry => {
      const attribute = mispIndicatorAttribute(entry.domain, entry.observation.availability, entry.observation, entry.id, entry.modifiedAt);
      return { ...attribute, deleted: entry.withdrawal !== null,
        comment: `${attribute.comment}; review-expires=${entry.expiresAt}; expiry requires recipient review, not automatic deletion; original-basis=${entry.basis}; latest-review=${entry.reviewBasis}${entry.withdrawal ? `; withdrawn=${entry.withdrawal.reason}` : ''}` };
    });
    document = { Event: { ...mispIndicatorEvent(manifest.id, manifest.createdAt, attributes),
      info: `${manifest.name} · reviewed domain indicators`, timestamp: String(Math.floor(Date.parse(manifest.modifiedAt) / 1000)) } };
  } else if (format !== 'manifest') throw new TypeError('Unsupported managed indicator export format.');
  return { document, content: format === 'manifest' ? serializeManagedIndicatorSet(manifest) : `${terminalSafeJson(document, 2)}\n`,
    filename: `whoisleuth-indicators-${manifest.id}-r${manifest.revision}.${format}.json`,
    mimeType: format === 'stix' ? 'application/stix+json;charset=utf-8' : 'application/json;charset=utf-8' };
}
