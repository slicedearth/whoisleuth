export const APPEARANCE_STORAGE_KEY = 'whoisleuth:appearance:v1';
export const APPEARANCE_CHANGE_EVENT = 'whoisleuth:appearance-change';

export interface AppearancePreference {
  density: 'comfortable' | 'compact';
  effects: 'full' | 'minimal';
}

// Four fixed strings keep this browser-wide preference independent of saved
// evidence, workspace formats and unbounded JSON parsing.
export function parseAppearancePreference(value: unknown): AppearancePreference {
  return {
    density: value === 'compact:full' || value === 'compact:minimal' ? 'compact' : 'comfortable',
    effects: value === 'compact:minimal' || value === 'comfortable:minimal' ? 'minimal' : 'full',
  };
}

export function serialiseAppearancePreference(value: AppearancePreference): string {
  return `${value.density === 'compact' ? 'compact' : 'comfortable'}:${value.effects === 'minimal' ? 'minimal' : 'full'}`;
}

function currentAppearance(): AppearancePreference {
  if (typeof document === 'undefined') return parseAppearancePreference(null);
  const { density, effects } = document.documentElement.dataset;
  return parseAppearancePreference(`${density}:${effects}`);
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
