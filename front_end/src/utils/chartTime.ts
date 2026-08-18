// Converts a candle timestamp to the unit lightweight-charts expects.
// The engine emits candle.time in milliseconds, but lightweight-charts
// requires a UNIX timestamp in seconds. Values already in seconds (< 1e12)
// are passed through unchanged.
export const toChartTime = (t: number): number =>
  t > 1e12 ? Math.floor(t / 1000) : t;
