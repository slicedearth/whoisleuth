import type { Page } from '@playwright/test';

import { ALLOWED_ORIGIN } from './constants.ts';
import {
  PERFORMANCE_SAMPLE_COUNT,
  PERFORMANCE_TIMING_POLICY,
  installNavigationReadinessMark,
  performanceMeasurementContext,
  performanceSampleMedian,
  summarizePerformanceTimings,
  resetPerformanceSampleState as resetPerformanceSampleStateForOrigin,
  validateBrowserReadinessTargets,
  type BrowserReadinessTarget,
  type PerformanceMeasurementContext,
} from '../tools/playwright-execution-contract.mts';

export {
  PERFORMANCE_SAMPLE_COUNT,
  PERFORMANCE_TIMING_POLICY,
  installNavigationReadinessMark,
  performanceMeasurementContext,
  performanceSampleMedian,
  summarizePerformanceTimings,
};
export type {
  BrowserReadinessTarget,
  PerformanceMeasurementContext,
};

export type BrowserInteractionReadiness = Readonly<{
  start: Readonly<{
    event: 'change' | 'click' | 'input' | 'keydown' | 'pointerover';
    selector?: string;
    key?: string;
    controlOrMeta?: boolean;
  }>;
  targets: readonly BrowserReadinessTarget[];
}>;

type BrowserInteractionReadinessResult = Readonly<{
  browserReadyMs: number;
}>;

export async function beginBrowserInteractionReadiness(
  page: Page,
  definition: BrowserInteractionReadiness,
): Promise<void> {
  validateBrowserReadinessTargets(definition.targets);
  if (definition.start.selector !== undefined && (!definition.start.selector.trim() || definition.start.selector.length > 240)) {
    throw new TypeError('Browser interaction selectors must be bounded non-empty strings.');
  }
  await page.evaluate((input) => {
    type ReadinessRuntime = {
      startedAt: number | null;
      readyAt: number | null;
      animationFrame: number | null;
      cleanup: () => void;
    };
    const scope = globalThis as typeof globalThis & { __whoisleuthInteractionReadiness?: ReadinessRuntime };
    scope.__whoisleuthInteractionReadiness?.cleanup();
    const normalizeText = (value: string): string => value.replace(/\s+/gu, ' ').trim();
    const visible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.visibility !== 'collapse'
        && element.getClientRects().length > 0;
    };
    const targetReady = (target: BrowserReadinessTarget): boolean => (
      [...document.querySelectorAll(target.selector)].some((element) => {
        if (target.visibility !== 'attached' && !visible(element)) return false;
        if (target.exactText !== undefined && normalizeText(element.textContent ?? '') !== normalizeText(target.exactText)) return false;
        if (target.requireEnabled && (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true')) return false;
        return true;
      })
    );
    const runtime: ReadinessRuntime = {
      startedAt: null,
      readyAt: null,
      animationFrame: null,
      cleanup: () => undefined,
    };
    const poll = (): void => {
      runtime.animationFrame = null;
      if (runtime.startedAt === null || runtime.readyAt !== null) return;
      if (input.targets.every(targetReady)) {
        runtime.readyAt = performance.now();
        return;
      }
      runtime.animationFrame = requestAnimationFrame(poll);
    };
    const onStart = (event: Event): void => {
      if (runtime.startedAt !== null) return;
      const target = event.target instanceof Element ? event.target : null;
      if (input.start.selector && !target?.closest(input.start.selector)) return;
      if (input.start.event === 'keydown') {
        if (!(event instanceof KeyboardEvent)) return;
        if (input.start.key && event.key.toLocaleLowerCase('en-AU') !== input.start.key.toLocaleLowerCase('en-AU')) return;
        if (input.start.controlOrMeta && !event.ctrlKey && !event.metaKey) return;
      }
      runtime.startedAt = performance.now();
      runtime.animationFrame = requestAnimationFrame(poll);
    };
    runtime.cleanup = () => {
      document.removeEventListener(input.start.event, onStart, true);
      if (runtime.animationFrame !== null) cancelAnimationFrame(runtime.animationFrame);
      runtime.animationFrame = null;
    };
    document.addEventListener(input.start.event, onStart, true);
    scope.__whoisleuthInteractionReadiness = runtime;
  }, definition);
}

export async function readBrowserInteractionReadiness(page: Page): Promise<BrowserInteractionReadinessResult> {
  await page.waitForFunction(() => {
    const scope = globalThis as typeof globalThis & {
      __whoisleuthInteractionReadiness?: { readyAt: number | null };
    };
    return scope.__whoisleuthInteractionReadiness?.readyAt !== null
      && scope.__whoisleuthInteractionReadiness?.readyAt !== undefined;
  });
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __whoisleuthInteractionReadiness?: {
        startedAt: number | null;
        readyAt: number | null;
        cleanup: () => void;
      };
    };
    const runtime = scope.__whoisleuthInteractionReadiness;
    runtime?.cleanup();
    if (runtime?.startedAt === null || runtime?.startedAt === undefined
      || runtime.readyAt === null || runtime.readyAt === undefined
      || runtime.readyAt < runtime.startedAt) {
      throw new Error('Browser interaction readiness marks are incomplete or invalid.');
    }
    return Object.freeze({ browserReadyMs: Math.round((runtime.readyAt - runtime.startedAt) * 100) / 100 });
  });
}

export async function isBrowserInteractionReadinessMarked(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __whoisleuthInteractionReadiness?: { readyAt: number | null };
    };
    return typeof scope.__whoisleuthInteractionReadiness?.readyAt === 'number';
  });
}

export async function abortBrowserInteractionReadiness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __whoisleuthInteractionReadiness?: { cleanup: () => void };
    };
    scope.__whoisleuthInteractionReadiness?.cleanup();
    delete scope.__whoisleuthInteractionReadiness;
  }).catch(() => undefined);
}

export async function readNavigationReadinessMark(page: Page): Promise<number> {
  await page.waitForFunction(() => {
    const scope = globalThis as typeof globalThis & { __whoisleuthNavigationReadyAt?: number | null };
    return typeof scope.__whoisleuthNavigationReadyAt === 'number';
  });
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __whoisleuthNavigationReadyAt?: number | null };
    if (typeof scope.__whoisleuthNavigationReadyAt !== 'number') {
      throw new Error('Browser navigation readiness mark is unavailable.');
    }
    return Math.round(scope.__whoisleuthNavigationReadyAt * 100) / 100;
  });
}

export async function isNavigationReadinessMarked(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __whoisleuthNavigationReadyAt?: number | null };
    return typeof scope.__whoisleuthNavigationReadyAt === 'number';
  });
}

export async function resetPerformanceSampleState(page: Page): Promise<void> {
  return resetPerformanceSampleStateForOrigin(page, ALLOWED_ORIGIN);
}
