import React from 'react';
import Editor from '@monaco-editor/react';

const EditorPanel = ({ id, code, setCode, onSave }) => {
  return (
    <div className="flex flex-col h-full bg-[#020617]">
      <div className="h-12 flex items-center justify-between px-4 border-b border-slate-800 bg-slate-900/20">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-blue-500"></span>
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">{id}.js</span>
        </div>
        <button
          onClick={onSave}
          className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-[10px] font-bold transition-all shadow-lg shadow-blue-900/20"
        >
          SAVE & REFRESH
        </button>
      </div>
      <div className="flex-1 pt-2">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          theme="vs-dark"
          value={code}
          onChange={(value) => setCode(value)}
          options={{
            fontSize: 13,
            minimap: { enabled: false },
            padding: { top: 10 },
            scrollBeyondLastLine: false,
            lineNumbersMinChars: 3,
            backgroundColor: '#020617'
          }}
        />
      </div>
    </div>
  );
};

export default EditorPanel;