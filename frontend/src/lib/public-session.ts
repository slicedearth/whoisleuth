export type PublicSessionState = 'checking' | 'authenticated' | 'anonymous';
export type PublicSessionGetter = () => PublicSessionState;

export const PUBLIC_SESSION_CONTEXT = Symbol('public-session');
