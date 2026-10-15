## 2026-10-15 - Fast Ring Buffer Slicing in SoACandleStore with TypedArray.set()
**Learning:** Slicing contiguous segments from a TypedArray circular ring buffer using `TypedArray.prototype.set()` with `.subarray()` views is ~55% faster than scalar JS loop iteration with modulo arithmetic.
**Action:** When working with TypedArray ring buffers (`Float64Array`, `Int32Array`), replace scalar loop reads with 1 or 2 `.set()` block copies depending on buffer wrap-around.
