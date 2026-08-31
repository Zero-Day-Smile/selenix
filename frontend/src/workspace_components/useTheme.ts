// workspace_components/useTheme.ts
//
// User-toggled light/dark mode for the workspace, persisted in
// localStorage. Defaults to dark (the workspace's new default look) on a
// first visit with nothing stored yet. This is independent of the landing
// page, which keeps its own fixed light Navbar/Hero regardless of this
// setting -- only the workspace root applies the `.dark` class Tailwind's
// custom dark: variant (see index.css) keys off of.
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'lunar-terra-theme';

function readStored(): Theme {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // private browsing / storage disabled -- theme just won't persist
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return [theme, toggle];
}
