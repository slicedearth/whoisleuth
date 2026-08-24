const UNSAFE_RETAINED_TEXT_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u;
const UNSAFE_RETAINED_TEXT_GLOBAL_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu;

export function hasUnsafeRetainedText(value: string): boolean {
  return UNSAFE_RETAINED_TEXT_RE.test(value);
}

export function neutralizeUnsafeRetainedText(value: string): string {
  return value.replace(UNSAFE_RETAINED_TEXT_GLOBAL_RE, ' ');
}
