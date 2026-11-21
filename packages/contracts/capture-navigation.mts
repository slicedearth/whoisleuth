export const CAPTURE_NAVIGATION_PLAN_SCHEMA = 'whoisleuth.capture-navigation-plan';
export const CAPTURE_NAVIGATION_PLAN_VERSION = 1;
export const MAX_CAPTURE_NAVIGATION_STEPS = 5;
export const MAX_CAPTURE_NAVIGATION_PLAN_BYTES = 16 * 1024;
export type CaptureNavigationStep = Readonly<{ selectedOrigin: string; beforeCapture: number | null; afterCapture: number | null;
  state: 'captured' | 'blocked' | 'not_attempted' }>;
export type CaptureNavigation = Readonly<{ version: 1; profile: 'selected_url_navigation'; steps: readonly CaptureNavigationStep[]; directConnectionRefusals: number;
  totals: Readonly<{ requestAttempts: number; responseBytesCharged: number; publicRequestHosts: number }> }>;
