import React, { useState } from 'react';
import { 
  BookOpen, 
  Code, 
  Terminal, 
  Cpu, 
  ChevronRight, 
  Activity, 
  FileText 
} from 'lucide-react';

interface DocArticle {
  id: string;
  title: string;
  category: 'core' | 'methods' | 'indicators' | 'examples';
  content: React.ReactNode;
}

export default function DocsView() {
  const [activeDocId, setActiveDocId] = useState('getting-started');

  const docArticles: DocArticle[] = [
    {
      id: 'getting-started',
      title: 'GETTING STARTED',
      category: 'core',
      content: (
        <div className="space-y-4 font-sans text-xs text-[var(--ui-text)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wide text-white">1. INTRODUCTION TO COREX WORKSPACE</h2>
          <p>
            CoreX is an event-driven algorithmic trading execution sandbox. Strategies are declared using modern JavaScript or TypeScript syntax and execute inside lightweight, containerized v8 sandbox virtual threads.
          </p>
          <p>
            The runtime operates sequentially: it listens to a symbol price feed, matches tick patterns, calculates indicators, triggers entry/exit logs, and dispatches MT5 order tickets over high-speed bridges.
          </p>

          <h3 className="text-xs font-bold text-sky-400 mt-4">CORE CYCLE ARCHITECTURE</h3>
          <pre className="p-3 rounded bg-[var(--ui-terminal-bg)] border border-[var(--ui-border)] font-mono text-[10px] text-white overflow-x-auto leading-normal">
{`   [TICKS FEED CHANNELS]
             │
             ▼
   [onTick(tick) INTERRUPT] ──► [INDICATOR MATRICES]
             │
             ▼
   [onBar(candle) INTERRUPT] ──► [USER LOGIC DECISIONS]
                                        │
                                        ▼
                               [buy() / sell() ORDER]`}
          </pre>
        </div>
      )
    },
    {
      id: 'core-api-methods',
      title: 'CORE API PROCEDURES',
      category: 'methods',
      content: (
        <div className="space-y-4 font-sans text-xs text-[var(--ui-text)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wide text-white">2. TRADING EXECUTION FUNCTIONS</h2>
          <p>
            The strategy sandbox exposes standard global utility calls to facilitate lightning fast trades, telemetry routing, and state evaluations immediately:
          </p>

          <div className="space-y-3 pt-2">
            <div className="p-3 rounded border border-[var(--ui-border)] bg-[var(--ui-panel-soft)]">
              <span className="font-mono text-xs text-sky-400 font-bold">buy(quantity)</span>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">
                Dispatches a Market Buy order for the strategy symbol immediately. Returns void.
              </p>
            </div>

            <div className="p-3 rounded border border-[var(--ui-border)] bg-[var(--ui-panel-soft)]">
              <span className="font-mono text-xs text-sky-400 font-bold">sell(quantity)</span>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">
                Dispatches a Market Sell order (or closes long positions). Returns void.
              </p>
            </div>

            <div className="p-3 rounded border border-[var(--ui-border)] bg-[var(--ui-panel-soft)]">
              <span className="font-mono text-xs text-sky-400 font-bold">log(message)</span>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">
                Appends a custom log line to the Strategy Terminal. Output is color-coded automatically.
              </p>
            </div>

            <div className="p-3 rounded border border-[var(--ui-border)] bg-[var(--ui-panel-soft)]">
              <span className="font-mono text-xs text-sky-400 font-bold">isLong() / isShort()</span>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">
                Checks if the active container currently holds an active buy or sell margin.
              </p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'indicators-reference',
      title: 'INDICATOR ALGORITHMS',
      category: 'indicators',
      content: (
        <div className="space-y-4 font-sans text-xs text-[var(--ui-text)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wide text-white">3. MATHEMATICAL OVERLAYS</h2>
          <p>
            CoreX wraps optimized C++ indicator libraries, exposing them directly to the sandbox environment. These indicators are memory-efficient and recalculate dynamically with every candle close:
          </p>

          <div className="space-y-3 pt-2">
            <div className="p-3 rounded border border-[var(--ui-border)] bg-[var(--ui-panel-soft)]">
              <span className="font-mono text-xs text-emerald-400 font-bold">ema(bar, period)</span>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">
                Calculates Exponential Moving Average over a period. e.g. <code className="text-white">const ma = ema(bar, 20);</code>
              </p>
            </div>

            <div className="p-3 rounded border border-[var(--ui-border)] bg-[var(--ui-panel-soft)]">
              <span className="font-mono text-xs text-emerald-400 font-bold">rsi(bar, period)</span>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">
                Calculates Relative Strength Index oscillators. Returns value between 0 and 100.
              </p>
            </div>

            <div className="p-3 rounded border border-[var(--ui-border)] bg-[var(--ui-panel-soft)]">
              <span className="font-mono text-xs text-emerald-400 font-bold">macd(bar, fast, slow, signal)</span>
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">
                Calculates MACD indicators, returning a structured object: <code className="text-white">{`{ macd: number, signal: number, hist: number }`}</code>.
              </p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'rsi-scalper-example',
      title: 'RSI SCALPER SCRIPT',
      category: 'examples',
      content: (
        <div className="space-y-4 font-sans text-xs text-[var(--ui-text)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wide text-white">4. HEURISTIC RSI CROSSOVER</h2>
          <p>
            This strategy demonstrates buying EURUSD when RSI drops beneath 30 (oversold conditions) and closing/selling once it crosses above 70:
          </p>

          <pre className="p-3 rounded bg-[var(--ui-terminal-bg)] border border-[var(--ui-border)] font-mono text-[10px] text-emerald-400 overflow-x-auto leading-relaxed">
{`function onBar(bar) {
  // 1. Calculate RSI oscillator
  const value = rsi(bar, 14);
  log("RSI Index: " + value.toFixed(2));

  // 2. Buy on Oversold cross
  if (value < 30 && !isLong()) {
    log("CROSSUNDER 30 DETECTED. Executing BUY trade.");
    buy(1.0);
  }

  // 3. Sell on Overbought cross
  if (value > 70 && isLong()) {
    log("CROSSOVER 70 DETECTED. Squaring positions.");
    sell(1.0);
  }
}`}
          </pre>
        </div>
      )
    }
  ];

  const categories = [
    { id: 'core', label: 'Core Guides', icon: BookOpen },
    { id: 'methods', label: 'API SDK Reference', icon: Code },
    { id: 'indicators', label: 'Mathematical Indices', icon: Cpu },
    { id: 'examples', label: 'Strategy Examples', icon: FileText },
  ] as const;

  const activeDoc = docArticles.find(d => d.id === activeDocId) || docArticles[0];

  return (
    <div className="flex flex-col md:flex-row h-full w-full overflow-hidden select-none" style={{ backgroundColor: 'var(--ui-bg)' }}>
      {/* Left side category/articles nav bar */}
      <div 
        className="w-full md:w-[240px] border-b md:border-b-0 md:border-r shrink-0 flex flex-col md:h-full bg-[var(--ui-sidebar-bg)] overflow-hidden"
        style={{ borderColor: 'var(--ui-border)' }}
      >
        <div className="hidden md:flex p-3.5 border-b border-[var(--ui-border)] shrink-0 items-center gap-2">
          <BookOpen size={13} style={{ color: 'var(--ui-accent)' }} />
          <span className="text-[10px] uppercase font-black tracking-widest" style={{ color: 'var(--ui-muted)' }}>
            COREX DOCS MANUAL
          </span>
        </div>

        {/* Categories / Pages scrolling tree */}
        <div className="flex-1 p-2 flex flex-row md:flex-col gap-4 md:gap-0 md:space-y-4 overflow-x-auto md:overflow-x-visible md:overflow-y-auto scrollbar-none">
          {categories.map(cat => {
            const Icon = cat.icon;
            const articles = docArticles.filter(d => d.category === cat.id);

            return (
              <div key={cat.id} className="flex flex-row md:flex-col gap-1.5 md:gap-1.5 items-center md:items-stretch shrink-0">
                <div className="hidden md:flex items-center gap-1 px-1.5">
                  <Icon size={11} style={{ color: 'var(--ui-muted)' }} />
                  <span className="text-[9px] uppercase font-black tracking-widest" style={{ color: 'var(--ui-muted)' }}>
                    {cat.label}
                  </span>
                </div>

                <div className="flex flex-row md:flex-col gap-1 md:gap-0.5 md:pl-2 shrink-0">
                  {articles.map(art => {
                    const isActive = activeDocId === art.id;
                    return (
                      <button
                        key={art.id}
                        onClick={() => setActiveDocId(art.id)}
                        className={`py-1.5 px-3 md:py-1 md:px-2.5 rounded text-[11px] font-bold transition-all flex items-center justify-between cursor-pointer text-nowrap shrink-0 ${
                          isActive 
                            ? 'bg-[var(--ui-panel-soft)] text-white font-black border-l-0 md:border-l-2 border-b-2 md:border-b-0 border-[var(--ui-accent)]' 
                            : 'text-[var(--ui-muted)] hover:text-white border-b-2 border-transparent md:border-b-0'
                        }`}
                      >
                        <span className="truncate">{art.title}</span>
                        {isActive && <ChevronRight size={10} className="hidden md:inline ml-1.5 text-[var(--ui-accent)]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right side page display */}
      <div className="flex-1 p-4 md:p-6 overflow-y-auto max-w-4xl bg-[var(--ui-bg)]">
        <div 
          className="p-4 md:p-6 rounded-xl border space-y-4 bg-[var(--ui-panel)]"
          style={{ borderColor: 'var(--ui-border)' }}
        >
          {activeDoc.content}
        </div>
      </div>

    </div>
  );
}
