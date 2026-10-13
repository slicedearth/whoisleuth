export const APPEARANCE_STORAGE_KEY = 'whoisleuth:appearance:v1';
export const APPEARANCE_CHANGE_EVENT = 'whoisleuth:appearance-change';

// The mounted Console owns this presentation choice. It is not persisted with
// browser preferences or investigation data, and cannot change collection.
export const CONSOLE_PRESENTATION_CONTEXT = Symbol('console-presentation');
export type ConsolePresentation = 'desk' | 'bench' | 'journal';
export interface ConsolePresentationContext { readonly current: ConsolePresentation }

export interface AppearancePreference {
  density: 'comfortable' | 'compact';
  effects: 'full' | 'minimal';
  consoleStyle: 'desk' | 'terminal';
}

// Preserve the four existing density/effects values. Four explicit terminal
// variants add only browser-wide decoration, not workspace or evidence state.
export function parseAppearancePreference(value: unknown): AppearancePreference {
  const terminal = value === 'comfortable:full:terminal' || value === 'comfortable:minimal:terminal'
    || value === 'compact:full:terminal' || value === 'compact:minimal:terminal';
  const base = terminal ? (value as string).slice(0, -':terminal'.length) : value;
  return {
    density: base === 'compact:full' || base === 'compact:minimal' ? 'compact' : 'comfortable',
    effects: base === 'compact:minimal' || base === 'comfortable:minimal' ? 'minimal' : 'full',
    consoleStyle: terminal ? 'terminal' : 'desk',
  };
}

export function serialiseAppearancePreference(value: AppearancePreference): string {
  return `${value.density === 'compact' ? 'compact' : 'comfortable'}:${value.effects === 'minimal' ? 'minimal' : 'full'}${value.consoleStyle === 'terminal' ? ':terminal' : ''}`;
}

function currentAppearance(): AppearancePreference {
  if (typeof document === 'undefined') return parseAppearancePreference(null);
  const { density, effects, consoleStyle } = document.documentElement.dataset;
  return parseAppearancePreference(`${density}:${effects}${consoleStyle === 'terminal' ? ':terminal' : ''}`);
}

export function readAppearancePreference(): AppearancePreference {
  if (typeof window === 'undefined') return parseAppearancePreference(null);
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return stored === null ? currentAppearance() : parseAppearancePreference(stored);
  } catch {
    return currentAppearance();
  }
}

export function applyAppearancePreference(value: AppearancePreference): void {
  if (typeof document === 'undefined') return;
  const preference = parseAppearancePreference(serialiseAppearancePreference(value));
  document.documentElement.dataset.density = preference.density;
  document.documentElement.dataset.effects = preference.effects;
  document.documentElement.dataset.consoleStyle = preference.consoleStyle;
}

export function setAppearancePreference(value: AppearancePreference): boolean {
  const serialised = serialiseAppearancePreference(value);
  let persisted = false;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, serialised);
      persisted = true;
    } catch { /* The document preference still works with unavailable storage. */ }
    window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGE_EVENT, { detail: serialised }));
  }
  applyAppearancePreference(parseAppearancePreference(serialised));
  return persisted;
}

export function observeAppearancePreference(callback: (value: AppearancePreference) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const update = (value: unknown) => {
    const preference = parseAppearancePreference(value);
    applyAppearancePreference(preference);
    callback(preference);
  };
  const storage = (event: StorageEvent) => {
    if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) update(event.newValue);
  };
  const change = (event: Event) => update((event as CustomEvent<unknown>).detail);
  window.addEventListener('storage', storage);
  window.addEventListener(APPEARANCE_CHANGE_EVENT, change);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(APPEARANCE_CHANGE_EVENT, change);
  };
}
