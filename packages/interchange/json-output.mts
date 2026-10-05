const TERMINAL_UNSAFE_JSON_RE = /[\u007f-\u009f\u2028\u2029]|\p{Default_Ignorable_Code_Point}/gu;

function jsonUnicodeEscape(value: string): string {
  const codePoint = value.codePointAt(0)!;
  if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, '0')}`;
  const offset = codePoint - 0x10000;
  const high = 0xd800 + (offset >> 10);
  const low = 0xdc00 + (offset & 0x3ff);
  return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`;
}

/** Escape display controls without changing the parsed JSON values. */
export function terminalSafeJson(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space).replace(TERMINAL_UNSAFE_JSON_RE, jsonUnicodeEscape);
}
