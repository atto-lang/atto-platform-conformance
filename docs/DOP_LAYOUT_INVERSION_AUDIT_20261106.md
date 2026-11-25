# AttoLang DOP layout and `inverted` audit — 2026-11-06

**Status:** source-free reference hardening only. This document is not a compiler
qualification, native ABI certification, guest execution receipt, SIMD benchmark,
or permission to merge any existing draft.

## Four distinct physical layout contracts

The logical value of a record must remain the same across storage choices.

| Layout | Concept | Physical implementation gate |
| --- | --- | --- |
| AoS | one contiguous row record after another | versioned field offsets, alignment and stride |
| SoA | one dense primitive column per top-level field | column bases, bounds, owner and field loans |
| AoSoA | tile/chunk of **columns**, each containing lanes | tile width, padded tails, lane masks, vector fallback |
| SoAoS | independent arrays of **grouped AoS subrecords** | explicit disjoint field-group partition and aligned group strides |

A tiled AoS array with *all* fields in each element is not evidence of SoAoS
field grouping. An AoSoA tile with columnar lanes is not SoAoS. The particular
`src/layout-oracle.mjs` model now preserves this distinction in its snapshots,
requires explicit SoAoS groups, and rejects duplicate, omitted or foreign fields.

`src/layout-oracle.mjs` is intentionally a **scalar logical oracle**. It does
not allocate distinct physical memory geometries and it rejects nested object
values. Use `verification/data-layout-abi-v1.mjs` and
`src/layout-storage-oracle.mjs` for separate source-free byte-geometry and
heterogeneous storage checks; use a real compiler and generated guest execution
for backend qualification. Nested ordinary fixed-layout structs belong in one
packed top-level column under the separate `src/inverted-layout-reference.mjs`
one-level inversion contract.

## Source-language intent, not implicit allocation

- `define inverted struct T` and `define inverted class T` are distinct
  nominal declarations with explicit column-layout intent.
- Inversion is **one level**: each directly declared field gets a column;
  a nested *ordinary* fixed struct stays packed within its column; nested
  inverted declarations cannot silently flatten.
- An `InvertedArray<T>` needs one authoritative collection owner and checked
  row/field projection. Neither plain `T` construction nor an ordinary
  `Array<T>` silently converts ownership/layout.
- Immutable-by-default fields cannot acquire write loans without explicit
  mutability. Separate binding mutability from the mutability of the pointed-to
  owner/collection.
- A row handle must carry owner/slot/generation authority. Verify live identity
  *before every* read, write, swap-delete, conversion and actor-boundary use;
  never derive authorization solely from caller-supplied numeric fields.
- Disjoint field loans may coexist. Overlapping mutable loans, structural
  mutation under a loan, mutable loan escape across an unproven suspension,
  and transfer of actor-owned mutable aliases must be rejected.
- Charge AoSoA tail padding, SoAoS group alignment and peak old+new allocations
  against quotas. Fence generation exhaustion instead of wrapping stale IDs.

## Audit and execution gates

| Backend | Existing relevant work | Qualification pending |
| --- | --- | --- |
| Java/Graal | Java #2550 host column store, #2554 guest fail-closed parser | typed source inversion, emitted guest, actor owner proof |
| LLVM | LLVM #1403 restricted two-i64 inverted struct guest, #1308 scalar SoA smoke | exact-head compiler+Clang execution, richer schema and layouts |
| .NET NativeAOT | .NET #273 explicit inverted-struct rejection | owned unmanaged columns, typed CIL, NativeAOT guest |
| Wasm | Wasm #155 compiler/ABI tracker | exact LLVM-to-wasm32 memory and generated guest |
| Forge/Cranelift | Forge #156 fail-closed diagnostics, #118 tracker | typed ownership lowering and native guest |
| JavaScript | JS #34/#35 host storage, #97/#99 source drafts | source-to-worker execution and browser/Node receipts |

The shared work queue is platform-conformance issue #144. Draft conformance
PR #466 tracks a separate scalar guest checksum and exact-head evidence.
Do not duplicate those features or replace existing source compiler branches.

**Do not certify from a zero-step workflow.** `steps=[]` and `steps=null`
indicate runner admission/observation failure, not a passed test, failed compiler,
or guest parity. For a real backend claim, pin PR head SHA and tree, collect
executed nonzero steps, source and generated-artifact identities, positive guest
results, negative source/ownership fixtures, independent review and security
approval as applicable. Never export private source to an unapproved carrier.

## Prioritized next implementation wave

1. Reconcile the restricted LLVM compiler guest with the canonical one-level
   inverted-struct/class fixtures and verified MIR ownership checks.
2. Reuse one canonical `.atto` positive/negative fixture suite across all
   five native backends, checking host-only and guest status independently.
3. Require four-layout physical offset/non-alias tests for mixed-width schemas,
   tail tiles, SoAoS grouped strides and layout conversions.
4. Add adversarial cases: foreign handles, ABA after reuse, generation exhaustion,
   rows with accessors/proxies, disjoint/conflicting borrows, late cancellation,
   actor ownership transfer and supervisor/arena shutdown.
5. Benchmark real column scans, row gathers, cache misses, allocated bytes,
   tail utilization and throughput before selecting a layout automatically.

## Nested ordinary-struct padding audit (same hardening wave)

The one-level inverted reference previously calculated nested struct width as
an unaligned sum of member sizes. That undercharged packed records containing
mixed-width members. It now records natural member offsets, aggregate alignment
and a padded aggregate stride while preserving the one-column nesting rule.
For example, `{bool flag, i64 counter, bool tail}` has offsets `[0,8,16]`
and width 24, not the unaligned width 10. A second outer fixed struct containing
that value also receives its own alignment and final tail padding.

`tests/inverted-packed-alignment-20261106.test.mjs` checks this for both
`inverted class` and `inverted struct`, deep-detached value snapshots, schema
immutability, and the padded collection quota. These are reference-model checks
only: no field-to-native-pointer offsets or guest ISA instructions are certified.
