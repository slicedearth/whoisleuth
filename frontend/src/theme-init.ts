import { applyThemePreference, readThemePreference } from './lib/theme.ts';
import { applyAppearancePreference, readAppearancePreference } from './lib/appearance.ts';

applyThemePreference(readThemePreference());
applyAppearancePreference(readAppearancePreference());
