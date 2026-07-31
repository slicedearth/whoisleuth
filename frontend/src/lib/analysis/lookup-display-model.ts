// Stable Lookup display-model facade. Evidence families live in focused,
// framework-neutral builders so routes can keep one compatibility import.

export { buildLookupLifecycleDates } from './lookup-lifecycle-display.ts';
export { buildLookupNetworkDisplay } from './lookup-network-display.ts';
export { buildLookupPageDisplay } from './lookup-page-display.ts';
export { buildLookupRegistryDisplay } from './lookup-registry-display.ts';

export {
  boundedTechnologyText,
  dateTimeAttribute,
  formatDate,
  isRecord,
  rec,
  records,
  show,
  statusLabel,
  stringList,
  type JsonRecord,
  type SourceStatus,
} from './lookup-display-shared.ts';
