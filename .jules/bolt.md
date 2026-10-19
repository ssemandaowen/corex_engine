## 2026-10-19 - Fast TypedArray block copy in SoACandleStore

**Learning:** `SoACandleStore.getFieldSlice` extracted circular typed array slices element-by-element using a modulo loop. Replacing per-element loop modulo with block copies using `TypedArray.prototype.set` and `.subarray()` (handling 1 or 2 contiguous memory chunks) speeds up array slice creation by ~4x on large lookback windows.

**Action:** When extracting lookback windows or series slices from typed array ring buffers, use `subarray` + `.set()` to perform native block memory copies instead of per-item loops.
