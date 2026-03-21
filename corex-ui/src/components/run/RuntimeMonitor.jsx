import React, { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CandlestickSeries, LineSeries, createSeriesMarkers } from "lightweight-charts";
import client from "../../api/client";
import useStore from "../../store/useStore";
import { Maximize2, RotateCcw, Settings2, WifiOff, X } from "lucide-react";

const RuntimeMonitor = () => {
  const { strategiesLive, wsStatus, connectWebSocket, realtimeMode, uiTheme, activeAccountMode, liveCandles } = useStore();
  const [strategyId, setStrategyId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [telemetry, setTelemetry] = useState(null);
  const [historyReport, setHistoryReport] = useState(null);
  const [error, setError] = useState("");
  const [chartWindowBars, setChartWindowBars] = useState(320);
  const [chartOffset, setChartOffset] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshSeconds, setRefreshSeconds] = useState(4);
  const [hoverPoint, setHoverPoint] = useState(null);
  const chartRef = useRef(null);
  const chartApiRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const closeSeriesRef = useRef(null);
  const markerApiRef = useRef(null);

  const strategyOptions = useMemo(() => {
    return (Array.isArray(strategiesLive) ? strategiesLive : []).filter((s) => s?.id && s?.status === "ACTIVE");
  }, [strategiesLive]);

  const selectedStrategy = useMemo(
    () => strategyOptions.find((s) => s.id === strategyId) || null,
    [strategyOptions, strategyId]
  );

  const symbolOptions = useMemo(() => {
    const out = [];
    const seen = new Set();
    const push = (value) => {
      const v = String(value || "").trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      out.push(v);
    };
    (telemetry?.dataSymbols || []).forEach(push);
    (telemetry?.symbols || []).forEach(push);
    (selectedStrategy?.symbols || []).forEach(push);
    Object.keys(liveCandles || {}).forEach(push);
    return out;
  }, [telemetry, selectedStrategy, liveCandles]);

  const effectiveSymbol = useMemo(() => {
    if (symbol && symbolOptions.includes(symbol)) return symbol;
    return symbolOptions[0] || "";
  }, [symbol, symbolOptions]);

  useEffect(() => {
    if (!strategyId && strategyOptions.length > 0) {
      setStrategyId(strategyOptions[0].id);
    }
    if (strategyId && strategyOptions.length > 0 && !strategyOptions.some((s) => s.id === strategyId)) {
      setStrategyId(strategyOptions[0].id);
      setSymbol("");
    }
  }, [strategyOptions, strategyId]);

  useEffect(() => {
    if (realtimeMode === "ws") connectWebSocket();
  }, [realtimeMode, connectWebSocket]);

  const fetchTelemetry = async (sid, sym, bars = 1200) => {
    if (!sid) return;
    try {
      const q = sym ? `?symbol=${encodeURIComponent(sym)}&bars=${bars}` : `?bars=${bars}`;
      const res = await client.get(`/run/telemetry/${sid}${q}`);
      const payload = res?.payload || null;
      setTelemetry(payload);
      if (!symbol && payload?.symbol) setSymbol(payload.symbol);
      setError("");
    } catch {
      setError("Unable to load strategy telemetry");
    }
  };

  const fetchHistory = async (sid, sym) => {
    if (!sid) return;
    try {
      const params = new URLSearchParams();
      params.set("environment", String(activeAccountMode || "paper").toUpperCase());
      params.set("strategyId", sid);
      if (sym) params.set("symbol", sym);
      params.set("limit", "1000");
      const res = await client.get(`/run/history?${params.toString()}`);
      const payload = res?.payload || null;
      setHistoryReport(payload);
    } catch {
      setHistoryReport(null);
    }
  };

  useEffect(() => {
    const bars = Math.max(300, Number(selectedStrategy?.lookback || 600));
    fetchTelemetry(strategyId, effectiveSymbol, bars);
    fetchHistory(strategyId, effectiveSymbol);
    const t = setInterval(() => {
      fetchTelemetry(strategyId, effectiveSymbol, bars);
      fetchHistory(strategyId, effectiveSymbol);
    }, Math.max(2, Number(refreshSeconds || 4)) * 1000);
    return () => clearInterval(t);
  }, [strategyId, effectiveSymbol, selectedStrategy, refreshSeconds, activeAccountMode]);

  useEffect(() => {
    if (!chartRef.current) return;
    const styles = typeof window !== "undefined" ? window.getComputedStyle(document.documentElement) : null;
    const panelBg = styles?.getPropertyValue("--ui-panel").trim() || "#0b1220";
    const textColor = styles?.getPropertyValue("--ui-muted").trim() || "#9ca3af";
    const borderColor = styles?.getPropertyValue("--ui-border").trim() || "#1f2937";
    const positiveColor = styles?.getPropertyValue("--ui-positive").trim() || "#10b981";
    const negativeColor = styles?.getPropertyValue("--ui-negative").trim() || "#f43f5e";
    const accentColor = styles?.getPropertyValue("--ui-accent").trim() || "#60a5fa";
    const chart = createChart(chartRef.current, {
      layout: {
        background: { color: panelBg },
        textColor
      },
      rightPriceScale: {
        borderVisible: false
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false
      },
      grid: {
        vertLines: { color: borderColor },
        horzLines: { color: borderColor }
      }
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: positiveColor,
      downColor: negativeColor,
      borderVisible: false,
      wickUpColor: positiveColor,
      wickDownColor: negativeColor
    });
    const closeLine = chart.addSeries(LineSeries, {
      color: accentColor,
      lineWidth: 1,
      priceLineVisible: false
    });
    const markers = createSeriesMarkers(candles, []);
    chartApiRef.current = chart;
    candleSeriesRef.current = candles;
    closeSeriesRef.current = closeLine;
    markerApiRef.current = markers;
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        setHoverPoint(null);
        return;
      }
      const c = param.seriesData?.get?.(candles);
      if (!c) {
        setHoverPoint(null);
        return;
      }
      setHoverPoint({
        time: typeof param.time === "number" ? param.time * 1000 : null,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close)
      });
    });
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      chart.applyOptions({ width: Math.max(320, rect.width), height: Math.max(240, rect.height) });
    });
    ro.observe(chartRef.current);
    return () => {
      ro.disconnect();
      try {
        markerApiRef.current?.detach?.();
      } catch {
        // ignore marker detach errors
      }
      chart.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      closeSeriesRef.current = null;
      markerApiRef.current = null;
    };
  }, [uiTheme]);

  const tradeMarkers = useMemo(() => {
    const trades = Array.isArray(historyReport?.trades) ? historyReport.trades : [];
    if (trades.length === 0) return [];
    const markers = [];
    for (let i = 0; i < trades.length; i += 1) {
      const t = trades[i] || {};
      const entryTs = Number(t.entryTime || 0);
      const exitTs = Number(t.exitTime || 0);
      const direction = String(t.direction || "").toLowerCase();
      const pnl = Number(t.profit || 0);
      const entrySec = Number.isFinite(entryTs) && entryTs > 0 ? Math.floor(entryTs / 1000) : null;
      const exitSec = Number.isFinite(exitTs) && exitTs > 0 ? Math.floor(exitTs / 1000) : null;

      if (entrySec) {
        markers.push({
          id: `entry_${i}`,
          time: entrySec,
          position: direction === "short" ? "aboveBar" : "belowBar",
          color: direction === "short" ? "#f59e0b" : "#10b981",
          shape: direction === "short" ? "arrowDown" : "arrowUp",
          text: `E ${Number(t.quantity || 0).toFixed(2)}`
        });
      }
      if (exitSec) {
        markers.push({
          id: `exit_${i}`,
          time: exitSec,
          position: direction === "short" ? "belowBar" : "aboveBar",
          color: pnl >= 0 ? "#22c55e" : "#ef4444",
          shape: pnl >= 0 ? "circle" : "square",
          text: `X ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`
        });
      }
    }

    return markers.sort((a, b) => Number(a.time || 0) - Number(b.time || 0));
  }, [historyReport]);

  const perfSummary = useMemo(() => {
    const perf = historyReport?.performance || {};
    return {
      netProfit: Number(perf.netProfit || 0),
      winRate: Number(perf.winRate || 0),
      totalTrades: Number(perf.totalTrades || 0),
      maxDrawdown: Number(perf.maxDrawdownPercent || 0),
      profitFactor: Number(perf.profitFactor || 0)
    };
  }, [historyReport]);

  const wsCandles = useMemo(() => {
    if (!effectiveSymbol) return [];
    const series = Array.isArray(liveCandles?.[effectiveSymbol]) ? liveCandles[effectiveSymbol] : [];
    const normalized = series
      .map((c) => ({
        time: Math.floor(Number(c?.time || 0) / 1000),
        open: Number(c?.open),
        high: Number(c?.high),
        low: Number(c?.low),
        close: Number(c?.close)
      }))
      .filter((c) => Number.isFinite(c.time) && [c.open, c.high, c.low, c.close].every(Number.isFinite))
      .sort((a, b) => a.time - b.time);
    const out = [];
    for (const c of normalized) {
      if (!out.length || out[out.length - 1].time !== c.time) out.push(c);
      else out[out.length - 1] = c;
    }
    return out.slice(-1200);
  }, [liveCandles, effectiveSymbol]);

  const mergedCandles = useMemo(() => {
    const telemetryBase = Array.isArray(telemetry?.candles) ? telemetry.candles : [];
    const source = telemetryBase.length > 0 ? telemetryBase : wsCandles;
    const merged = [...source]
      .filter((c) => c && Number.isFinite(Number(c.time)))
      .map((c) => ({
        time: Math.floor(Number(c.time) / 1000),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close)
      }))
      .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
      .sort((a, b) => a.time - b.time);
    const out = [];
    for (const c of merged) {
      if (!out.length || out[out.length - 1].time !== c.time) out.push(c);
      else out[out.length - 1] = c;
    }
    return out.slice(-1200);
  }, [telemetry, wsCandles]);

  useEffect(() => {
    if (!candleSeriesRef.current || !closeSeriesRef.current) return;
    const available = mergedCandles.length;
    const windowBars = Math.max(60, Number(chartWindowBars || 240));
    const maxOffset = Math.max(0, available - windowBars);
    const boundedOffset = Math.min(maxOffset, Math.max(0, Number(chartOffset || 0)));
    const end = available - boundedOffset;
    const start = Math.max(0, end - windowBars);
    const windowed = mergedCandles.slice(start, end);
    candleSeriesRef.current.setData(windowed);
    closeSeriesRef.current.setData(windowed.map((c) => ({ time: c.time, value: c.close })));
  }, [mergedCandles, chartWindowBars, chartOffset]);

  useEffect(() => {
    if (!markerApiRef.current) return;
    markerApiRef.current.setMarkers(tradeMarkers);
  }, [tradeMarkers]);

  useEffect(() => {
    chartApiRef.current?.timeScale()?.fitContent?.();
  }, [strategyId, effectiveSymbol]);

  const availableBars = mergedCandles.length;
  const maxWindow = Math.max(120, availableBars || 120);
  const maxOffset = Math.max(0, availableBars - chartWindowBars);

  if (strategyOptions.length === 0) {
    return (
      <div className="h-full overflow-hidden bg-transparent">
        <div className="h-full border border-[var(--ui-border)] rounded-xl bg-[var(--ui-panel)] p-6 flex items-center justify-center">
          <div className="max-w-xl text-center space-y-2">
            <div className="text-[11px] text-[var(--ui-muted)] font-bold uppercase tracking-[0.18em]">
              Runtime Monitor
            </div>
            <div className="text-sm text-[var(--ui-text)] font-semibold">
              No active strategy to track right now.
            </div>
            <div className="text-xs text-[var(--ui-muted)]">
              Start at least one strategy from the Simulation tab to begin live market tracking.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden bg-transparent">
      <div className="h-full border border-[var(--ui-border)] rounded-xl bg-[var(--ui-panel-soft)] p-3 md:p-4 space-y-3 overflow-hidden relative">
        <div className="flex items-center justify-between gap-3 border border-[var(--ui-border)] rounded-lg p-2 bg-[var(--ui-panel)]">
          <div>
            <div className="text-[10px] text-[var(--ui-muted)] font-bold uppercase tracking-widest">
              Strategy Runtime Monitor
            </div>
            <div className="text-[10px] text-[var(--ui-subtle)] font-mono">
              {strategyId || "--"} | {effectiveSymbol || "--"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="px-2 py-1 rounded border border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-text)] text-xs"
              value={strategyId}
              onChange={(e) => {
                setStrategyId(e.target.value);
                setSymbol("");
              }}
            >
              {strategyOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.id}</option>
              ))}
            </select>
            <select
              className="px-2 py-1 rounded border border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-text)] text-xs"
              value={effectiveSymbol}
              onChange={(e) => setSymbol(e.target.value)}
            >
              {symbolOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              type="button"
              className="ui-button ui-button-secondary !px-3 !py-2"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X size={12} /> : <Settings2 size={12} />}
              Inspect
            </button>
          </div>
        </div>

        {error && <div className="text-xs text-[var(--ui-negative)]">{error}</div>}
        {!error && strategyOptions.length > 0 && availableBars === 0 && (
          <div className="text-xs text-[var(--ui-warning)] border border-[var(--ui-border)] rounded p-3 bg-[var(--ui-panel)]">
            <WifiOff size={12} className="inline mr-1" />
            No market feed yet for this strategy/symbol. Waiting for candles...
          </div>
        )}
        {!error && strategyOptions.length > 0 && Number(perfSummary.totalTrades || 0) === 0 && (
          <div className="text-xs text-[var(--ui-muted)] border border-[var(--ui-border)] rounded p-3 bg-[var(--ui-panel)]">
            No trade history for this strategy in {String(activeAccountMode || "paper").toUpperCase()} mode.
          </div>
        )}
        <div className="relative h-[calc(100%-118px)] min-h-[460px] rounded border border-[var(--ui-border)] overflow-hidden" ref={chartRef}>
          {hoverPoint && (
            <div className="absolute left-3 top-3 z-10 rounded border border-[var(--ui-border)] bg-[var(--ui-panel)] px-3 py-2 text-[10px] font-mono text-[var(--ui-text)] shadow-lg">
              <div className="text-[var(--ui-muted)] mb-1">{hoverPoint.time ? new Date(hoverPoint.time).toLocaleString() : "--"}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-[var(--ui-muted)]">O</span><span>{Number.isFinite(hoverPoint.open) ? hoverPoint.open.toFixed(5) : "--"}</span>
                <span className="text-[var(--ui-muted)]">H</span><span>{Number.isFinite(hoverPoint.high) ? hoverPoint.high.toFixed(5) : "--"}</span>
                <span className="text-[var(--ui-muted)]">L</span><span>{Number.isFinite(hoverPoint.low) ? hoverPoint.low.toFixed(5) : "--"}</span>
                <span className="text-[var(--ui-muted)]">C</span><span>{Number.isFinite(hoverPoint.close) ? hoverPoint.close.toFixed(5) : "--"}</span>
              </div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <MetricPill label="WS" value={wsStatus} />
          <MetricPill label="Candles" value={mergedCandles.length} />
          <MetricPill label="Trades" value={perfSummary.totalTrades} />
          <MetricPill label="Net PnL" value={perfSummary.netProfit.toFixed(2)} tone={perfSummary.netProfit >= 0 ? "ok" : "danger"} />
          <MetricPill label="Win Rate" value={`${perfSummary.winRate.toFixed(1)}%`} tone={perfSummary.winRate >= 50 ? "ok" : "warn"} />
          <MetricPill label="Max DD" value={`${perfSummary.maxDrawdown.toFixed(2)}%`} tone={perfSummary.maxDrawdown >= -5 ? "ok" : "danger"} />
        </div>

        <aside
          className={`absolute top-0 right-0 h-full w-[340px] border-l border-[var(--ui-border)] bg-[var(--ui-panel)] shadow-xl transition-transform duration-300 z-20 ${menuOpen ? "translate-x-0" : "translate-x-full"}`}
        >
          <div className="p-3 border-b border-[var(--ui-border)] flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-[var(--ui-muted)] font-bold">Chart Inspector</div>
            <button type="button" className="ui-button ui-button-secondary !px-3 !py-1" onClick={() => setMenuOpen(false)}>
              <X size={12} />
              Close
            </button>
          </div>
          <div className="p-3 space-y-3 overflow-y-auto h-[calc(100%-56px)]">
            <div className="ui-card">
              <div className="ui-panel-title mb-2">History</div>
              <label className="ui-field">
                <span className="ui-label">Visible Bars</span>
                <input
                  type="number"
                  min={60}
                  max={Math.max(1200, maxWindow)}
                  value={chartWindowBars}
                  onChange={(e) => setChartWindowBars(Math.max(60, Number(e.target.value || 320)))}
                  className="ui-input"
                />
              </label>
              <label className="ui-field mt-2">
                <span className="ui-label">Right Offset Bars</span>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, maxOffset)}
                  value={Math.min(chartOffset, maxOffset)}
                  onChange={(e) => setChartOffset(Math.max(0, Number(e.target.value || 0)))}
                  className="ui-input"
                />
              </label>
              <div className="flex gap-2 mt-2">
                <button type="button" className="ui-button ui-button-secondary" onClick={() => { setChartOffset(0); setChartWindowBars(Math.min(maxWindow, 320)); }}>
                  <RotateCcw size={12} />
                  Reset
                </button>
                <button type="button" className="ui-button ui-button-secondary" onClick={() => { setChartOffset(0); setChartWindowBars(maxWindow); }}>
                  <Maximize2 size={12} />
                  Fit
                </button>
              </div>
            </div>

            <div className="ui-card">
              <div className="ui-panel-title mb-2">Feed + Strategy</div>
              <label className="ui-field">
                <span className="ui-label">Refresh (sec)</span>
                <input
                  type="number"
                  min={2}
                  max={30}
                  value={refreshSeconds}
                  onChange={(e) => setRefreshSeconds(Math.max(2, Number(e.target.value || 4)))}
                  className="ui-input"
                />
              </label>
              <label className="ui-field mt-2">
                <span className="ui-label">Strategy</span>
                <select className="ui-select" value={strategyId} onChange={(e) => { setStrategyId(e.target.value); setSymbol(""); }}>
                  {strategyOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.id}</option>
                  ))}
                </select>
              </label>
              <label className="ui-field mt-2">
                <span className="ui-label">Symbol</span>
                <select className="ui-select" value={effectiveSymbol} onChange={(e) => setSymbol(e.target.value)}>
                  {symbolOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="ui-card">
              <div className="ui-panel-title mb-2">Inspection</div>
              <div className="text-[11px] text-[var(--ui-muted)] space-y-1">
                <div>Status: <span className="text-[var(--ui-text)] mono">{telemetry?.status || "--"}</span></div>
                <div>Mode: <span className="text-[var(--ui-text)] mono">{telemetry?.mode || "--"}</span></div>
                <div>TF: <span className="text-[var(--ui-text)] mono">{telemetry?.timeframe || "--"}</span></div>
                <div>Lookback: <span className="text-[var(--ui-text)] mono">{telemetry?.lookback ?? "--"}</span></div>
                <div>History points: <span className="text-[var(--ui-text)] mono">{telemetry?.historyPoints ?? "--"}</span></div>
                <div>Coverage: <span className="text-[var(--ui-text)] mono">{Number(telemetry?.lookbackCoveragePct || 0).toFixed(1)}%</span></div>
                <div>Candle Source: <span className="text-[var(--ui-text)] mono">{telemetry?.candleSource || (wsCandles.length ? "ws-live" : "--")}</span></div>
                <div>Env: <span className="text-[var(--ui-text)] mono">{String(activeAccountMode || "paper").toUpperCase()}</span></div>
                <div>Profit Factor: <span className="text-[var(--ui-text)] mono">{perfSummary.profitFactor.toFixed(2)}</span></div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

const MetricPill = ({ label, value, tone = "neutral" }) => {
  const tones = {
    ok: "border-emerald-500/30 text-emerald-200 bg-emerald-500/10",
    warn: "border-amber-500/30 text-amber-200 bg-amber-500/10",
    danger: "border-red-500/30 text-red-200 bg-red-500/10",
    neutral: "border-[var(--ui-border)] text-[var(--ui-text)] bg-[var(--ui-panel)]"
  };
  return (
    <div className={`px-2 py-1.5 rounded border ${tones[tone] || tones.neutral}`}>
      <div className="text-[9px] uppercase tracking-widest font-black opacity-80">{label}</div>
      <div className="text-[11px] font-mono">{value}</div>
    </div>
  );
};

export default RuntimeMonitor;
