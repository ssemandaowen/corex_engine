## 2026-10-16 - SoACandleStore TypedArray Bulk Copy Optimization
**Learning:** `SoACandleStore.getFieldSlice()` was performing point-by-point copy loops with modulo calculations for ring buffer slices. Replacing the element-by-element loop with `Float64Array.prototype.set()` and `.subarray()` slices yields ~2x speedup by utilizing native memory bulk operations in V8.
**Action:** When extracting contiguous or circular sub-arrays from TypedArrays in hot execution paths, use `out.set(source.subarray(...))` rather than element-by-element index copy loops.
