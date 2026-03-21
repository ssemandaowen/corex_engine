import React, { useMemo } from "react";

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const OhlcChart = ({ candles = [], markers = [] }) => {
  const { width, height, pad, minPrice, maxPrice, points, markerPoints } = useMemo(() => {
    const width = 1100;
    const height = 320;
    const pad = { top: 16, right: 56, bottom: 24, left: 10 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const src = Array.isArray(candles) ? candles : [];
    const lows = src.map((c) => Number(c.low)).filter(Number.isFinite);
    const highs = src.map((c) => Number(c.high)).filter(Number.isFinite);
    const minRaw = lows.length ? Math.min(...lows) : 0;
    const maxRaw = highs.length ? Math.max(...highs) : 1;
    const range = Math.max(maxRaw - minRaw, Math.max(maxRaw, 1) * 0.001);
    const minPrice = minRaw - range * 0.03;
    const maxPrice = maxRaw + range * 0.03;
    const denom = Math.max(maxPrice - minPrice, 0.0000001);

    const toY = (v) => {
      const y = pad.top + ((maxPrice - Number(v)) / denom) * plotH;
      return clamp(y, pad.top, pad.top + plotH);
    };
    const n = Math.max(src.length, 1);
    const step = n > 1 ? plotW / (n - 1) : plotW;
    const bodyW = clamp(step * 0.58, 3, 12);

    const points = src.map((c, i) => {
      const x = pad.left + i * step;
      const openY = toY(c.open);
      const closeY = toY(c.close);
      const highY = toY(c.high);
      const lowY = toY(c.low);
      return {
        x,
        openY,
        closeY,
        highY,
        lowY,
        bodyY: Math.min(openY, closeY),
        bodyH: Math.max(Math.abs(closeY - openY), 1.2),
        bodyW,
        up: Number(c.close) >= Number(c.open),
        t: Number(c.time)
      };
    });

    const tMin = Number(src[0]?.time || 0);
    const tMax = Number(src[src.length - 1]?.time || tMin + 1);
    const tRange = Math.max(tMax - tMin, 1);
    const markerPoints = (Array.isArray(markers) ? markers : []).map((m) => {
      const x = pad.left + ((Number(m.time) - tMin) / tRange) * plotW;
      const y = toY(Number(m.value || 0));
      const kind = String(m.kind || "signal").toLowerCase();
      const color = kind === "buy" ? "#22c55e" : (kind === "sell" ? "#ef4444" : "#60a5fa");
      return { x: clamp(x, pad.left, pad.left + plotW), y, label: m.label || "EVENT", t: Number(m.time), color };
    });

    return { width, height, pad, minPrice, maxPrice, points, markerPoints };
  }, [candles, markers]);

  if (!candles.length) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-[var(--ui-muted)]">
        Waiting for OHLC data...
      </div>
    );
  }

  const yTicks = 5;
  const tickValues = Array.from({ length: yTicks }, (_, i) => maxPrice - ((maxPrice - minPrice) * i) / (yTicks - 1));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full bg-[var(--ui-panel-strong)] rounded border border-[var(--ui-border)]">
      {tickValues.map((v, i) => {
        const y = pad.top + ((height - pad.top - pad.bottom) * i) / (yTicks - 1);
        return (
          <g key={`grid_${i}`}>
            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="var(--ui-border)" strokeWidth="1" />
            <text x={width - pad.right + 6} y={y + 3} fontSize="10" fill="var(--ui-muted)" fontFamily="monospace">
              {Number(v).toFixed(5)}
            </text>
          </g>
        );
      })}

      {markerPoints.slice(-24).map((m, i) => (
        <g key={`m_${m.t}_${i}`}>
          <line x1={m.x} y1={pad.top} x2={m.x} y2={height - pad.bottom} stroke={`${m.color}55`} strokeDasharray="3 3" />
          <circle cx={m.x} cy={m.y} r="2.6" fill={m.color} />
        </g>
      ))}

      {points.map((p, i) => (
        <g key={`c_${p.t}_${i}`}>
          <line x1={p.x} x2={p.x} y1={p.highY} y2={p.lowY} stroke={p.up ? "#10b981" : "#f43f5e"} strokeWidth="1.3" />
          <rect
            x={p.x - p.bodyW / 2}
            y={p.bodyY}
            width={p.bodyW}
            height={p.bodyH}
            fill={p.up ? "#10b981" : "#f43f5e"}
            opacity="0.95"
          />
        </g>
      ))}
    </svg>
  );
};

export default OhlcChart;
