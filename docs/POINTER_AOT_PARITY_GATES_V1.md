# Pointer<T> / native AOT conformance gate (draft)

**Reference model only.** The C++20 model in models/pointer_capability_aot_v1.cpp is deliberately **not** AttoLang source, a compiler plugin, or a generated AttoLang native binary. Its host-language & and * operators are permitted **inside C++**; AttoLang must reject unary & and unary * for pointer manipulation. See atto-spec/language/pointer-aot-safety-v1.md in the related draft.

## Audit status on 2026-11-15

| Target | Evidence | Pointer<T> status |
| --- | --- | --- |
| atto-source.rs browser Wasm compiler | Emits a restricted compiled-guest Wasm subset. Separate draft #133 refuses Pointer<T> and unary &/* syntax. | UNSUPPORTED (negative gate proposed; exact-head CI not executed) |
| atto-source.llvm | Main branch is a backend scope README, not a demonstrable complete pointer AOT implementation. | NOT_EXECUTED |
| atto-source.java / GraalVM Native Image | Main branch is a backend scope README. | NOT_EXECUTED |
| atto-source.net / .NET Native AOT | Main branch is a backend scope README. | NOT_EXECUTED |
| atto-source.forge | Main branch is a backend scope README. | NOT_EXECUTED |
| atto-source.wasm | Main branch is a backend scope README. | NOT_EXECUTED |

Independent staged PRs may contain other prototype work; this table does not invalidate them. Promote a target to PASS **only** after real compiled pointer guests run against an immutable source/compiler/artifact receipt.

## What the reference model proves

The finite two-slot, 16-element C++20 reference model checks 17 assertions for valid loads/stores, one-past-end, large index denial, read/exclusive loan incompatibility, failed-send rollback, foreign-tenant rejection, successful move with old-generation revocation, permanent freeze, close/revocation, overflowing allocation request and zero-size region denial.

Local verification on 2026-11-15 against model blob SHA **9c0f018d457f08400a707e4e4e43477d7408301b**:

- g++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic: 17/17 passed.
- clang++ -std=c++20 -O1 -g -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -fno-omit-frame-pointer: 17/17 passed.

The model has no thread scheduler, real actor runtime, compiler output or FFI. It cannot prove correct native AOT lowering, hard real time, low/zero guest GC or multi-backend parity. Its pointer aliases are model Handle values, not machine addresses.

## Required backend release gate

1. Compile AttoLang source that instantiates Pointer<int>, a non-Copy resource Pointer<T>, and a compound graph with reachable owned fields; do not interpret it.
2. Verify pre-lowering rejection of unary &/* pointer syntax, forged handles, duplicate mutable borrows, escaping loans, use after take, post-close use, cross-domain pointer bytes, open-world generic T, and unlisted FFI.
3. Emit a pinned closed-world AOT native application or compiled Wasm program; show static specialization, region layout, drop graph, artifact SHA, source tree SHA and compiler SHA.
4. Execute guests under bounds, overflow, restart, cancellation, concurrent transfer and memory-revocation adversaries; verify controlled failure instead of undefined behavior.
5. Native gate: LLVM with Clang ASan/UBSan, GraalVM Native Image genuine executable, .NET NativeAOT genuine executable, Forge genuine native executable. Wasm gate: actual Wasm compilation and engine execution. All need real nonempty job steps with artifact provenance.
6. Report each backend precisely as PASS, FAIL, UNSUPPORTED or NOT_EXECUTED. Source-free C++ model passes do not upgrade backend status.

Closed-world proofs must comply with atto-target-profiles/docs/CLOSED_WORLD_AOT_PROOF_V1.md, and actor transfer semantics with contracts/pony-reference-capabilities-atto-v1.json.
