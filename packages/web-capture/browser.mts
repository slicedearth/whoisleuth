import { chromium } from 'playwright';
import { MAX_CAPTURE_TIMEOUT_MS } from './capture.mts';

export function launchCaptureBrowser(timeout: number, browser: Pick<typeof chromium, 'launch'> = chromium) {
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_CAPTURE_TIMEOUT_MS) throw new Error('Capture browser launch requires a bounded deadline.');
  return browser.launch({ headless: true, chromiumSandbox: true, timeout });
}
