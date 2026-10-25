import React, { createContext, useContext, useEffect, ReactNode } from 'react';

export type Theme = 'light' | 'dark';

/**
 * Theme keys stored server-side / localStorage:
 *  - ic_theme        : the user's own choice ('light' | 'dark')
 *  - ic_default_theme: platform-wide default set by platform_admin on
 *                      the "Infracentra Themes" admin page. New visitors
 *                      inherit it unless they made a personal choice.
 */
const THEME_KEY = 'ic_theme';
const DEFAULT_THEME_KEY = 'ic_default_theme';

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function readInitialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY) as Theme | null;
  if (saved === 'light' || saved === 'dark') return saved;
  const platformDefault = localStorage.getItem(DEFAULT_THEME_KEY);
  // Calm Operations (light) is the product default.
  return platformDefault === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggleTheme = () =>
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

/** Called by the Platform Admin "Infracentra Themes" page. */
export function setPlatformDefaultTheme(t: Theme) {
  localStorage.setItem(DEFAULT_THEME_KEY, t);
  window.dispatchEvent(new Event('infracentra-theme-default-changed'));
}

export function getPlatformDefaultTheme(): Theme {
  return localStorage.getItem(DEFAULT_THEME_KEY) === 'dark' ? 'dark' : 'light';
}
