## 2026-10-17 - Fast TypedArray block copying for circular SoACandleStore

**Learning:** `SoACandleStore.getFieldSlice()` previously copied `Float64Array` elements one by one in a JS `for` loop with circular buffer modulo operations. Using native `TypedArray.prototype.set()` combined with `.subarray()` to copy contiguous slices in 1 or 2 bulk operations speeds up field slice extraction by ~2x (~650ms down to ~300ms for 100k extractions of 500 elements).

**Action:** When extracting sub-ranges or series slices from circular TypedArray stores, check if `startIdx + count <= capacity`. If unwrapped, issue a single `out.set(source.subarray(startIdx, startIdx + count))`; if wrapped around the circular boundary, issue two chunk `set()` operations.
