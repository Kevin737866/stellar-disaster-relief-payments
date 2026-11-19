import React, { createContext, useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
});

/**
 * The only value persisted for theming. This is a non-sensitive presentation
 * preference: never store names, wallet addresses, recovery codes, auth tokens,
 * or any other personal/financial data alongside it.
 */
export const THEME_STORAGE_KEY = 'stellar-theme';
const STORAGE_KEY = THEME_STORAGE_KEY;

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
    // Discard anything that is not a theme token rather than keeping unknown
    // (potentially sensitive) data under the theme key.
    if (stored !== null) localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (SSR / private browsing)
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  // Track whether the user has explicitly chosen a theme (vs. auto-detected)
  const [userChosen, setUserChosen] = useState<boolean>(() => {
    try { return isTheme(localStorage.getItem(STORAGE_KEY)); } catch { return false; }
  });

  // Apply on mount and whenever theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Persist only the allowlisted theme value, and only after an explicit choice.
  useEffect(() => {
    if (!userChosen) return;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme, userChosen]);

  // Listen for OS-level preference changes when no stored preference exists
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (!userChosen) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [userChosen]);

  const toggleTheme = useCallback(() => {
    setUserChosen(true);
    setTheme(t => (t === 'light' ? 'dark' : 'light'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
