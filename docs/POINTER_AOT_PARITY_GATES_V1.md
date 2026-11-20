## Three candidate compilers: exact source heads, zero execution receipts

The separate [source-only candidate ledger](../contracts/pointer-local-candidate-evidence-v1.json)
tracks reviewed draft implementation heads for Rust/Wasm (PR #264),
LLVM native AOT (PR #64) and .NET CIL / NativeAOT (PR #22).
They implement a strict single-local, one-read/one-unref subset, **not**
all 36 conformance cases. Every ledger entry preserves the exact SHA and
still explicitly reports NOT_EXECUTED, 0 real runner steps, null compiled
guest artifact hashes and null approval. The canonical registry's
11 backend evidence slots also remain NOT_EXECUTED.

A source tree, an authored Rust/JavaScript test, a generated CI config,
and a failed job with zero steps can never promote any backend to PASS.
Independent compiler-vs-guest evidence is mandatory.

# Pointer<T> / native AOT conformance gate (draft)

**Reference model only.** The C++20 model in models/pointer_capability_aot_v1.cpp is deliberately **not** AttoLang source, a compiler plugin, or a generated AttoLang native binary. Its host-language & and * operators are permitted **inside C++**; AttoLang must reject unary & and unary * for pointer manipulation. See atto-spec/language/pointer-aot-safety-v1.md in the related draft.

## 2026-11-19: local-place reference alias audit, distinct from owned Pointer allocation

The new [PRL-001..036 source fixture registry](../contracts/pointer-ref-local-v1.json)
pins the exact `rt ref/deref/unref` and `rt ref + deref!/unref!` examples and
checks 10 positive target runs (each expects 42) plus 26 negative compiler
admission cases. Both are **TARGET_ONLY / NOT_EXECUTED** on all 11
`atto-source.*` backends until actual compiler and guest receipts exist.

Two visually identical `Pointer<int>` values must NOT be treated as equivalent
authority: `rt ref` mints a **non-owning read lease** over an existing local;
`Pointer.alloc<int>` returns an owning region capability in a separate
experimental profile. The former cannot `close()`, `write_at()`, be copied,
shared, serialized, or cast to `int`. Every `unref` consumes its individual
handle, but never the underlying local. Two separately minted readonly handles
may coexist; mutation and drop remain blocked until both are released.
`CheckedRef<Class>` restoration is a third distinct operation family.

Source-only `node --test tests/pointer_ref_local_v1.test.mjs` pins the two
original files by **exact Git blob SHA**, checks unique paths, 36 case IDs and
backend evidence slots, plus adversarial fixture contents.
`rustc --test tests/pointer_local_lease_oracle_v1.rs` is an *independent host*
state-machine oracle for alias equivalence, concurrent readers, actor/tenant
authority, stale generation/ABA, overflow, uninitialized reads, cleanup paths
and wrong owner rights. Neither test compiles `.atto` guest code or
demonstrates LLVM/Graal/.NET/Forge AOT.

**Mandatory promotion gate:** compiled `.atto` positive guest executions
return 42 for every supported backend, and exact negative fixtures produce no
executable guest artifact; capture each compiler SHA, source tree, output hash,
actual executed job steps, native sanitizers and immutable receipt. A zero-step
GitHub Actions failure is `NOT_EXECUTED`, never green.

## Audit status on 2026-11-15

| Target | Evidence | Pointer<T> status |
| --- | --- | --- |
| atto-source.rs browser Wasm compiler | Stacked #142 has exact-source private runner proof of compiled scalar/owned Wasm guests and no-artifact pointer rejection; **not** positive Pointer<T> lowering. | UNSUPPORTED (negative gate executed) |
| atto-source.llvm | Stacked #13 has exact-source private runner proof of 15 native scalar guests and 18 no-IR pointer/syntax negatives; no positive Pointer<T> executable. | UNSUPPORTED (negative gate executed) |
| atto-source.java / GraalVM Native Image | Main branch is a backend scope README. | NOT_EXECUTED |
| atto-source.net / .NET Native AOT | Main branch is a backend scope README. | NOT_EXECUTED |
| atto-source.forge | Main branch is a backend scope README. | NOT_EXECUTED |
| atto-source.wasm | Main branch is a backend scope README. | NOT_EXECUTED |

Independent staged PRs may contain other prototype work; this table does not invalidate them. Promote a target to PASS **only** after real compiled pointer guests run against an immutable source/compiler/artifact receipt.

## What the reference model proves

The finite two-slot, 16-element C++20 reference model checks valid loads/stores, **uninitialized read rejection**, one-past-end and large-index denial, reader/writer loan exclusion, failed-send rollback, foreign-tenant rejection, successful move with old-generation revocation, immutable sharing with outstanding-loan revocation blocking, last-share close permission, generation safety on slot reuse, overflowing allocation requests and zero-sized region access denial. No assertion may silently disappear under `NDEBUG`: the model rejects such builds at preprocessing time.

Local verification on 2026-11-15 against model blob SHA **96117e25a599d11ebc679c459d28b6a9c02c2e18**:

- g++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic: 17/17 passed.
- clang++ -std=c++20 -O1 -g -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -fno-omit-frame-pointer: 17/17 passed.

These are *historical* results for the earlier blob. The strengthened source blob `4a23a6bde66200f746893d22316dbaa55a011694` adds initialization masks, share-loan pinning and `NDEBUG` protection; its own executed proof is **[private Actions #43760576522](https://github.com/zed-pkg-test/oreslang-private-pr-validation-20261012/actions/runs/43760576522)** (completed success, all job steps executed), with the exact model Git blob rehashed before execution. Both GCC `-O2` and Clang ASan/UBSan compiled and ran every model assertion successfully. A deliberate `-DNDEBUG` compile was **rejected** at preprocessing as required, preventing false tests when `assert` is disabled. This is still **source-free model only**, not an AttoLang compiled guest, a native `Pointer<T>` AOT execution or concurrency proof.

The model has no thread scheduler, real actor runtime, compiler output or FFI. It cannot prove correct native AOT lowering, hard real time, low/zero guest GC or multi-backend parity. Its pointer aliases are model Handle values, not machine addresses.

## Required backend release gate

1. Compile AttoLang source that instantiates Pointer<int>, a non-Copy resource Pointer<T>, and a compound graph with reachable owned fields; do not interpret it.
2. Verify pre-lowering rejection of unary &/* pointer syntax, forged handles, duplicate mutable borrows, escaping loans, use after take, post-close use, cross-domain pointer bytes, open-world generic T, and unlisted FFI.
3. Emit a pinned closed-world AOT native application or compiled Wasm program; show static specialization, region layout, drop graph, artifact SHA, source tree SHA and compiler SHA.
4. Execute guests under bounds, overflow, restart, cancellation, concurrent transfer and memory-revocation adversaries; verify controlled failure instead of undefined behavior.
5. Native gate: LLVM with Clang ASan/UBSan, GraalVM Native Image genuine executable, .NET NativeAOT genuine executable, Forge genuine native executable. Wasm gate: actual Wasm compilation and engine execution. All need real nonempty job steps with artifact provenance.
6. Report each backend precisely as PASS, FAIL, UNSUPPORTED or NOT_EXECUTED. Source-free C++ model passes do not upgrade backend status.

Closed-world proofs must comply with atto-target-profiles/docs/CLOSED_WORLD_AOT_PROOF_V1.md, and actor transfer semantics with contracts/pony-reference-capabilities-atto-v1.json.
