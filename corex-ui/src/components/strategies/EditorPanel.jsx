import React, { useCallback } from 'react';
import Editor from '@monaco-editor/react';
import baseStrategyDts from '../../monaco/BaseStrategy.d.ts?raw';
import { useStore } from '../../store/useStore';

const EditorPanel = ({ id, code, setCode, onSave, loading }) => {
  const { editorPrefs, uiTheme } = useStore();
  const handleMount = useCallback((editor, monaco) => {
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
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });

    if (!monaco.__corexStrategyDocs) {
      monaco.__corexStrategyDocs = true;
      const methodDocs = [
        {
          label: 'resolveSymbol',
          detail: 'Resolve active symbol',
          documentation: 'Resolves symbol from explicit input, packet, or strategy defaults.'
        },
        {
          label: 'hasBars',
          detail: 'Check history depth',
          documentation: 'Returns true if at least N bars are available for a symbol.'
        },
        {
          label: 'requireBars',
          detail: 'Guard for bar count',
          documentation: 'Returns false and logs a guard if insufficient bars are available.'
        },
        {
          label: 'safeSeries',
          detail: 'Safe series access',
          documentation: 'Returns a series without throwing if missing; use for defensive access.'
        },
        {
          label: 'oncePerBar',
          detail: 'One-shot bar gate',
          documentation: 'Returns true once per bar/key to avoid duplicate actions.'
        },
        {
          label: 'safeRule',
          detail: 'Protect logic block',
          documentation: 'Executes a block and returns fallback if it throws.'
        },
        {
          label: 'describe',
          detail: 'Strategy metadata',
          documentation: 'Returns lightweight metadata for UI/telemetry.'
        },
        {
          label: 'logDecision',
          detail: 'Decision log',
          documentation: 'Structured decision log with optional metadata.'
        },
        {
          label: 'logSignal',
          detail: 'Signal log',
          documentation: 'Structured signal log with stage and metadata.'
        },
        {
          label: 'logGuard',
          detail: 'Guard log',
          documentation: 'Structured guard pass/fail log.'
        },
        {
          label: 'entryLong',
          detail: 'Emit long entry',
          documentation: 'Creates a normalized long entry signal.'
        },
        {
          label: 'entryShort',
          detail: 'Emit short entry',
          documentation: 'Creates a normalized short entry signal.'
        },
        {
          label: 'exitLong',
          detail: 'Exit long',
          documentation: 'Creates a normalized long exit signal.'
        },
        {
          label: 'exitShort',
          detail: 'Exit short',
          documentation: 'Creates a normalized short exit signal.'
        },
        {
          label: 'exitAll',
          detail: 'Exit all',
          documentation: 'Closes any active exposure regardless of side.'
        },
        {
          label: 'flipToLong',
          detail: 'Flip short to long',
          documentation: 'Closes short and enters long on next bar.'
        },
        {
          label: 'flipToShort',
          detail: 'Flip long to short',
          documentation: 'Closes long and enters short on next bar.'
        },
        {
          label: 'rule',
          detail: 'RuleChain builder',
          documentation: 'Fluent rule chain for guarded signal emission.'
        },
        {
          label: 'series',
          detail: 'Series accessor',
          documentation: 'Returns a numeric series for a symbol/field.'
        },
        {
          label: 'pos',
          detail: 'Position state check',
          documentation: 'Returns true if current position state matches.'
        }
      ];

      monaco.languages.registerHoverProvider('javascript', {
        provideHover: (model, position) => {
          const word = model.getWordAtPosition(position);
          if (!word) return null;
          const match = methodDocs.find((d) => d.label === word.word);
          if (!match) return null;
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [
              { value: `**${match.label}**` },
              { value: match.detail },
              { value: match.documentation }
            ]
          };
        }
      });

      monaco.languages.registerCompletionItemProvider('javascript', {
        triggerCharacters: ['.'],
        provideCompletionItems: () => {
          const suggestions = methodDocs.map((doc) => ({
            label: doc.label,
            kind: monaco.languages.CompletionItemKind.Method,
            detail: doc.detail,
            documentation: doc.documentation,
            insertText: doc.label,
          }));
          return { suggestions };
        }
      });
    }
  }, []);

  const resolvedTheme = editorPrefs?.theme
    || (uiTheme === 'light' ? 'corex-light' : 'corex-dark');

  return (
    <div className="flex flex-col h-full bg-[var(--ui-panel)] font-sans border-l border-[var(--ui-border)]">

      {/* Monaco Container */}
      <div className="flex-1 overflow-hidden relative">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          theme={resolvedTheme}
          value={code}
          onChange={(val) => setCode(val || "")}
          onMount={handleMount}
          options={{
          fontSize: Number(editorPrefs?.fontSize || 13),
          lineHeight: Number(editorPrefs?.lineHeight || 20),
          fontFamily: editorPrefs?.fontFamily || 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
            minimap: { enabled: editorPrefs?.minimap === true },
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
            wordWrap: editorPrefs?.wordWrap === 'off' ? 'off' : 'on'
          }}
        />
        
        {/* Subtle Glass Overlay on bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--ui-panel)] to-transparent pointer-events-none" />
      </div>
    </div>
  );
};

export default EditorPanel;
