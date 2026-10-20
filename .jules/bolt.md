## 2026-10-20 - Vectorized TypedArray slices in SoACandleStore
**Learning:** Ring buffer slices using per-element modulo `% capacity` in loops incur heavy JS overhead. Replacing per-element loop lookups in `SoACandleStore.getFieldSlice` with `TypedArray.set(sourceArray.subarray(...))` provides ~4x speedup on hot-path series extraction for indicators.
**Action:** When extracting sub-ranges from ring buffers, compute `startIdx` once and copy via contiguous `out.set(subarray)` blocks instead of running per-element modulo arithmetic in loops.
