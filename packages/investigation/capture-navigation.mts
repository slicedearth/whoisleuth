import { array, enumeration, exact, integer, text } from '../evidence/artifact-structure.mts';
import { MAX_CAPTURE_HOSTS, MAX_CAPTURE_TRANSFER_BYTES } from '../contracts/web-capture.mts';
import { MAX_CAPTURE_NAVIGATION_STEPS, type CaptureNavigationStep, type CaptureNavigation } from '../contracts/capture-navigation.mts';

/** Fixed generated file names, never paths supplied by a page or plan. */
export function captureArtifactName(index: number, kind: 'screenshot' | 'dom_digest'): string {
  integer(index, 'Capture index', 0, MAX_CAPTURE_NAVIGATION_STEPS - 1);
  const name = kind === 'screenshot' ? 'screenshot.png' : 'dom-digest.json';
  return index === 0 ? name : `capture-${index + 1}-${name}`;
}

/** Selection history is separate from observed page responses and redirects. */
export function readCaptureNavigation(raw: unknown, manifestVersion: unknown, captures: readonly unknown[]): CaptureNavigation | null {
  if (raw === undefined) return null;
  if (manifestVersion !== 4) throw new TypeError('Selected navigation declarations require capture manifest version 4.');
  const value = exact(raw, ['version', 'profile', 'steps', 'directConnectionRefusals', 'totals'], 'Capture navigation');
  if (value.version !== 1 || value.profile !== 'selected_url_navigation') throw new TypeError('Capture navigation profile is unsupported.');
  const steps: CaptureNavigationStep[] = [];
  let previous: number | null = null, stopped = false, captured = 0;
  for (const rawStep of array(value.steps, 'Selected navigation steps', MAX_CAPTURE_NAVIGATION_STEPS, 1)) {
    const step = exact(rawStep, ['selectedOrigin', 'beforeCapture', 'afterCapture', 'state'], 'Selected navigation step');
    const selectedOrigin = text(step.selectedOrigin, 'Selected navigation origin', 500), origin = new URL(selectedOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.port || origin.origin !== selectedOrigin) throw new TypeError('Selected navigation retains HTTP(S) origins only.');
    const state = enumeration(step.state, ['captured', 'blocked', 'not_attempted'] as const, 'Selected navigation state');
    if (step.beforeCapture !== previous || stopped && state !== 'not_attempted' || !stopped && state === 'not_attempted') throw new TypeError('Selected navigation order is inconsistent.');
    if (state === 'captured') {
      if (step.afterCapture !== captured || !captures[captured] || (captures[captured] as { domain?: unknown }).domain !== origin.hostname.toLowerCase().replace(/\.$/u, '')) throw new TypeError('Selected navigation capture identity is inconsistent.');
      previous = captured++;
    } else {
      if (step.afterCapture !== null || previous === null) throw new TypeError('Selected navigation lacks its preceding capture.');
      stopped = true;
    }
    steps.push({ selectedOrigin, beforeCapture: step.beforeCapture as number | null, afterCapture: step.afterCapture as number | null, state });
  }
  if (captured !== captures.length) throw new TypeError('Every selected navigation capture must be accounted for.');
  const totals = exact(value.totals, ['requestAttempts', 'responseBytesCharged', 'publicRequestHosts'], 'Navigation request accounting');
  return { version: 1, profile: 'selected_url_navigation', steps, directConnectionRefusals: integer(value.directConnectionRefusals, 'Unattributed navigation barrier refusals', 0, 1_000_000),
    totals: { requestAttempts: integer(totals.requestAttempts, 'Navigation request attempts', 0, 1_000_000),
      responseBytesCharged: integer(totals.responseBytesCharged, 'Navigation response bytes charged', 0, MAX_CAPTURE_TRANSFER_BYTES),
      publicRequestHosts: integer(totals.publicRequestHosts, 'Navigation public request hosts', 0, MAX_CAPTURE_HOSTS) } };
}
