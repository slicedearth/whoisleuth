const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  USAGE: 2,
  LOOKUP_FAILED: 3,
  PARTIAL_FAILURE: 4,
  INTERNAL_ERROR: 70,
} as const);

export default EXIT_CODES;
export type ExitCodeName = keyof typeof EXIT_CODES;
export type ExitCode = (typeof EXIT_CODES)[ExitCodeName];
