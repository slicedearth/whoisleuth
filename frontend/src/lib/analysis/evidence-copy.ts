/** A presentation-only copy form. Never use it as a collection target. */
export function defangedIndicator(value: string): string {
  return value.replace(/^https:/iu, 'hxxps:').replace(/^http:/iu, 'hxxp:').replace(/(?<!\[)\.(?!\])/gu, '[.]');
}

export function evidenceCitation(label: string, source: string, observedAt: string | null): string {
  return `${label}\nSource: ${source}\nObserved: ${observedAt ?? 'Time not supplied'}`;
}
