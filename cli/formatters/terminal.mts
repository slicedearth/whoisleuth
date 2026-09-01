// Stable terminal-formatting facade. Command and evidence families retain
// focused framework-neutral owners while callers keep one compatibility import.

export {
  MAX_LOOKUP_TERMINAL_ALPN_IDS,
  MAX_LOOKUP_TERMINAL_ALPN_ID_LENGTH,
  MAX_LOOKUP_TERMINAL_LIMITATIONS,
  MAX_LOOKUP_TERMINAL_NAMES,
  MAX_LOOKUP_TERMINAL_RECORDS,
  formatTerminalLookup,
} from './terminal-lookup.mts';
export {
  MAX_CT_TERMINAL_HOSTNAMES,
  MAX_CT_TERMINAL_MATCHES,
  MAX_DISCOVER_TERMINAL_CANDIDATES,
  MAX_POSTURE_TERMINAL_RECORDS,
  MAX_RISK_CALIBRATION_TERMINAL_RECORDS,
  formatTerminalBulk,
  formatTerminalCompare,
  formatTerminalCtSearch,
  formatTerminalDiscover,
  formatTerminalHttp,
  formatTerminalPosture,
  formatTerminalRegistrySupport,
  formatTerminalRiskCalibration,
  formatTerminalTls,
} from './terminal-command-formats.mts';
export {
  MAX_TERMINAL_VALUE_LENGTH,
  MAX_TLS_TERMINAL_ALT_NAMES,
  MAX_TLS_TERMINAL_PURPOSES,
  safeTerminalValue,
} from './terminal-shared.mts';
export type {
  MutationLabels,
  TerminalBulkItem,
  TerminalBulkMetadata,
  TerminalRecord,
} from './terminal-shared.mts';
