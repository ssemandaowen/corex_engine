import React, { useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { FileCode, Loader2, Zap } from 'lucide-react';
import baseStrategyDts from '../../monaco/BaseStrategy.d.ts?raw';

const EditorPanel = ({ id, code, setCode, onSave, loading }) => {
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
    monaco.editor.setTheme('corex-dark');

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
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#020617] font-sans border-l border-white/5">
      {/* Pro Header */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-white/5 bg-[#020617]">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <FileCode size={18} className="text-blue-500" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-100 tracking-tight">{id}.js</span>

            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
            <button
            onClick={onSave}
            disabled={loading}
            className="group flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white px-5 py-2 rounded-lg text-xs font-black transition-all shadow-xl shadow-blue-900/40 active:scale-95"
            >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} fill="currentColor" />}
            <span className="tracking-tighter">PUSH TO RUNTIME</span>
            </button>
        </div>
      </div>

      {/* Monaco Container */}
      <div className="flex-1 overflow-hidden relative">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          value={code}
          onChange={(val) => setCode(val || "")}
          onMount={handleMount}
          options={{
          fontSize: 13,
          lineHeight: 20,
          fontFamily: 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
            minimap: { enabled: false },
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
            wordWrap: 'on'
          }}
        />
        
        {/* Subtle Glass Overlay on bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#020617] to-transparent pointer-events-none" />
      </div>
    </div>
  );
};

export default EditorPanel;
