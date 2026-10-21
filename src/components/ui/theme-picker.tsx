'use client';

import { useState } from 'react';

import { THEME_COOKIE, type ThemeChoice } from '@/lib/theme';

/**
 * Light, dark, or whatever the phone is set to.
 *
 * Stored in a cookie rather than localStorage so the server renders the right
 * theme in the first response — no white flash before a dark page.
 */
function applyTheme(next: ThemeChoice) {
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  if (next === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
}

export function ThemePicker({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  function pick(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
  }

  return (
    <div className="segmented" role="group" aria-label="Appearance" style={{ margin: '4px 0 12px' }}>
      {(['system', 'light', 'dark'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={choice === option}
          onClick={() => pick(option)}
        >
          {option === 'system' ? 'Phone setting' : option === 'light' ? 'Light' : 'Dark'}
        </button>
      ))}
    </div>
  );
}
