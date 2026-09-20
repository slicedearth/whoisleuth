import {
  brandPostureObservationContext,
  MAX_PROFILE_TEXT_LENGTH,
  MAX_PROFILE_STORE_BYTES,
  MAX_PROFILE_VALUES,
  MAX_PROFILES,
  normalizeBrandProfile,
  normalizeBrandProfileStore,
  type BrandProfile,
} from '../packages/workspace/brand-profile-model.mts';

const NOW = '2026-09-09T00:00:00.000Z';

export function richBrandHistoryProfiles(count = 1): BrandProfile[] {
  return Array.from({ length: count }, (_, profileIndex) => {
    const domains = Array.from({ length: 20 }, (_, index) => `domain-${profileIndex}-${index}.example`);
    const profile = normalizeBrandProfile({
      id: `capacity-profile-${profileIndex}`, name: `Capacity profile ${profileIndex}`, officialDomains: domains,
      desiredPostureBaselines: domains.map((domain) => ({ domain, nameservers: [`ns1.${domain}`], updatedAt: NOW })),
      createdAt: NOW, updatedAt: NOW,
    });
    if (!profile) throw new Error('The complete profile fixture was not admitted.');
    for (const baseline of profile.desiredPostureBaselines) {
      baseline.observationHistory = Array.from({ length: 12 }, (_, index) => {
        const observedAt = new Date(Date.parse(NOW) + index * 1_000).toISOString();
        const source = (name: 'dns_ns' | 'dns_mx' | 'dns_caa' | 'registry_rdap') => ({
          version: 1 as const, source: name, observedAt, state: 'complete' as const, omittedRecords: 0,
        });
        return { observedAt, context: brandPostureObservationContext(profile, baseline.domain), checks: [
          { id: 'nameservers', status: 'warning' as const,
            records: Array.from({ length: 64 }, (_, record) => `ns-${record}.${'d'.repeat(50)}.${baseline.domain}`), sourceContext: source('dns_ns') },
          { id: 'mx', status: 'info' as const, records: [`10 mx1.${baseline.domain}`, `20 mx2.${baseline.domain}`], sourceContext: source('dns_mx') },
          { id: 'caa', status: 'info' as const, records: ['0 issue issuer.example'], sourceContext: source('dns_caa') },
          { id: 'registration_lock', status: 'pass' as const, records: ['clienttransferprohibited'], sourceContext: source('registry_rdap') },
        ] };
      });
    }
    return profile;
  });
}

export function denseBrandHistoryStore() {
  const base = richBrandHistoryProfiles()[0]!;
  const profiles = Array.from({ length: 8 }, (_, index) => {
    const profile = structuredClone(base);
    profile.id = `dense-profile-${index}`;
    profile.name = `Dense profile ${index}`;
    for (const baseline of profile.desiredPostureBaselines) {
      for (const observation of baseline.observationHistory ?? []) {
        observation.context = brandPostureObservationContext(profile, baseline.domain);
        for (const check of observation.checks) {
          check.records = Array.from({ length: 64 }, (_, record) => record.toString(36));
        }
      }
    }
    return profile;
  });
  const store = normalizeBrandProfileStore(profiles);
  while (Buffer.byteLength(JSON.stringify(store)) > MAX_PROFILE_STORE_BYTES) {
    const last = store.profiles.at(-1)!;
    if (!last.desiredPostureBaselines.pop()) store.profiles.pop();
  }
  return normalizeBrandProfileStore(store);
}

/** Fill ordinary bounded fields to an exact UTF-8 stored size, without padding unknown fields. */
export function brandProfileStoreAtBytes(targetBytes: number) {
  const profiles = Array.from({ length: MAX_PROFILES }, (_, index) => {
    const profile = normalizeBrandProfile({ id: `profile-${index}`, name: `Profile ${index}`, createdAt: NOW, updatedAt: NOW });
    if (!profile) throw new Error('The exact-capacity profile fixture was not admitted.');
    return profile;
  });
  const base = normalizeBrandProfileStore(profiles);
  let remaining = targetBytes - Buffer.byteLength(JSON.stringify(base));
  if (!Number.isSafeInteger(remaining) || remaining < 0) throw new Error('Requested profile size is too small.');
  outer: for (const field of ['productNames', 'allowlistedRegistrars'] as const) {
    for (const [profileIndex, profile] of profiles.entries()) {
      for (let index = 0; index < MAX_PROFILE_VALUES; index += 1) {
        if (remaining <= MAX_PROFILE_TEXT_LENGTH) {
          profile.trademarkOwner = 'x'.repeat(remaining);
          remaining = 0;
          break outer;
        }
        const overhead = profile[field].length ? 3 : 2;
        const length = Math.min(MAX_PROFILE_TEXT_LENGTH, remaining - overhead);
        const prefix = `${profileIndex}-${index}-`;
        profile[field].push(prefix.padEnd(length, 'x'));
        remaining -= length + overhead;
      }
    }
  }
  if (remaining !== 0) throw new Error('Requested profile size exceeds the fixture fields.');
  const store = normalizeBrandProfileStore(profiles);
  if (Buffer.byteLength(JSON.stringify(store)) !== targetBytes) throw new Error('The profile fixture did not retain its exact byte size.');
  return store;
}
