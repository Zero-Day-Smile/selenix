// workspace_components/ThemeContext.tsx
//
// Lightweight theme context so any component (charts especially, which
// need explicit color values rather than CSS classes -- Plotly renders to
// canvas/SVG with its own paper_bgcolor/plot_bgcolor, not Tailwind
// classes) can read the current light/dark mode without prop-drilling it
// through every intermediate component. Provided once by Workspace.tsx,
// which already owns the real toggle state (useTheme.ts).
import React, { createContext, useContext } from 'react';
import type { Theme } from './useTheme';

const ThemeContext = createContext<Theme>('dark');

export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useCurrentTheme(): Theme {
  return useContext(ThemeContext);
}
