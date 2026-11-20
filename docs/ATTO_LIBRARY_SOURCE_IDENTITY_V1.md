# Canonical AttoLang library source — five-backend identity candidate v1

The exact 657-byte `atto.core/numeric` portable source has pinned Git blob
`5ced991f1d49b3c2a60fdd72b9003c0a4d18cd72`. Canonical `.atto`
source files with this blob are present in:

- Java/GraalVM: `src/main/resources/dev/atto/core/numeric.atto`
  (stacked draft Java #2601, active packaged source)
- LLVM: `stdlib/numeric.atto` (stacked draft LLVM #1478)
- Wasm, .NET, Forge: `contracts/atto-core-v1/numeric.atto`
  (source snapshots only, not necessarily active stdlib implementations)

LLVM-only draft Alloc source blobs:
`atto.alloc/int_buffer` = `25b3d4bc06a0c859aacadaf0795414027a076bdc`;
`atto.alloc/int_buffer_bundle` = `07c7083e099a18f1db7097f9639efc677070eb95`.
There is **no five-backend Alloc implementation or parity claim**.

The manifest records exact canonical source locations and stage:
`PR_CANDIDATE` vs `SNAPSHOT_ONLY`. The checker accepts only five separately
named, exact-SHA source observations and returns
`UNVERIFIED_FIVE_BACKEND_SOURCE_CLAIMS`: provided observations are
**untrusted assertions**, not independently fetched GitHub evidence.
Every claimed backend commit/tree/blob must be fetched from the
source-owning repository independently. No source-only result can promote
a compiler/guest pass. Null/empty workflow steps remain runner admission
failure by the v1 profiles evidence classifier, not successful tests.

The conformance fixture is a pinned **snapshot**, not the source package
that a compiler executes. The reference blob retains its legacy comment
text for byte-identical compatibility while public module names are
`atto.core`. A future coordinated v2 source change should update the
comment in all five repositories, bump pins, and reexecute all backends.
