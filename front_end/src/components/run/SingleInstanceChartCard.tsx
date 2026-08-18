import React, { useState, useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { toChartTime } from '../../utils/chartTime';
import { runApi } from '../../api/run';
import { TrendingUp, TrendingDown, Target, Maximize2, Cpu } from 'lucide-react';

interface SingleInstanceChartCardProps {
  id: string;
  name: string;
  symbol: string;
  mode: string;
  status: string;
  onFocus: (id: string) => void;
  onStop: (id: string) => void;
}

export default function SingleInstanceChartCard({
  id,
  name,
  symbol,
  mode,
  status,
  onFocus,
  onStop,
}: SingleInstanceChartCardProps) {
  const [telemetry, setTelemetry] = useState<any | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // Poll telemetry for this specific instance
  const fetchTelemetry = async () => {
    try {
      const res = await runApi.getTelemetry(id);
      if (res.success) {
        setTelemetry(res.payload);
      }
    } catch (e) {
      console.error(`Error loading telemetry for ${id}:`, e);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const t = setInterval(fetchTelemetry, 3000);
    return () => clearInterval(t);
  }, [id]);

  // Initialize Lightweight Chart for this card
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#070e20' }, // Panel bg
        textColor: '#64748b',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#0f172a' },
        horzLines: { color: '#0f172a' },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        visible: true,
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
      },
    }) as any;

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#F27D26',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // overlay
    });
    volumeSeriesRef.current = volumeSeries;

    const observer = new ResizeObserver((entries) => {
      if (entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
    });
    observer.observe(chartContainerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, []);

  // Set chart data when telemetry updates
  useEffect(() => {
    if (!telemetry || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candles = telemetry.candles || [];
    if (candles.length > 0) {
      // Backend emits candle.time in milliseconds; lightweight-charts expects
      // a UNIX timestamp in seconds. Normalize so candles actually render.
      const formattedCandles = candles.map((c: any) => ({
        time: toChartTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const formattedVolumes = candles.map((c: any) => ({
        time: toChartTime(c.time),
        value: c.volume || 100,
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
      }));

      candleSeriesRef.current.setData(formattedCandles);
      volumeSeriesRef.current.setData(formattedVolumes);
    }
  }, [telemetry]);

  const pnl = telemetry?.engineState?.positionSnapshot?.totalUnrealized ?? 0;
  const isPositive = pnl >= 0;
  const currentPrice = telemetry?.candles?.[telemetry.candles.length - 1]?.close ?? 0;

  return (
    <div 
      className="rounded-xl border flex flex-col overflow-hidden bg-[var(--ui-panel-soft)] transition-all duration-300 hover:border-[var(--ui-accent)] hover:shadow-lg"
      style={{ borderColor: 'var(--ui-border)', height: '360px' }}
    >
      {/* Card Header */}
      <div className="p-3 border-b border-[var(--ui-border)] bg-[var(--ui-panel-strong)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <div>
            <span className="text-xs font-black text-white uppercase">{name}</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[9px] px-1 rounded bg-[var(--ui-accent)]/10 text-[var(--ui-accent)] font-mono uppercase border border-[var(--ui-accent)]/25">{symbol}</span>
              <span className={`text-[9px] px-1 rounded font-mono uppercase border ${
                mode === 'LIVE' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              }`}>{mode}</span>
            </div>
          </div>
        </div>

        {/* Floating Metrics overlay */}
        <div className="flex flex-col items-end font-mono">
          <span className={`text-xs font-black ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}${pnl.toFixed(2)}
          </span>
          <span className="text-[10px] text-[var(--ui-muted)]">
            {currentPrice ? `@ ${currentPrice.toFixed(5)}` : 'Awaiting data'}
          </span>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="flex-1 relative bg-[#070e20]" ref={chartContainerRef}>
        {(!telemetry?.candles || telemetry.candles.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#070e20]/80 z-10 text-[10px] uppercase font-bold text-[var(--ui-muted)] tracking-wider">
            Initializing candles...
          </div>
        )}
      </div>

      {/* Card Footer with actions */}
      <div className="p-2 border-t border-[var(--ui-border)] bg-[var(--ui-panel-strong)] flex items-center gap-2">
        <button
          onClick={() => onFocus(id)}
          className="flex-1 py-1 px-2.5 text-[9px] font-black uppercase tracking-wider rounded border border-[var(--ui-accent)] text-white hover:bg-[var(--ui-accent)] transition-all cursor-pointer flex items-center justify-center gap-1 active:scale-95"
        >
          <Maximize2 size={10} />
          Deep Workstation
        </button>
        <button
          onClick={() => onStop(id)}
          className="py-1 px-2.5 text-[9px] font-bold uppercase tracking-wider rounded border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-colors cursor-pointer active:scale-95"
        >
          Halt Thread
        </button>
      </div>
    </div>
  );
}
