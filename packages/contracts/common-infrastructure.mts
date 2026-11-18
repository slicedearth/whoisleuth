// Shared by the catalogue producer and bounded runtime reader.
export const COMMON_INFRASTRUCTURE_SCHEMA = 'whoisleuth.common-infrastructure';
export const COMMON_INFRASTRUCTURE_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;
export const MAX_SNAPSHOT_ENTRIES = 20_000;
export const FRESHNESS_DAYS = 30;

export const OFFICIAL_CLOUD_RANGE_URLS = Object.freeze({
  'amazon-aws': 'https://ip-ranges.amazonaws.com/ip-ranges.json',
  'google-gcp': 'https://www.gstatic.com/ipranges/cloud.json',
});
