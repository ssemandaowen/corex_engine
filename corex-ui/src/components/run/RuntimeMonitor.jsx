import React, { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CandlestickSeries, LineSeries } from "lightweight-charts";
import client from "../../api/client";
import useStore from "../../store/useStore";
import { Maximize2, RotateCcw, Settings2, WifiOff, X } from "lucide-react";

const RuntimeMonitor = () => {
  const { strategiesLive, wsStatus, connectWebSocket, realtimeMode } = useStore();
  const [strategyId, setStrategyId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [telemetry, setTelemetry] = useState(null);
  const [viewMode] = useState("live");
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

  const strategyOptions = useMemo(() => {
    return (Array.isArray(strategiesLive) ? strategiesLive : []).filter((s) => s?.id && s?.status === "ACTIVE");
  }, [strategiesLive]);

  const selectedStrategy = useMemo(
    () => strategyOptions.find((s) => s.id === strategyId) || null,
    [strategyOptions, strategyId]
  );

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
    } catch (e) {
      setError("Unable to load strategy telemetry");
    }
  };

  useEffect(() => {
    const bars = Math.max(300, Number(selectedStrategy?.lookback || 600));
    fetchTelemetry(strategyId, symbol, bars);
    const t = setInterval(() => fetchTelemetry(strategyId, symbol, bars), Math.max(2, Number(refreshSeconds || 4)) * 1000);
    return () => clearInterval(t);
  }, [strategyId, symbol, selectedStrategy, refreshSeconds]);

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
    chartApiRef.current = chart;
    candleSeriesRef.current = candles;
    closeSeriesRef.current = closeLine;
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
      chart.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      closeSeriesRef.current = null;
    };
  }, []);

  const mergedCandles = useMemo(() => {
    const base = Array.isArray(telemetry?.candles) ? telemetry.candles : [];
    const merged = [...base]
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
  }, [telemetry]);

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
    chartApiRef.current?.timeScale()?.fitContent?.();
  }, [strategyId, symbol]);

  useEffect(() => {
    const options = telemetry?.dataSymbols?.length ? telemetry.dataSymbols : (telemetry?.symbols || []);
    if (!symbol && options.length > 0) setSymbol(options[0]);
    if (symbol && options.length > 0 && !options.includes(symbol)) setSymbol(options[0]);
  }, [telemetry, symbol]);

  const availableBars = mergedCandles.length;
  const maxWindow = Math.max(120, availableBars || 120);
  const maxOffset = Math.max(0, availableBars - chartWindowBars);

  return (
    <div className="h-full overflow-hidden bg-transparent">
      <div className="h-full border border-[var(--ui-border)] rounded-xl bg-[rgba(15,23,42,0.24)] p-3 md:p-4 space-y-3 overflow-hidden relative">
        {strategyOptions.length === 0 && (
          <div className="text-xs text-[var(--ui-muted)] border border-[var(--ui-border)] rounded p-3 bg-[var(--ui-panel)]">
            No instance running. Start a strategy in Simulation to stream runtime candles here.
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border border-[var(--ui-border)] rounded-lg p-2 bg-[var(--ui-panel)]">
          <div>
            <div className="text-[10px] text-[var(--ui-muted)] font-bold uppercase tracking-widest">
              Strategy Runtime Monitor
            </div>
            <div className="text-[10px] text-[var(--ui-subtle)] font-mono">
              {strategyId || "--"} | {symbol || "--"}
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
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            >
              {(telemetry?.dataSymbols?.length ? telemetry.dataSymbols : (telemetry?.symbols || [])).map((s) => (
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
        <div className="text-[10px] text-[var(--ui-muted)] font-mono">
          ws: {wsStatus} | candles: {mergedCandles.length} | tf: {telemetry?.timeframe || "--"}
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
                <select className="ui-select" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                  {(telemetry?.dataSymbols?.length ? telemetry.dataSymbols : (telemetry?.symbols || [])).map((s) => (
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
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default RuntimeMonitor;
