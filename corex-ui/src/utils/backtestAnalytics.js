export const fmtMoney = (v) => {
  const n = Number(v || 0);
  return `$${n.toFixed(2)}`;
};

export const calcDrawdownSeries = (equityCurve = []) => {
  let peak = -Infinity;
  return equityCurve.map((p) => {
    const equity = Number(p?.equity || 0);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((equity / peak) - 1) * 100 : 0;
    return { time: Number(p?.time), drawdown: dd };
  });
};

export const calcReturns = (equityCurve = []) => {
  const returns = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const prev = Number(equityCurve[i - 1]?.equity || 0);
    const cur = Number(equityCurve[i]?.equity || 0);
    if (!prev) continue;
    returns.push({ time: Number(equityCurve[i]?.time), r: (cur / prev) - 1 });
  }
  return returns;
};

export const calcRollingSharpe = (returns = [], window = 20) => {
  const out = [];
  for (let i = window - 1; i < returns.length; i += 1) {
    const slice = returns.slice(i - window + 1, i + 1).map((r) => Number(r?.r ?? r?.value ?? r ?? 0));
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / slice.length;
    const std = Math.sqrt(variance);
    const sharpe = std === 0 ? 0 : (mean / std) * Math.sqrt(window);
    out.push({ time: Number(returns[i]?.time), sharpe });
  }
  return out;
};

export const calcHistogram = (returns = [], bins = 20) => {
  if (!returns.length) return [];
  const values = returns
    .map((r) => Number(r?.r ?? r?.value ?? r))
    .filter((v) => Number.isFinite(v));
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ label: `${(min * 100).toFixed(1)}%`, count: values.length, mid: min }];
  }
  const width = (max - min) / bins;
  const buckets = Array.from({ length: bins }, (_, i) => ({
    min: min + i * width,
    max: min + (i + 1) * width,
    count: 0
  }));
  values.forEach((v) => {
    const idx = Math.min(buckets.length - 1, Math.floor((v - min) / width));
    buckets[idx].count += 1;
  });
  return buckets.map((b) => ({
    label: `${(b.min * 100).toFixed(1)}%`,
    count: b.count,
    mid: (b.min + b.max) / 2
  }));
};

export const mergeAnalysisSeries = (equityCurve = [], drawdownSeries = [], sharpeSeries = []) => {
  const map = new Map();
  equityCurve.forEach((p) => {
    const key = Number(p?.time);
    if (!Number.isFinite(key)) return;
    map.set(key, { time: key, equity: Number(p?.equity || 0), drawdown: null, sharpe: null });
  });
  drawdownSeries.forEach((p) => {
    const key = Number(p?.time);
    if (!Number.isFinite(key)) return;
    const cur = map.get(key) || { time: key, equity: null, drawdown: null, sharpe: null };
    cur.drawdown = Number(p?.drawdown || 0);
    map.set(key, cur);
  });
  sharpeSeries.forEach((p) => {
    const key = Number(p?.time);
    if (!Number.isFinite(key)) return;
    const cur = map.get(key) || { time: key, equity: null, drawdown: null, sharpe: null };
    cur.sharpe = Number(p?.sharpe || 0);
    map.set(key, cur);
  });
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
};

export const calcExpectancy = (trades = []) => {
  const wins = trades.filter((t) => Number(t?.profit || 0) > 0);
  const losses = trades.filter((t) => Number(t?.profit || 0) < 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + Number(t?.profit || 0), 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + Number(t?.profit || 0), 0)) / losses.length : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);
  return { winRate, avgWin, avgLoss, expectancy };
};

const isoWeek = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

export const calcHeatmap = (trades = [], mode = 'month') => {
  const map = new Map();
  trades.forEach((t) => {
    const ts = t?.exitTime || t?.entryTime;
    if (!ts) return;
    const d = new Date(ts);
    const key = mode === 'week'
      ? isoWeek(d)
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) || 0) + Number(t?.profit || 0));
  });
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
};
