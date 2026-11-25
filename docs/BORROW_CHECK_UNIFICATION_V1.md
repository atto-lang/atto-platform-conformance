# Candidate canonical AttoLang borrow-checker contract (2026-11-10)

**DRAFT — SOURCE-FREE — NOT_EXECUTED — NOT_CERTIFIED.** This document and its 22-case source-free JavaScript reference oracle cannot certify any backend. It never runs a .atto compiler or guest. All backend states are pinned to NOT_EXECUTED.

## Architectural decision

Define ownership and borrow semantics **once**, distribute a versioned compiler-produced MIR contract and adversarial conformance cases across Java/GraalVM, .NET NativeAOT, LLVM, Wasm, and standalone Cranelift. Do not maintain five divergent language definitions. Each backend may implement a verified native algorithm or call the same independent Rust analysis core, while retaining backend-specific heap, code-generation, runtime, actor-incarnation and region-lifetime enforcement. Forge is a distinct further backend that should join this protocol before a full oreslang-source.* parity claim.

## Minimum shared rules

- An owned value may be moved once; every reachable successor sees the move. No owner use after take/drop; exactly-once cleanup and cancellation are production obligations.
- Multiple shared readers or one exclusive mutable borrower per overlapping root. Fields conservatively alias the root until sound, typed disjointness witnesses exist. End loans on lexical and exceptional exits.
- Copy needs independent compiler-derived Copy proof; Send never implies Copy. Moving a Task capture requires Send. A borrowed view cannot be promoted to an owned Send value. An actor or tenant hop cannot transfer a raw loan.
- A live loan cannot cross await, suspension, blocking select, continuation capture or FFI without a separate, verified pinned-continuation/owner-generation proof. OS thread ID is not logical Task or actor authority.
- Guard predicates, false edges, if/for/match branches, try/catch/finally/defer/recover, and cancellation must preserve ownership effects. Per-arm body moves can remain branch-local. Semantic rejection must occur after successful parsing, with explicit diagnostic and no executable output.
- The miniature oracle conservatively rejects divergent branch joins and loops. **This restriction is not proposed as the final language rule**: full frontend parity needs typed SSA place identities, path-sensitive cleanup, sound fixed-point loops, alias analysis, interprocedural effects, and exceptional/suspend CFG edges.
- Typed compiler IR must include canonical owner IDs, projection roots, verified Copy/Send witnesses, actor/tenant/generation domains, CFG edges, explicit scope drops and effects. Never trust user-provided JSON as typed compiler MIR.

## Verification order and evidence

1. Pin every backend's PR head, source tree, exact-blob fixture IDs, compiler binary, workflow run and job IDs.
2. Prove runner admission and nonzero executed steps before accepting any test result. Zero-step failures are CI/admission problems, not semantic test failures.
3. Run real production compiler semantic negatives with stable diagnostic categories, no emitted IR/CIL/CLIF/Wasm/AOT artifacts, and independent positive .atto guest controls. Parser-only and unsupported-feature rejection are **not** ownership proof.
4. Run actor ownership, suspension/cancel, exceptional exits, FFI, sanitizers, Native Image/NativeAOT and real guest parity on exact heads. Only independently authenticated receipts may change a future evidence registry.
5. Review Java PRs 2687/2689/2691, LLVM 1598/1610/1615/1627, .NET 418/429, Wasm 444, Cranelift 97, experimental oreslang-static-analysis.rs, and conformance draft PRs 624/626/627 for compatible semantics before integration.

This proposal adds only a source-free candidate model and regression suite, not a release or merge-readiness assertion. No backend source or existing draft branch is changed.
