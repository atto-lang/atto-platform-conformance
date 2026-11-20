# Inverted-class v1: six-backend acceptance (draft, 2026-10-27)

Canonical machine-readable vectors: `fixtures/inverted-class/v1/manifest.json`.
These fixtures are **proposed language examples, not executed compiler tests**.
Every `verifiedBackends` list starts empty. Passing the manifest integrity
test proves only path/blob consistency and evidence honesty.

## Required semantics

1. `define inverted class T` is a *nominal* class declaration. A collection
   `InvertedArray<T>` owns columns, not independent mutable AoS row objects.
   Independent schemas with the same spelling and physical geometry are not
   interchangeable source authorities.
2. `rows[i]` is checked zero-based positional lookup in the current dense
   order. `rows[h]` is checked *logical row identity* using private owner,
   slot and generation metadata. A handle is not reconstructible from those
   numeric coordinates and cannot cross owning stores.
3. Insert validation, handle issuance and publication are failure-atomic.
   Swap-delete keeps all surviving columns coherent and revokes the deleted
   handle; recycled slots increment or permanently retire generation.
4. Read/read column loans may coexist. Exclusive writers and structural
   mutation must honor field-granular loan exclusion. Source temporary row
   projections may not escape, be stored, or cross unproven suspension.
5. Compiler-generated direct indexed fields use statically resolved nominal
   column bindings and exactly-once evaluation of receiver/index/RHS. No
   reflection fallback, textual macro, implicit AoS transpose or
   get-then-set compound operation.
6. Scalar v1 admits i64, f64, bool. bool is canonical byte 0/1; i64 is
   exact signed 64-bit; fixed pointer-free records require explicit separate
   admission after transitive layout/ownership proof. Owned array may belong
   to function, Task scope or actor; actor is not a mandatory constructor.
7. Owner teardown revokes handles/loans and scrubs physical payload. Actor
   boundary copies or transfers are governed by the language ownership
   discipline; raw mutable backing column buffers are not transferable.

## Backend build targets and proof

| Target | First compiler/runtime deliverable | Required executable proof |
| --- | --- | --- |
| Java/GraalVM | Exact typed bracket lowering on Java #2103 and sealed scope/effect proof | JDK25 Graal guest positive/negative JUnit at exact head |
| LLVM | Compiler route into native typed SoA #657, not host-only C++ reference | Real `.ores` native O0/O2, GCC/Clang, ASan/UBSan |
| Wasm | Reuse verified LLVM source lowering to wasm32; checked linear-memory ABI, one independent owner memory per actor | Actual source -> Wasm -> bounded host instance plus malformed offsets/owner cases |
| JavaScript | JS #34/#35 mixed-layout runtime + generational index, then checked ESM compiler binding | Node22 typed guest ESM, Worker isolation, real browser smoke |
| .NET | Actor-independent unmanaged columns, generational row IDs and typed CIL (Native AOT) | Real Windows/Linux Native AOT guest positives/negatives |
| Forge | New typed source path into Forge-owned native columns using same HIR semantics | Native JIT/AOT generated guest with independent lifetime/loan proof |

## Promotion rule

Report separately: **host-library prototype**, **source-accepted**, **emitted
guest code**, **runtime verified**, **exact-head CI verified**, **merged**.
A draft host primitive or source fixture verifier does not mean source code
compiles. Zero-step GitHub Actions counts as `NOT_EXECUTED`, never as a
compiler pass or failure.

Do not mirror private source across organizations without protected-source
approval, independently reviewed private carrier, destination allowlist, and
exact Git tree/blob attestations. Hash checking alone is not authorization.

Track Java #1424/#2103, LLVM #658/#657, Wasm #151/#154, JS #34/#35 and .NET
#185. These are implementation anchors, not evidence of six-way parity.
