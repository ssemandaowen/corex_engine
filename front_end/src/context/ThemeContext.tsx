import React, { createContext, useContext, useEffect } from 'react';
import useUiStore from '../store/uiStore';

interface ThemeContextType {
  theme: 'dark' | 'light' | 'godot-dark' | 'godot-light';
  themeMode: 'light' | 'dark';
  setTheme: (theme: 'dark' | 'light' | 'godot-dark' | 'godot-light') => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, themeMode, setTheme } = useUiStore();

  useEffect(() => {
    if (typeof document !== 'undefined') {
      // Set theme-specific classes on the html/documentElement element
      document.documentElement.className = '';
      document.documentElement.classList.add(`theme-${theme}`);
      
      // Set theme attribute on body
      document.body.setAttribute('data-theme', theme);
      document.body.setAttribute('data-theme-mode', themeMode);
    }
  }, [theme, themeMode]);

  return (
    <ThemeContext.Provider value={{ theme, themeMode, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
