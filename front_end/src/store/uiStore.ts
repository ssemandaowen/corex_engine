import { create } from 'zustand';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  subscriptionTier: string;
}

interface UiState {
  activeTab: string;
  collapsed: boolean;
  terminalCollapsed: boolean;
  authUser: User | null;
  token: string | null;
  activeAccountMode: 'PAPER' | 'LIVE';
  realtimeMode: 'WS' | 'POLL';
  engineStatus: 'STABLE' | 'DEGRADED' | 'OFFLINE';
  theme: 'dark' | 'light' | 'godot-dark' | 'godot-light';
  themeMode: 'light' | 'dark';
  editorFontSize: number;
  editorTabSize: number;
  editorWordWrap: boolean;
  editorMinimap: boolean;
  editorTheme: 'corex-dark' | 'vs-light' | 'godot-dark-editor' | 'godot-light-editor' | 'vs-dark';
  editorLineNumbers: boolean;
  editorAutoClosingBrackets: boolean;
  setActiveTab: (tab: string) => void;
  setCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  setTerminalCollapsed: (collapsed: boolean) => void;
  setAuthUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setActiveAccountMode: (mode: 'PAPER' | 'LIVE') => void;
  setRealtimeMode: (mode: 'WS' | 'POLL') => void;
  setEngineStatus: (status: 'STABLE' | 'DEGRADED' | 'OFFLINE') => void;
  setTheme: (theme: 'dark' | 'light' | 'godot-dark' | 'godot-light') => void;
  setEditorFontSize: (size: number) => void;
  setEditorTabSize: (size: number) => void;
  setEditorWordWrap: (wrap: boolean) => void;
  setEditorMinimap: (minimap: boolean) => void;
  setEditorTheme: (theme: 'corex-dark' | 'vs-light' | 'godot-dark-editor' | 'godot-light-editor' | 'vs-dark') => void;
  setEditorLineNumbers: (lineNumbers: boolean) => void;
  setEditorAutoClosingBrackets: (autoClose: boolean) => void;
}

// Check localStorage for initial token/user
const storedToken = localStorage.getItem('corex_token');
let initialUser: User | null = null;
try {
  const userJson = localStorage.getItem('corex_user');
  if (userJson) {
    initialUser = JSON.parse(userJson);
  }
} catch (e) {
  console.error('Failed to parse stored user', e);
}

const storedTheme = (localStorage.getItem('corex_theme') || 'dark') as 'dark' | 'light' | 'godot-dark' | 'godot-light';
const storedThemeMode = storedTheme.includes('light') ? 'light' : 'dark';
if (typeof document !== 'undefined') {
  document.documentElement.className = '';
  document.documentElement.classList.add(`theme-${storedTheme}`);
  document.body.setAttribute('data-theme', storedTheme);
  document.body.setAttribute('data-theme-mode', storedThemeMode);
}

const initialEditorTheme = (localStorage.getItem('corex_editor_theme') || 
  (storedTheme === 'light' ? 'vs-light' : 
   storedTheme === 'godot-dark' ? 'godot-dark-editor' : 
   storedTheme === 'godot-light' ? 'godot-light-editor' : 
   'corex-dark')) as any;

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'home',
  collapsed: false,
  terminalCollapsed: false,
  authUser: initialUser,
  token: storedToken,
  activeAccountMode: 'PAPER',
  realtimeMode: 'POLL',
  engineStatus: 'STABLE',
  theme: storedTheme,
  themeMode: storedThemeMode,
  editorFontSize: parseInt(localStorage.getItem('corex_editor_font_size') || '13'),
  editorTabSize: parseInt(localStorage.getItem('corex_editor_tab_size') || '2'),
  editorWordWrap: localStorage.getItem('corex_editor_word_wrap') !== 'false',
  editorMinimap: localStorage.getItem('corex_editor_minimap') === 'true',
  editorTheme: initialEditorTheme,
  editorLineNumbers: localStorage.getItem('corex_editor_line_numbers') !== 'false',
  editorAutoClosingBrackets: localStorage.getItem('corex_editor_auto_close') !== 'false',

  setActiveTab: (tab) => set({ activeTab: tab }),
  setCollapsed: (collapsed) => set((state) => ({ 
    collapsed: typeof collapsed === 'function' ? collapsed(state.collapsed) : collapsed 
  })),
  setTerminalCollapsed: (collapsed) => set({ terminalCollapsed: collapsed }),
  setAuthUser: (user) => {
    if (user) {
      localStorage.setItem('corex_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('corex_user');
    }
    set({ authUser: user });
  },
  setToken: (token) => {
    if (token) {
      localStorage.setItem('corex_token', token);
      set({ token });
    } else {
      localStorage.removeItem('corex_token');
      localStorage.removeItem('corex_user');
      set({ token, authUser: null });
    }
  },
  setActiveAccountMode: (mode) => set({ activeAccountMode: mode }),
  setRealtimeMode: (mode) => set({ realtimeMode: mode }),
  setEngineStatus: (status) => set({ engineStatus: status }),
  setTheme: (theme) => {
    localStorage.setItem('corex_theme', theme);
    const themeMode = theme.includes('light') ? 'light' : 'dark';
    if (typeof document !== 'undefined') {
      document.documentElement.className = '';
      document.documentElement.classList.add(`theme-${theme}`);
      document.body.setAttribute('data-theme', theme);
      document.body.setAttribute('data-theme-mode', themeMode);
    }
    
    // Automatically match editor theme to light/dark system theme
    let matchedEditorTheme: any = 'corex-dark';
    if (theme === 'light') matchedEditorTheme = 'vs-light';
    else if (theme === 'godot-dark') matchedEditorTheme = 'godot-dark-editor';
    else if (theme === 'godot-light') matchedEditorTheme = 'godot-light-editor';
    
    localStorage.setItem('corex_editor_theme', matchedEditorTheme);
    set({ theme, themeMode, editorTheme: matchedEditorTheme });
  },
  setEditorFontSize: (size) => {
    localStorage.setItem('corex_editor_font_size', size.toString());
    set({ editorFontSize: size });
  },
  setEditorTabSize: (size) => {
    localStorage.setItem('corex_editor_tab_size', size.toString());
    set({ editorTabSize: size });
  },
  setEditorWordWrap: (wrap) => {
    localStorage.setItem('corex_editor_word_wrap', wrap ? 'true' : 'false');
    set({ editorWordWrap: wrap });
  },
  setEditorMinimap: (minimap) => {
    localStorage.setItem('corex_editor_minimap', minimap ? 'true' : 'false');
    set({ editorMinimap: minimap });
  },
  setEditorTheme: (editorTheme) => {
    localStorage.setItem('corex_editor_theme', editorTheme);
    set({ editorTheme });
  },
  setEditorLineNumbers: (lineNumbers) => {
    localStorage.setItem('corex_editor_line_numbers', lineNumbers ? 'true' : 'false');
    set({ editorLineNumbers: lineNumbers });
  },
  setEditorAutoClosingBrackets: (autoClose) => {
    localStorage.setItem('corex_editor_auto_close', autoClose ? 'true' : 'false');
    set({ editorAutoClosingBrackets: autoClose });
  }
}));
export default useUiStore;
