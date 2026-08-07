export type PublicSessionState = 'checking' | 'authenticated' | 'anonymous' | 'unavailable';
export type PublicSessionGetter = () => PublicSessionState;

export const PUBLIC_SESSION_CONTEXT = Symbol('public-session');

export function classifyPublicSessionResponse(ok: boolean, body: unknown): PublicSessionState {
  if (!ok || !body || typeof body !== 'object' || Array.isArray(body)) return 'unavailable';
  const authenticated = (body as Record<string, unknown>).authenticated;
  if (authenticated === true) return 'authenticated';
  if (authenticated === false) return 'anonymous';
  return 'unavailable';
}
