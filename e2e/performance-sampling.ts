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
  startedAtMs: number;
  readyAtMs: number;
}>;

export type InteractionRuntimeProbe = Readonly<{
  longTaskSupported: boolean;
  longTaskCount: number;
  longTaskTotalMs: number;
  layoutShiftSupported: boolean;
  layoutShiftCount: number;
  layoutShiftScore: number;
  transitionLayoutShiftCount: number;
  transitionLayoutShiftScore: number;
  residualLayoutShiftCount: number;
  residualLayoutShiftScore: number;
}>;

/** Installs browser-local observers; phase boundaries come from the actual input and readiness marks. */
export function resetInteractionRuntimeProbe(): void {
  const scope = globalThis as typeof globalThis & {
    __whoisleuthInteractionReadiness?: { startedAt: number | null; readyAt: number | null };
    __whoisleuthDeferredRuntime?: InteractionRuntimeProbe & { observers: PerformanceObserver[] };
  };
  for (const observer of scope.__whoisleuthDeferredRuntime?.observers ?? []) observer.disconnect();
  const probe = {
    longTaskSupported: false,
    longTaskCount: 0,
    longTaskTotalMs: 0,
    layoutShiftSupported: false,
    layoutShiftCount: 0,
    layoutShiftScore: 0,
    transitionLayoutShiftCount: 0,
    transitionLayoutShiftScore: 0,
    residualLayoutShiftCount: 0,
    residualLayoutShiftScore: 0,
    observers: [] as PerformanceObserver[],
  };
  scope.__whoisleuthDeferredRuntime = probe;
  if (typeof PerformanceObserver === 'undefined') return;
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    probe.longTaskSupported = true;
    const observer = new PerformanceObserver((list) => {
      const startedAt = scope.__whoisleuthInteractionReadiness?.startedAt;
      if (startedAt === undefined || startedAt === null) return;
      for (const entry of list.getEntries()) {
        const duration = entry.startTime + entry.duration - Math.max(startedAt, entry.startTime);
        if (duration <= 0) continue;
        probe.longTaskCount += 1;
        probe.longTaskTotalMs += duration;
      }
    });
    probe.observers.push(observer);
    observer.observe({ type: 'longtask', buffered: false });
  }
  if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
    probe.layoutShiftSupported = true;
    const observer = new PerformanceObserver((list) => {
      const marks = scope.__whoisleuthInteractionReadiness;
      if (marks?.startedAt === undefined || marks.startedAt === null) return;
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (typeof shift.value !== 'number' || shift.startTime < marks.startedAt) continue;
        if (!shift.hadRecentInput) {
          probe.layoutShiftCount += 1;
          probe.layoutShiftScore += shift.value;
        }
        // Use the browser mark, not the later arrival of a driver command.
        // Recent-input suppression must not hide movement after usable paint.
        if (marks.readyAt !== null && shift.startTime >= marks.readyAt) {
          probe.residualLayoutShiftCount += 1;
          probe.residualLayoutShiftScore += shift.value;
        } else {
          probe.transitionLayoutShiftCount += 1;
          probe.transitionLayoutShiftScore += shift.value;
        }
      }
    });
    probe.observers.push(observer);
    observer.observe({ type: 'layout-shift', buffered: false });
  }
}

export async function readInteractionRuntimeProbe(page: Page): Promise<InteractionRuntimeProbe> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __whoisleuthDeferredRuntime?: InteractionRuntimeProbe };
    const probe = scope.__whoisleuthDeferredRuntime;
    return {
      longTaskSupported: probe?.longTaskSupported ?? false,
      longTaskCount: probe?.longTaskCount ?? 0,
      longTaskTotalMs: Math.round((probe?.longTaskTotalMs ?? 0) * 100) / 100,
      layoutShiftSupported: probe?.layoutShiftSupported ?? false,
      layoutShiftCount: probe?.layoutShiftCount ?? 0,
      layoutShiftScore: Math.round((probe?.layoutShiftScore ?? 0) * 10_000) / 10_000,
      transitionLayoutShiftCount: probe?.transitionLayoutShiftCount ?? 0,
      transitionLayoutShiftScore: Math.round((probe?.transitionLayoutShiftScore ?? 0) * 10_000) / 10_000,
      residualLayoutShiftCount: probe?.residualLayoutShiftCount ?? 0,
      residualLayoutShiftScore: Math.round((probe?.residualLayoutShiftScore ?? 0) * 10_000) / 10_000,
    };
  });
}

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
      readyFrameSeen: boolean;
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
      readyFrameSeen: false,
      cleanup: () => undefined,
    };
    const poll = (): void => {
      runtime.animationFrame = null;
      if (runtime.startedAt === null || runtime.readyAt !== null) return;
      if (input.targets.every(targetReady)) {
        // Confirm the target after its first usable frame has painted. The
        // initial reveal is not residual movement after an already usable UI.
        if (runtime.readyFrameSeen) {
          runtime.readyAt = performance.now();
          return;
        }
        runtime.readyFrameSeen = true;
      } else {
        runtime.readyFrameSeen = false;
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
    return Object.freeze({ browserReadyMs: Math.round((runtime.readyAt - runtime.startedAt) * 100) / 100, startedAtMs: runtime.startedAt, readyAtMs: runtime.readyAt });
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
