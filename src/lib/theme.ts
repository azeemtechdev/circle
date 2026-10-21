export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_COOKIE = 'circle-theme';

/** Anything unrecognised falls back to following the phone. */
export function parseTheme(raw: string | undefined): ThemeChoice {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}
