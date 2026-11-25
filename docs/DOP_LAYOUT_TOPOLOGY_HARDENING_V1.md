# AttoLang DOP layout topology: independent host-model hardening v1

**Status: source-independent Node.js byte-layout reference only.** Not an AttoLang guest compiler, native ABI, performance benchmark, sanitizer proof, SIMD/GPU codegen, or backend parity certification. Run `node --test tests/dop-layout-topology-v1.test.mjs` from the conformance repo root.

## Layout definitions

| Layout | Arrangement | Admission |
| --- | --- | --- |
| AoS (array of structs) | A contiguous sequence of complete records | Ordinary row-major values |
| SoA (struct of arrays) | One contiguous column per directly declared field | The exact physical invariant of the existing v1 inverted owner |
| AoSoA (array of structs of arrays) | Fixed-size tiles, each with its own per-field columns | Requires explicit tile width (power of two, 2..64 in this *host model*) |
| SoAoS (struct of arrays of structs) | Arrays of *field-group records*, e.g. hot [position, velocity] and cold [mass, state] | Requires an exact partition of fields into explicitly selected groups |

**AoSoA and SoAoS are different.** AoSoA groups *rows* into tiled columns. SoAoS groups *fields* into bundles of row-major records. Neither is silently equivalent to the canonical one-physical-column-per-direct-field SoA definition for `InvertedArray<T>` v1. They are **candidate explicit layout extensions**; this test introduces no new source keyword or implicit layout selection.

For field index f, physical row r, field count F, number of rows N, tile width W, and eight-byte scalar cells, the checked reference offsets are:

- AoS: `8 * (r * F + f)`
- SoA: `8 * (f * N + r)`
- AoSoA: `8 * (floor(r/W) * W * F + f * W + r % W)`
- SoAoS: `group_base + 8 * (r * group_width + index_within_group)`

These are little-endian **JS ArrayBuffer** formulas, not a finalized target ABI. AoSoA reserves the final tile in full but makes incomplete-tail lanes unaddressable. V1 model limits (16 MiB, 65,536 rows, i64 fields) are test safety budgets only.

## Preserve AttoLang's established inverted contract

- `define inverted class Foo as ... end` declares a nominal class-like row API whose methods use the authoritative owner columns, not per-row mutable object copies.
- `define inverted struct Foo as ... end` declares a nominal fixed-size *value schema*. Detached snapshots are values, not mutable aliases.
- `InvertedArray<Foo>` is an explicitly owned SoA collection. Ordinary `Array<Foo>` and ordinary classes/structs must not silently convert.
- **Only one level is inverted.** Every immediate field is one column. Nested *ordinary* fixed-layout structs stay packed as one column cell; nested inverted owners and recursive flattening must fail closed.
- Actor and tenant isolation, owner/slot/generation row identity, independent field borrowing, nonescaping projections, move/close revocation and no suspension across forbidden loans remain mandatory source/compiler/runtime obligations.

Ordinary dense indices are *positions*, never stable handles after swap-delete. This host model intentionally supplies no handles or loans, so it must not be cited as evidence of those properties.

## Executable model checks

`src/dop-layout-topology-v1.mjs` allocates one real JS ArrayBuffer for each topology, reads and writes signed i64 through little-endian DataView, checks offset bounds and byte-cell uniqueness, forbids implicit topology conversion, validates every field before push publication, and clears removed physical cells after coherent swap-delete. Rejected input cannot partially mutate live bytes. The implementation copies and freezes admitted schema metadata, refuses unknown fields, duplicate/missing SoAoS groups, malformed widths, unsafe indices, coercing floats and overflowing i64 operations.

`tests/dop-layout-topology-v1.test.mjs` covers empty and full/tail tiles, physical distinctness and bounds, AoS/SoA/AoSoA/SoAoS read/write equivalence, grouped-field difference, signed overflow and push failure atomicity, detached snapshots, swap-delete scrubbing, malformed schema and grouping, and a deterministic **1,500-operation** differential trace. These are host oracle tests and do not certify any .atto execution.

## Guest/backend qualification (unmet until exact-head stepful evidence)

1. Keep the normative inverted-v1 source contract in `docs/EXPLICIT_INVERTED_LAYOUT_V1.md`, and coordinate with conformance drafts #249 and #466. Do not duplicate parser implementations or overwrite active branches.
2. Java/GraalVM, LLVM native, Wasm, .NET Native AOT and Forge must each distinguish parser rejection, host-only storage, verified typed HIR/MIR, and actual compiled/linked .atto execution. The restricted two-i64 LLVM prototype is not general class/struct parity.
3. Add separate positive and negative guest fixtures for inverted class, inverted struct and InvertedArray, including one-level packed children, nested-inverted rejection, stale/foreign/forged generations, borrow-vs-resize/erase, failed row admission, detached snapshots, and actor/Task/await isolation. No raw pointer or unchecked proxy escape.
4. Only after explicit layout-policy semantics are accepted should AoSoA/SoAoS codegen be admitted. Require same observable outputs at tile boundaries and after mutations/deletions, explicit physical schema identity, bounds, and no undisclosed AoS fallback.
5. DOP speed claims require matched CPU affinity, compiler optimizations, input distribution, allocation counts, warmups, repetitions, cache misses, bandwidth and controlled machine conditions. Independent CPU scalar, SIMD and nested `gpu {}` / `cpu {}` guest execution receipts must be maintained.
6. CI receipts must identify exact source HEAD/tree, compiler and guest artifacts, actual executed steps and tests. Zero-step, synthetic receipt, host oracle, or a source-only branch means **NOT_EXECUTED** for guest execution. Never transfer private source between orgs without an independently approved source-export/retention policy.

Related active work: conformance #249 and #466, Java #2550/#2554, LLVM #1403/#1308, .NET #273, Forge #156 and Wasm #309. The source-free layout model deliberately does not touch or make unearned claims about those PRs.
