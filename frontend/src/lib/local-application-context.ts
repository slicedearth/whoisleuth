/** Only the separate loopback host inserts these fixed build markers. */
export function isLocalApplication(): boolean {
  return typeof document !== 'undefined'
    && document.querySelector<HTMLMetaElement>('meta[name="whoisleuth-local-application"]')?.content === '1';
}

export function localApplicationWorkspaceId(): string | null {
  return isLocalApplication()
    ? document.querySelector<HTMLMetaElement>('meta[name="whoisleuth-local-workspace"]')?.content ?? null
    : null;
}
