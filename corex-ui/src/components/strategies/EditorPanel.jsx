import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import baseStrategyDts from '../../monaco/BaseStrategy.d.ts?raw';
import strategyManifest from '../../monaco/strategyManifest.generated.json';
import editorDefaults from '../../config/editorDefaults.json';
import client from '../../api/client';
import { useStore } from '../../store/useStore';

const EditorPanel = ({ id, code, setCode }) => {
  const { editorPrefs, uiTheme } = useStore();
  const [docsManifest, setDocsManifest] = useState(strategyManifest);
  const [editorError, setEditorError] = useState(null);
  const docsDisposablesRef = useRef([]);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemPrefersDark(!!e.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    const previous = mql.onchange;
    mql.onchange = onChange;
    return () => {
      mql.onchange = previous || null;
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const loadManifest = async () => {
      try {
        const res = await client.get('/strategies/manifest');
        const payload = res?.payload;
        if (canceled) return;
        if (payload && Array.isArray(payload.methods) && Array.isArray(payload.indicators)) {
          setDocsManifest(payload);
        }
      } catch {
        // Keep bundled manifest fallback for offline/editor resilience.
      }
    };
    loadManifest();
    return () => {
      canceled = true;
    };
  }, []);

  const handleMount = useCallback((editor, monaco) => {
    setEditorError(null);
    
    // 1. Pro Theme Configuration
    monaco.editor.defineTheme('corex-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
        { token: 'keyword', foreground: '3b82f6', fontStyle: 'bold' },
        { token: 'string', foreground: '10b981' },
        { token: 'number', foreground: 'f59e0b' },
        { token: 'type.identifier', foreground: '22d3ee' },
        { token: 'type', foreground: '22d3ee' },
        { token: 'identifier', foreground: 'e2e8f0' },
        { token: 'delimiter', foreground: '94a3b8' },
        { token: 'delimiter.bracket', foreground: '94a3b8' },
        { token: 'operator', foreground: 'f472b6' },
        { token: 'constant', foreground: 'a78bfa' },
        { token: 'variable', foreground: 'e2e8f0' },
        { token: 'variable.predefined', foreground: 'a78bfa' },
        { token: 'variable.parameter', foreground: 'fbbf24' },
        { token: 'function', foreground: '38bdf8' },
        { token: 'function.declaration', foreground: '38bdf8', fontStyle: 'bold' },
        { token: 'class', foreground: 'f59e0b', fontStyle: 'bold' },
        { token: 'interface', foreground: 'f59e0b', fontStyle: 'bold' },
        { token: 'enum', foreground: 'f59e0b', fontStyle: 'bold' },
        { token: 'property', foreground: '93c5fd' },
        { token: 'attribute.name', foreground: '60a5fa' },
        { token: 'attribute.value', foreground: 'fbbf24' },
        { token: 'string.escape', foreground: 'fde68a' },
        { token: 'regexp', foreground: 'fb7185' },
        { token: 'tag', foreground: '60a5fa' },
        { token: 'annotation', foreground: 'c084fc' },
        { token: 'namespace', foreground: 'a78bfa' },
        { token: 'number.hex', foreground: 'f97316' },
        { token: 'number.float', foreground: 'f59e0b' },
        { token: 'keyword.operator', foreground: 'f472b6' },
        { token: 'keyword.control', foreground: '3b82f6', fontStyle: 'bold' },
        { token: 'keyword.flow', foreground: '3b82f6', fontStyle: 'bold' },
        { token: 'punctuation', foreground: '94a3b8' },
        { token: 'punctuation.bracket', foreground: '94a3b8' },
        { token: 'string.key.json', foreground: 'a3e635' },
        { token: 'string.value.json', foreground: 'fbbf24' },
        { token: 'regexp.escape', foreground: 'fde68a' },
        { token: 'comment.todo', foreground: 'f97316', fontStyle: 'bold' },
        { token: 'comment.todo.keyword', foreground: 'f97316', fontStyle: 'bold' },
        { token: 'comment.doc', foreground: '7dd3fc' },
      ],
      colors: {
        'editor.background': '#020617',
        'editor.lineHighlightBackground': '#1e293b50',
        'editorLineNumber.foreground': '#334155',
        'editorLineNumber.activeForeground': '#60a5fa',
        'editorWidget.background': '#0f172a',
        'editorSuggestWidget.background': '#0f172a',
        'editorSuggestWidget.border': '#1e293b',
        'editor.selectionBackground': '#1e40af55',
        'editor.inactiveSelectionBackground': '#1e293b66',
        'editorCursor.foreground': '#93c5fd',
        'editorBracketMatch.background': '#1f293740',
        'editorBracketMatch.border': '#60a5fa',
        'editor.findMatchBackground': '#7c3aed55',
        'editor.findMatchHighlightBackground': '#7c3aed33',
        'editor.wordHighlightBackground': '#0ea5e933',
        'editor.wordHighlightStrongBackground': '#38bdf833',
        'editorWhitespace.foreground': '#1e293b',
        'editorIndentGuide.background': '#1e293b',
        'editorIndentGuide.activeBackground': '#334155',
        'editorRuler.foreground': '#1f2937'
      }
    });
    monaco.editor.defineTheme('corex-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
        { token: 'keyword', foreground: '1d4ed8', fontStyle: 'bold' },
        { token: 'string', foreground: '047857' },
        { token: 'number', foreground: 'b45309' },
        { token: 'identifier', foreground: '0f172a' },
        { token: 'operator', foreground: 'be185d' },
        { token: 'function', foreground: '0369a1' },
        { token: 'class', foreground: 'c2410c', fontStyle: 'bold' }
      ],
      colors: {
        'editor.background': '#f8fafc',
        'editor.lineHighlightBackground': '#e2e8f080',
        'editorLineNumber.foreground': '#94a3b8',
        'editorLineNumber.activeForeground': '#1d4ed8',
        'editorWidget.background': '#ffffff',
        'editorSuggestWidget.background': '#ffffff',
        'editorSuggestWidget.border': '#cbd5e1',
        'editor.selectionBackground': '#bfdbfe',
        'editor.inactiveSelectionBackground': '#dbeafe80',
        'editorCursor.foreground': '#1e3a8a',
        'editorBracketMatch.background': '#cbd5e180',
        'editorBracketMatch.border': '#2563eb',
        'editorWhitespace.foreground': '#cbd5e1',
        'editorIndentGuide.background': '#e2e8f0',
        'editorIndentGuide.activeBackground': '#94a3b8',
        'editorRuler.foreground': '#e2e8f0'
      }
    });

    // 2. Strict Compiler Options for Strategy Development
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      allowNonTsExtensions: true,
      checkJs: false,
      allowJs: true,
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    });

    // 3. Inject BaseStrategy Typings
    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      baseStrategyDts,
      'file:///@utils/BaseStrategy.d.ts'
    );

    // 4. Force Validation (Makes red squiggles appear immediately)
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });

    const previous = Array.isArray(docsDisposablesRef.current)
      ? docsDisposablesRef.current
      : [];
    previous.forEach((d) => {
      try { d.dispose(); } catch { /* ignore */ }
    });

    const methodDocs = Array.isArray(docsManifest?.methods) ? docsManifest.methods : [];
    const indicatorDocs = Array.isArray(docsManifest?.indicators) ? docsManifest.indicators : [];
    const documentationItems = [...methodDocs, ...indicatorDocs];
    const docLookup = new Map(documentationItems.map((item) => [item.label, item]));

    const hoverDisposable = monaco.languages.registerHoverProvider('javascript', {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const match = docLookup.get(word.word);
        if (!match) return null;
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [
            { value: `**${match.label}**` },
            { value: match.detail || '' },
            { value: match.signature || '' },
            { value: match.documentation || '' }
          ]
        };
      }
    });

    const completionDisposable = monaco.languages.registerCompletionItemProvider('javascript', {
      triggerCharacters: ['.'],
      provideCompletionItems: () => {
        const methodSuggestions = methodDocs.map((doc) => ({
          label: doc.label,
          kind: monaco.languages.CompletionItemKind.Method,
          detail: doc.detail,
          documentation: doc.signature
            ? `${doc.signature}\n${doc.documentation || ''}`
            : (doc.documentation || ''),
          insertText: doc.insertText || doc.label,
        }));
        const indicatorSuggestions = indicatorDocs.map((doc) => ({
          label: doc.label,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: doc.detail,
          documentation: doc.signature
            ? `${doc.signature}\n${doc.documentation || ''}`
            : (doc.documentation || ''),
          insertText: doc.insertText || doc.label,
        }));
        return { suggestions: [...methodSuggestions, ...indicatorSuggestions] };
      }
    });

    docsDisposablesRef.current = [hoverDisposable, completionDisposable];
  }, [docsManifest]);

  useEffect(() => {
    return () => {
      const disposables = Array.isArray(docsDisposablesRef.current) ? docsDisposablesRef.current : [];
      disposables.forEach((d) => {
        try { d.dispose(); } catch { /* ignore */ }
      });
      docsDisposablesRef.current = [];
    };
  }, []);

  // Handle Monaco loading error gracefully
  const handleEditorError = useCallback((error) => {
    console.error('Monaco Editor failed to load:', error);
    setEditorError(error);
  }, []);

  const resolvedUiTheme = uiTheme === 'system'
    ? (systemPrefersDark ? 'dark' : 'light')
    : uiTheme;
  const editorThemePref = String(editorPrefs?.theme || editorDefaults.theme || 'auto').toLowerCase();
  const resolvedTheme = (editorThemePref === 'auto' || !editorThemePref)
    ? (resolvedUiTheme === 'light' ? 'corex-light' : 'corex-dark')
    : editorThemePref;

  return (
    <div className="flex flex-col h-full bg-[var(--ui-panel)] font-sans border-l border-[var(--ui-border)]">

      {/* Monaco Container */}
      <div className="flex-1 overflow-hidden relative">
        {editorError ? (
          <div className="flex flex-col items-center justify-center h-full bg-[var(--ui-panel)] p-8 text-center">
            <div className="text-red-400 text-lg mb-2">Failed to load editor</div>
            <div className="text-slate-400 text-sm mb-4">
              {editorError.message || 'Please check your internet connection and refresh'}
            </div>
            <button
              onClick={() => {
                setEditorError(null);
                window.location.reload();
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <Editor
              key={`strategy-editor-${docsManifest?.generatedAt || 'local'}`}
              path={`file:///strategies/${id || 'untitled'}.js`}
              height="100%"
              defaultLanguage="javascript"
              theme={resolvedTheme}
              value={code}
              onChange={(val) => setCode(val || "")}
              onMount={handleMount}
              onError={handleEditorError}
              loading={
                <div className="flex items-center justify-center h-full text-slate-400">
                  <span className="text-sm">Loading editor...</span>
                </div>
              }
              options={{
              fontSize: Number(editorPrefs?.fontSize || editorDefaults.fontSize || 13),
              lineHeight: Number(editorPrefs?.lineHeight || editorDefaults.lineHeight || 20),
              fontFamily: editorPrefs?.fontFamily || editorDefaults.fontFamily,
                minimap: { enabled: editorPrefs?.minimap === true || editorDefaults.minimap === true },
                padding: { top: 24, bottom: 24 },
                smoothScrolling: true,
                cursorBlinking: 'expand',
                cursorSmoothCaretAnimation: 'on',
                contextmenu: true,
                scrollbar: {
                  vertical: 'visible',
                  horizontal: 'visible',
                  verticalSliderSize: 4,
                  horizontalSliderSize: 4,
                  useShadows: false
                },
                renderLineHighlight: 'all',
                lineNumbersMinChars: 5,
                folding: true,
                bracketPairColorization: { enabled: true },
                wordWrap: String(editorPrefs?.wordWrap || editorDefaults.wordWrap || 'on') === 'off' ? 'off' : 'on',
                automaticLayout: true
              }}
            />
            
            {/* Subtle Glass Overlay on bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--ui-panel)] to-transparent pointer-events-none" />
          </>
        )}
      </div>
    </div>
  );
};

export default EditorPanel;
