import React from 'react';
import Editor, { Monaco } from '@monaco-editor/react';
import useUiStore from '../../store/uiStore';

interface EditorPanelProps {
  code: string;
  onChange: (value: string | undefined) => void;
  language?: string;
  // Receives the live editor + monaco namespaces once mounted, so parents
  // (e.g. StrategyView) can register diagnostics markers.
  onReady?: (editor: any, monaco: Monaco) => void;
}

export default function EditorPanel({
  code,
  onChange,
  language = 'javascript',
  onReady
}: EditorPanelProps) {
  const {
    editorFontSize,
    editorTabSize,
    editorWordWrap,
    editorMinimap,
    editorTheme,
    editorLineNumbers,
    editorAutoClosingBrackets
  } = useUiStore();
  
  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    // Surface the editor + monaco instances to the parent for diagnostics.
    if (typeof onReady === 'function') {
      onReady(editor, monaco);
    }

    // 1. CoreX Twilight Dark Theme
    monaco.editor.defineTheme('corex-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
        { token: 'keyword', foreground: '1e90ff', fontStyle: 'bold' },
        { token: 'string', foreground: '10b981' },
        { token: 'number', foreground: 'f59e0b' },
        { token: 'type', foreground: '38bdf8' },
      ],
      colors: {
        'editor.background': 'var(--bg-panel)', // Matches --ui-panel
        'editor.foreground': 'var(--text)', // Matches --ui-text
        'editorLineNumber.foreground': 'var(--text-dim)',
        'editorLineNumber.activeForeground': 'var(--accent)',
        'editor.lineHighlightBackground': 'var(--bg-raised)', // Matches --ui-panel-strong
        'editor.selectionBackground': 'var(--border)',
        'editorCursor.foreground': 'var(--accent)',
      },
    });

    // 2. CoreX Twilight Light Theme
    monaco.editor.defineTheme('corex-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '94a3b8', fontStyle: 'italic' },
        { token: 'keyword', foreground: '1e90ff', fontStyle: 'bold' },
        { token: 'string', foreground: '059669' },
        { token: 'number', foreground: 'd97706' },
        { token: 'type', foreground: '0369a1' },
      ],
      colors: {
        'editor.background': 'var(--text)', // Matches --ui-panel
        'editor.foreground': 'var(--border)', // Matches --ui-text
        'editorLineNumber.foreground': 'var(--border)',
        'editorLineNumber.activeForeground': 'var(--accent)',
        'editor.lineHighlightBackground': 'var(--bg-raised)', // Matches --ui-panel-strong
        'editor.selectionBackground': 'var(--selection)',
        'editorCursor.foreground': 'var(--accent)',
      },
    });

    // 3. Godot Engine Dark Theme
    monaco.editor.defineTheme('godot-dark-editor', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '8e929e', fontStyle: 'italic' },
        { token: 'keyword', foreground: '478cbf', fontStyle: 'bold' },
        { token: 'string', foreground: '71b26e' },
        { token: 'number', foreground: 'e6a15c' },
        { token: 'type', foreground: '5fa5d5' },
      ],
      colors: {
        'editor.background': 'var(--bg-panel)', // Matches --ui-panel
        'editor.foreground': 'var(--text)', // Matches --ui-text
        'editorLineNumber.foreground': 'var(--text-dim)',
        'editorLineNumber.activeForeground': 'var(--accent)',
        'editor.lineHighlightBackground': 'var(--bg-raised)', // Matches --ui-panel-strong
        'editor.selectionBackground': 'var(--border-strong)',
        'editorCursor.foreground': 'var(--accent)',
      },
    });

    // 4. Godot Engine Light Theme
    monaco.editor.defineTheme('godot-light-editor', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
        { token: 'keyword', foreground: '33719e', fontStyle: 'bold' },
        { token: 'string', foreground: '3d8f35' },
        { token: 'number', foreground: 'd47715' },
        { token: 'type', foreground: '478cbf' },
      ],
      colors: {
        'editor.background': 'var(--bg-panel)', // Matches --ui-panel
        'editor.foreground': 'var(--text)', // Matches --ui-text
        'editorLineNumber.foreground': 'var(--border)',
        'editorLineNumber.activeForeground': 'var(--accent)',
        'editor.lineHighlightBackground': 'var(--bg-raised)', // Matches --ui-panel-strong
        'editor.selectionBackground': 'var(--border-strong)',
        'editorCursor.foreground': 'var(--accent)',
      },
    });

    // Types for trading strategy autocomplete
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });

    const typeDefinitions = `
      declare function buy(quantity: number): void;
      declare function sell(quantity: number): void;
      declare function log(message: string): void;
      declare function isLong(): boolean;
      declare function isShort(): boolean;
      declare function ema(bar: any, period: number): number;
      declare function rsi(bar: any, period: number): number;
      declare function macd(bar: any, fast: number, slow: number, signal: number): { macd: number, signal: number, hist: number };
      interface Bar {
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }
    `;

    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      typeDefinitions,
      'filename/baseStrategy.d.ts'
    );
  };

  // Convert settings theme to registered monaco theme name
  const getThemeName = () => {
    if (editorTheme === 'vs-light') return 'corex-light'; // Map to our custom beautiful light theme
    return editorTheme;
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0 relative select-none">
      <Editor
        height="100%"
        width="100%"
        language={language}
        value={code}
        onChange={onChange}
        onMount={handleEditorDidMount}
        theme={getThemeName()}
        loading={
          <div className="flex flex-col items-center justify-center text-xs text-[var(--ui-muted)] gap-2 h-full bg-[var(--ui-panel)]">
            <span className="w-5 h-5 border-2 border-[var(--ui-border)] border-t-[var(--ui-accent)]" />
            Loading Code Compiler...
          </div>
        }
        options={{
          fontSize: editorFontSize,
          fontFamily: 'var(--font-mono)',
          lineNumbers: editorLineNumbers ? 'on' : 'off',
          minimap: { enabled: editorMinimap },
          scrollbar: {
            vertical: 'visible',
            horizontal: 'visible',
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
          wordWrap: editorWordWrap ? 'on' : 'off',
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
          lineDecorationsWidth: 12,
          tabSize: editorTabSize,
          autoClosingBrackets: editorAutoClosingBrackets ? 'always' : 'never',
        }}
      />
    </div>
  );
}
