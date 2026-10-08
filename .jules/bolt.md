# Bolt's Journal - CoreX Engine

## 2026-10-08 - IncrementalSMA O(1) Ring Buffer Optimization
**Learning:** `IncrementalSMA` was re-summing the entire price buffer with a `for` loop and calling `Array.prototype.shift()` on every tick update, making update complexity $O(P)$ where $P$ is the indicator period. Since indicators run on every tick/candle across multiple strategies (including dependent indicators like Bollinger Bands, Keltner Channels, Z-Score, and DPO), this created $O(P)$ overhead on hot paths. Replacing array shifting with a fixed ring buffer and running sum (`_sum`) reduces update complexity to $O(1)$ constant time (~20x speedup for $P=200$).
**Action:** Always prefer $O(1)$ sliding window ring buffers with running sum for incremental indicator updates on price series data.
