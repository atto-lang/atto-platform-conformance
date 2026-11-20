### Full-tree token-free Forge PR #50 CI mirror (GCC and Clang)

Current Forge source SHA `bdbd253abc71c3631cf0d5b3e5922a5b58155936`
was mirrored via the GitHub connector to the private
[gha-indie-worker/atto-ci carrier](https://github.com/gha-indie-worker/atto-ci/tree/ci/forge-pr50-safe-output-exact-20261120)
at commit `cada4a437d284bbe048b3f78c5b7c9054da7153a`.
**All 80 source blobs were independently copied and SHA-matched**;
the carrier mirror's Git-tree SHA **exactly equals the source's complete
tree** `2d95af6aa96776553cee0d0fa5cc4163618a1a24`.
No token or secret from the source organization was used in checkout;
the workflow uses only its own private carrier checkout token, without
persisting credentials.

The new workflow requests the **full CMake/CTest suite under GCC and
Clang with ASan/UBSan**. [Carrier run #44684432723](https://github.com/gha-indie-worker/atto-ci/actions/runs/44684432723)
failed with **0 steps executed on BOTH jobs**. This is
runner admission, not a compiler failure or a passing full suite.
Current source Actions #44683428229 likewise failed with zero steps.
Org-level minutes/billing are inaccessible via the connector; the
selected carrier has an older successful run but no *proven current*
runner admission. Full CTest and full cross-backend conformance remain
`NOT_EXECUTED`; Forge's separately recorded local subset remains
a PASS only for that tested subset.

### Forge local execution reverified after caller-owned output safety correction

At current [Forge PR #50](https://github.com/atto-lang/atto-source.forge/pull/50)
head `bdbd253abc71c3631cf0d5b3e5922a5b58155936`, the C++20 production
`forge_scalar` compiler now preserves pre-existing caller-owned C++ outputs
on rejected source; it still prevents any new output artifact. Exact
`tools/forge_scalar.cpp` blob is `36f9380be4597771ad6d2b1aa64bc567f62995f1`,
and the updated CMake pointer guest suite blob is
`dcb8ae2c808281daa4358352be37a75b95636f37`.

**Genuine local execution:** GCC 14.2 and Clang 17.0 at O1 with
ASan/UBSan built four native pointer guests per compiler (8 executions;
canonical logical values 42, 42, 42, 13; process exit 0), rejected each
of the 24 negative sources per compiler without creating artifacts
(48), and preserved pre-existing output byte-for-byte on each of those
rejections (48). Two independently built typed-plan security test
executables passed; 16 additional native scalar guest regression
executions passed; 36 source/fixture files matched exact Git blob SHAs.
The exact updated CMake suite passed under both GCC and Clang.
Canonical source rt/bang generated C++ SHA-256:
`088b8c56d2d2cd87b56c99b33dd423038f7929a859465ebd55c7b29e3acd31d6`.
Detailed machine-readable local receipt SHA-256:
`960f73fac1edf1d8e7db4f7436b4f6c6bb2b5c9e883aacb9ec26e73451a10fc6`.
[Exact-head PR proof comment](https://github.com/atto-lang/atto-source.forge/pull/50#issuecomment-7031779263).

This is **PASS_LOCAL_SUBSET, NOT full conformance certification**.
[Exact-head Actions #44683428229](https://github.com/atto-lang/atto-source.forge/actions/runs/44683428229)
failed before either GCC/Clang job executed a step. The full existing
CMake regression suite, all 36 conformance cases, OS-process return ABI
parity, independent CI and 11-backend parity remain unverified. Historical
local evidence at parent `60e667238f943e4b6b47c0e4d0f603ad2b440ef5` is
preserved separately in the ledger.

### Forge restricted pointer: real LOCAL guest execution, still not full CI

[Forge #50](https://github.com/atto-lang/atto-source.forge/pull/50)
at exact source SHA `60e667238f943e4b6b47c0e4d0f603ad2b440ef5`
now has a [SHA-pinned local execution receipt](https://github.com/atto-lang/atto-source.forge/pull/50#issuecomment-7031453507).

Both GCC 14.2 and Clang 17 actually compiled the Forge compiler from
Git-blob-verified source, compiled all four Atto positive cases to native
C++20 executables using ASan/UBSan and executed them: logical outputs
42 / 42 / 42 / 13. Both rejected all **24 actual invalid Atto files** with
no emitted C++ artifact, even after a stale output file was created. The
exact checked-in CMake guest test passed for both compilers, as did
the typed-HIR and existing scalar lexer/parser/emitter tests. The
canonical rt-vs-bang codegen C++ SHA-256 was
`088b8c56d2d2cd87b56c99b33dd423038f7929a859465ebd55c7b29e3acd31d6`.

**This is local partial executable evidence only.** The full existing
Forge CTest suite, 36-case registry, all 11 backends, exact-head external
GitHub Actions CI and full native process-result ABI remain unverified.
The latest Forge [Actions #44664843939](https://github.com/atto-lang/atto-source.forge/actions/runs/44664843939)
failed before any steps. The authoritative `execution_status` is kept
`NOT_EXECUTED` for the full conformance gate; the distinct
`local_compiled_guest_subset` field captures the bounded positive
evidence without certifying more than it tested.

### Fourth compiler candidate: Forge native bounded Pointer<int>

[atto-source.forge #50](https://github.com/atto-lang/atto-source.forge/pull/50)
pins compiler head `60e667238f943e4b6b47c0e4d0f603ad2b440ef5` and native
`include/atto` tree `151c08add7df9db670033b27bcefdba36f61753b`.
The canonical PRL-001/002 Atto input blobs match exactly. The Forge
frontend now has candidate typed local-ref parsing and emits restricted
native C++ stack-pointer read code, not owning allocation.

CTest has been authored to compile four real native guest binaries under
GCC/Clang and ASan/UBSan and reject 24 invalid sources before C++ output.
**Both jobs in exact-head run #44664843939 failed before any steps executed**,
so Forge remains **NOT_EXECUTED**.

Forge stage-0 guests print main's logical scalar (e.g. 42) and exit 0,
not the same process-return ABI as the Rust/Wasm, LLVM and .NET targets.
This is an explicit remaining compiler ABI parity gap and can never count
as a full-result/36-case pass without separately verified contract
alignment. Lexer/parser overlaps with Forge #44/#42/#49/#36 must be
resolved before merging.

### Exact private mirror attempt — mainline Rust/Wasm PR #419

A private, token-free carrier has been built at
[gha-indie-worker/atto-ci](https://github.com/gha-indie-worker/atto-ci/tree/ci/atto-pointer-mainline-419-exact-20261120)
(commit `a7c7efe5652e8db406bc37b1fe2226eb10a439a3`).
Git readback verifies the complete compiler `src/` tree
(`274523e1adffc85c4f86c84e1983917ff089d4e0`), Cargo metadata,
pointer Rust integration test, and the canonical PRL-001/002 source blobs
against exact `atto-source.rs #419` source commit
`00a6d3e8a86e27f635cf3b2a808b6a0b61a2b977`.

The dedicated workflow compiles real native and wasm32 compilers, executes
two actual guest modules and checks six invalid sources for no artifact.
**Run #44662256278 failed twice with ZERO executed job steps.**
This is a RUNNER_ADMISSION failure, not a compiler verdict.
See the `token_free_carrier` ledger record; its executable/artifact hashes
remain null and every backend remains `NOT_EXECUTED`.

## Compiler candidate ledger: exact source heads, zero execution receipts

The separate [source-only candidate ledger](../contracts/pointer-local-candidate-evidence-v1.json)
tracks four reviewed draft implementation heads: Rust/Wasm mainline-safe (PR #419; overlap with checked-handle PR #264), LLVM native AOT (PR #64), .NET CIL / NativeAOT (PR #22), and Forge restricted native C++ guest AOT (PR #50).
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
