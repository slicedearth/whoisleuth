/** Present an internal token without changing its stored value or acronym casing. */
export function tokenLabel(value: string): string {
  const words = value.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
