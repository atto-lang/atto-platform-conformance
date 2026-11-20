# Versioned mixed-width physical layout golden vectors v1

**Status: source-free reference contract; not a compiler/backend parity pass.**

The checked `contracts/v1/heterogeneous-four-layout-golden-v1.json` provides 56 exact cell addresses from four real physical layouts of a logical ECS component record:

`id:u32`, `x:f64`, `flag:bool`, `next:ref32`.

The vector includes its expected per-segment relative offset, aligned physical allocation base, and total physical-byte budget. The `ref32` cell contains an encoded integer **word only**; no pointer provenance, generation, borrowing or dereference right is conveyed.

| Layout | Rows | Payload bytes | One contiguous actor allocation |
| --- | ---: | ---: | ---: |
| AoS | 3 | 72 | 72 |
| SoA | 3 | 51 | **56** |
| AoSoA (tile 4) | 5 | 144 | 144 |
| SoAoS (groups [id,flag] and [x,next]) | 3 | 72 | 72 |

The difference in SoA comes from aligning its four field-segment bases at 0, 16, 40, 44. Four independent allocations could charge a different physical allocator bookkeeping or alignment granularity, but a **single contiguous actor-backed store** needs 56 bytes rather than the 51-byte sum of field payloads. For this reason `maxTotalBytes` in the source-free reference now checks the aligned physical extent, not merely the sum of segment contents.

The oracle publishes `payloadBytes`, `physicalBytes`, and the immutable `base` for each segment. Backend implementations must charge their *actual* committed allocation extent, including page/slab headers or additional runtime alignment where required. No target is permitted to silently use a lower shared quota without explaining its physical allocation strategy.

The `test/heterogeneous-four-layout-golden-v1.test.mjs` test confirms all 56 cells, distinct naturally aligned byte ranges, every segment base/stride/extent, rejection of any limit one byte below the real allocation, and a deliberate SoAoS group mutation. These tests are part of the **reference** gate and do not prove source compiler execution.

Further acceptance:
1. Backends consume or verify these versioned vectors without re-copying a mutable source of truth.
2. GraalVM/LLVM compile and run the identical Oreslang source ECS fixture with exact output and negative reject/no-artifact behavior.
3. JS/Wasm/.NET compile and execute equivalent guest programs with actor domain/borrow/retire proof, then certify generation-safe ECS row handles.
4. Collect stepful, exact-commit CI evidence. Do not ship private source into unapproved cross-org runner carriers.
