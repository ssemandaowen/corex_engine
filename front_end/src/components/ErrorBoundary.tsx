import * as React from 'react';
import { ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCw, ChevronRight } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });
    console.error('Uncaught error inside CoreX Engine View:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 min-h-[400px] flex items-center justify-center p-6 bg-[var(--ui-bg)] text-white font-sans select-none">
          <div className="w-full max-w-xl p-6 rounded-xl border border-red-500/20 bg-[#0a0f1d] shadow-2xl relative overflow-hidden">
            {/* Header decor */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-red-500/40" />
            
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/20 text-red-400 shrink-0">
                <AlertOctagon size={24} />
              </div>
              
              <div className="space-y-4 flex-1 min-w-0">
                <div>
                  <h3 className="text-sm font-display font-black uppercase tracking-wider text-red-400">
                    CORE_ENGINE_PANEL_CRASH
                  </h3>
                  <p className="text-xs text-[var(--ui-muted)] uppercase tracking-wider mt-1 font-semibold leading-none">
                    Uncaught execution error in active view layout
                  </p>
                </div>

                {/* Simulated Stack/Log Trace */}
                <div className="p-3.5 bg-black/40 rounded border border-[var(--ui-border)]/50 font-mono text-[11px] leading-relaxed text-red-300 max-h-[160px] overflow-y-auto space-y-1.5 select-text">
                  <div className="text-[var(--ui-muted)] text-[10px] pb-1 border-b border-[var(--ui-border)]/20 mb-1.5 flex justify-between">
                    <span>SYSTEM RUNTIME DIAGNOSTIC</span>
                    <span>LEVEL: CRITICAL</span>
                  </div>
                  <p className="font-bold">{this.state.error?.toString() || 'Unknown Runtime Exception'}</p>
                  {this.state.errorInfo && (
                    <pre className="text-[10px] text-[var(--ui-muted)] whitespace-pre-wrap font-mono leading-tight">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={this.handleReset}
                    className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-all cursor-pointer flex items-center gap-2 active:scale-95"
                  >
                    <RefreshCw size={12} />
                    <span>Restart Layout Engine</span>
                  </button>
                  <button
                    onClick={() => {
                      // Silently reset state to let the user try returning to another view
                      this.setState({ hasError: false, error: null, errorInfo: null });
                      // Force local storage home tab setting as a recovery route
                      localStorage.setItem('active_tab', 'home');
                      window.location.reload();
                    }}
                    className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider bg-[var(--ui-panel-soft)] hover:bg-[var(--ui-panel-soft)]/80 text-white border border-[var(--ui-border)] transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                  >
                    <span>Force Return to Home</span>
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
