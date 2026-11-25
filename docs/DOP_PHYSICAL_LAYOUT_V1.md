# AttoLang typed physical-layout v1 — phase-one host ABI

**Status: proposed contract, HOST_ONLY.** This defines an identical logical
scalar record mapped onto four independently checkable physical layouts. It
does not claim that `define inverted struct` is admitted by the parsers, that
HIR/MIR code generation uses this geometry, that the guest executes, or that
an actor-ownership proof has run.

The source of numeric truth is [the v1 registry](../contracts/dop-physical-layout-v1.json).
Its three heterogeneous POD fields in declaration order are:

| index | field | bytes | natural alignment |
|---|---|---:|---:|
| 0 | position | 4 | 4 |
| 1 | velocity | 8 | 8 |
| 2 | flags | 2 | 2 |

The canonical bounded example has five logical rows. Offsets and lengths are
**byte** units, not scalar indices. A field's actual natural alignment may
exceed its width, but width/alignment must be powers of two and width must not
exceed alignment. Groups are explicit ordered partitions of all field indices.

| Layout | Semantics | Physical bytes | Segment count |
|---|---|---:|---:|
| AoS | One field-aligned record per row, padded record stride | 120 | 1 |
| SoA | Separately aligned contiguous scalar column per field | 74 | 3 |
| AoSoA-4 | Four-lane tiles with a column per field inside each tile | 112 | 1 |
| SoAoS | Grouped record arrays: `[[0,2],[1]]` | 80 | 2 |

SoAoS is **not** AoSoA. It is a field partition into independently aligned
arrays of smaller AoS records. All segments are laid out in one conceptual
actor-owned allocation; `segment.base` accounts for alignment holes between
segments. A physical cell resolves to `(segment, relative byte offset,
absolute byte offset)`. The complete scalar byte range must stay inside its
segment, and no live scalar cells may overlap.

Alignment, address arithmetic, allocation size and quotas use checked signed
64-bit positive ranges. A zero-row shape has zero physical bytes; any cell
access is invalid. The format uses decimal strings for lengths/offsets to
avoid JSON's unsafe numeric precision above 2^53. Current v1 maximum field
count is 64; alignment <=4096 bytes; AoSoA lanes are a power of two <=1024.

## Canonical field-name and physical address admission

Field names in the phase-one **typed host plan** are opaque metadata, not
yet source-level AttoLang identifiers. Every backend must admit the *same*
nonempty sequence of valid Unicode scalar values, without a NUL code point
and with a hard **1,024-byte UTF-8 limit** (not 1,024 characters or UTF-16
code units). No normalization takes place: precomposed `é` and `é`
are distinct field names, while identical sequences are duplicates.
Whitespace-only names are allowed at this host-ABI layer; a future
source-language parser may impose stricter identifier syntax separately.
Java rejects unpaired UTF-16 surrogates; the JavaScript host oracle
rejects them before encoding; native LLVM/C++ rejects malformed UTF-8,
including overlong encodings, encoded surrogates, truncated sequences,
and code points above U+10FFFF.

The extended conformance matrix examines 13 row counts (0, 1, 2, 3, 4,
5, 7, 8, 9, 17, 31, 32 and 33) for each of the four layouts: **52**
geometry combinations, with field widths 1/2/4/8 and varied alignments
1/4/8/16. It checks every live cell for byte-range containment, scalar
alignment and no overlap, including AoSoA partial-tile tails. These remain
**host descriptor tests**, not source lowering or memory-safety proofs
for arbitrary guest pointers.

## Initial backend implementations

- Java: `dev.oreslang.compiler.dop.PhysicalLayoutV1` is an immutable, typed
  physical-address plan. JVM host tests write/read actual direct-buffer bytes
  using planned addresses. It is NOT connected to guest parser/HIR yet.
- LLVM: `oreslang::dop::physical_v1::TypedPhysicalPlan` bridges a typed
  scalar-field record into the existing native heterogeneous layout substrate
  and exposes checked physical cell addresses. Native C++ host tests
  write/read actual byte buffers. It is NOT a guest LLVM IR load/store yet.
- Wasm, Forge and .NET: NOT_IMPLEMENTED for this v1 physical descriptor.

Backend tests duplicate the golden address results intentionally and cannot
share private repo source or compiled artifacts through alternate organizations.
Keep all source-local workflows inside their source repositories. Do not
promote host-only tests to genuine guest or full-AOT parity.

## Release sequence

1. Get reviewed and runner-executed conformance vector tests (currently
   GitHub Actions source-org admission is blocked, issue #315).
2. Verify the Java and LLVM typed host-memory tests on executed source-local
   runners, with GCC/Clang sanitizers on LLVM and JDK 25 on Java.
3. Wire source `inverted` syntax into typed HIR and layout-aware MIR, carrying
   the exact plan/ABI, ownership, actor arena and bounds metadata.
4. Emit verifiable JVM/GraalVM and LLVM loads/stores and run the *same* AttoLang
   source guest through both independent compilers; inspect generated
   artifacts, and prove zero-GC LLVM and full-AOT GraalVM as separate gates.
5. Extend the same fixtures to Wasm, Forge and .NET. Require independently
   reviewed exact-head CI and protected merges across all five.

A CPU host buffer matching this registry is **not** a claim that AttoLang
already supports a physical `inverted` guest storage lowering.
