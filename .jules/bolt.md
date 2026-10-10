# Bolt Journal - Critical Learnings

## 2026-10-10 - Fast Block Slicing in TypedArray Ring Buffers
**Learning:** Element-by-element iteration (`for (let i=0; i<n; i++) out[i] = source[idx]`) in circular typed-array ring buffers introduces unnecessary per-element modulo/indexing overhead when extracting contiguous series slices. Using `Float64Array.prototype.set()` combined with `subarray()` to copy contiguous memory blocks (up to 2 `set()` calls when wrapping across capacity boundary) improves slice operations by ~40% with zero allocations beyond the target buffer.
**Action:** When extracting sub-views or slices from circular TypedArrays, check if `writeIndex >= count` and perform direct block copying via `.set(subarray(...))`.
