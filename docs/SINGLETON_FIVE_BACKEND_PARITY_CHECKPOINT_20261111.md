# AttoLang singleton and shared-region five-backend parity checkpoint

Snapshot date: **2026-11-11**. This is a source-level implementation/evidence
checkpoint, **not a claim of certified guest parity**. Shared immutable
`define singleton` identity and guarded runtime-owned mutable regions are
different capabilities. No singleton may turn actor-private state into a raw
shared mutable pointer.

## Exact source PR heads at checkpoint

| Backend | PR | Head SHA | Actual scope | Evidence classification |
| --- | --- | --- | --- | --- |
| Java/GraalVM singleton | [#2749](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2749) | `3e35afcc917494894622d1af5f7dc57f7a2d8337` | Real Java lexer/AST check-only, 12 authored JUnit tests, runtime refuses execution | NOT_EXECUTED guest |
| Java/GraalVM RW | [#2747](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2747) | `4a8fb826848e4e93067c6e9011ecce501408e461` | Logical-execution/slot/generation RW ledger; 3/7/15 writer-fairness JUnit added | NOT_EXECUTED at head |
| LLVM native | [#1203](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1203) | `5554ef7dd730eaa97071c943ebc2f57229db8e7a` | Production-parser fail-closed singleton admission + expanded native CTest | NOT_EXECUTED at head |
| .NET NativeAOT | [#267](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/267) | `e7f5337378a5b302e5daa77883d3414779cd0a6b` | Both frontends deny unsupported source; host stage-0 async once-cell, retirement/cycle checks and 3/7/15 CLR carrier burst | NOT_EXECUTED at head; not guest |
| Wasm | [#477](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/477) | `3e73d029e6e5466f5e318a3e5ed2e3407bd3de7e` | Pinned LLVM diagnostic must be authentic one-line admission, adversarial stdout/stderr checks | NOT_EXECUTED at head; not guest |
| Forge | [#146](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/146) | `c0f1eaf39f4bd9c08c7b0beb78ad236a3c5301f1` | Internal compiled scalar stage-0 initializer + trusted host once-registry; 3/7/15 carriers | NOT_EXECUTED at head; not general guest |
| Forge bound dispatch | [#159](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/159) | `a43884b8cec0a6657cfc8dfb0cd1ffd5eabfb5ba` | Stacked actor-dispatch-lease hardening, **not automatically included in #146's new head** | NOT_EXECUTED at head |

Wasm's earlier singleton admission [#191](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/191)
is **merged**; it does not certify the pinned LLVM compiler or release artifacts.

## Frozen acceptance requirements (do not downgrade)

Reference: merged [conformance #242](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/242)
and additive cross-slice [#662](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/662),
actor/supervisor [#656](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/656).

1. Preserve source keyword `define singleton`, compiler/linker-owned
   (domain, module, declaration) identity and alias canonicalization.
   Exactly one full immutable publication per live application domain;
   failures are sticky, and cycles/prepublication receiver escapes are denied.
2. Immutable snapshots are transitively immutable, bounded and cannot
   contain actor refs, mutable memory pointers, FFI handles, or capabilities.
   Cross-process/Graal native-isolate/Wasm Worker identity needs explicit
   trusted coordination. A static map is not cross-isolate shared identity.
3. Runtime-owned shared mutable region: **one semantic owner**, authenticated
   scoped grants to logical execution + generation + region epoch, multiple
   readers or one writer, bounded writer-fair FIFO admission, no recursive
   upgrade, and no raw supervisor access to a child's actor-private heap.
4. Reject unsafe alias escape/use-after-take, `await`, `select`, yield,
   cancellation continuation, nested cross-region loan without order proof,
   forged/stale grants, actor STOP/restart ABA and FFI escapes.
5. STOP revokes logical authority immediately, but physical loans, guest
   turns, completion callbacks and FFI pins block reclamation until drained.
   No carrier parking while awaiting grant admission.
6. Run frozen 20 cases as **compiled guest** positive and compile-negative
   checks separately for each actual target. A parser-only denial, .NET
   host CLR task, C++ test-host registry, Node model or source-free audit
   cannot be promoted to `guest_pass`.

## Minimum exact-head execution commands

- Java singleton #2749: `mvn -B -ntp -DfailIfNoTests=true -Dtest=SingletonCheckOnlyTest test`
  on its own PR head; then add a real guest publication integration fixture.
- Java RW #2747: `mvn -B -ntp -DfailIfNoTests=true -Dtest=ActorSupervisorUniqueOwnerRwTest,ActorStateRwLoansTest test`
  on its **different** PR head and stacked base. Do not pretend these two
  independent Java PR heads form one tested code tree.
- LLVM #1203: build native production parser on the exact source tree, then
  `ctest --test-dir build -R native_singleton_admission --output-on-failure`;
  run generated guest and sanitizer profiles in a separate stage.
- .NET #267: run the actual `Ores.Net.Tests` harness on pinned runtime +
  compiler source; repeat under real NativeAOT binary and report that
  artifact separately from host `SingletonCellStage0` checks.
- Wasm #477: `node --test tests/real-compiler-gate.test.mjs`
  exercises the assertion only; pin and execute the LLVM compiler to produce
  a real `wasm32` guest artifact and run it in an actual Worker.
- Forge #146: run its CMake/CTest suite and
  `scripts/test-singleton-shared-runtime.sh` release and sanitizer
  profiles; separately reconcile stacked #159 dispatch-lease authority.

All successful receipts must include exact source head and tree, source blob
hashes, runner and job IDs, **nonzero executed steps**, compiler executable SHA,
full test inventory and zero failures/errors/skips for required cases, guest
binary hash and native sanitizer/AOT/Worker evidence where applicable.
A failed pre-runner job is `NOT_EXECUTED`, not a compiler failure.
Do not publish private source into another organization without explicit
destination authorization and independent review.

## Current blockers / smallest next gates

- Source-org GitHub Actions jobs at inspected Java #2747 and Wasm #477 heads
  failed with `runner_id=null` and `steps=null`; no test execution can be
  inferred from these workflow conclusions. Other backend workflow coverage
  at their new heads has not been positively verified.
- #662 has 29 authored tests (not current-head executed). #656's separate
  exact-blob alternate-private-runner 44/44 model receipt **cannot** certify
  #662 or any backend compiled guest. Its general harness had **13 actual
  executed failures** that require triage.
- **P0:** fund/authorize one exact-head compiler-backed Java test runner
  and verify check-only JUnit + RW JUnit separately before combining PRs.
- **P1:** implement Java immutable singleton guest lowering, then apply the
  same shared 20-case fixture and its result/negative diagnostics to LLVM,
  .NET NativeAOT, Wasm worker, and Forge. Do not make unsupported
  syntax behave as successful compilation.
- **P1:** fully authenticate and pin runtime-owned shared regions and
  physical turns in each runtime. Existing test oracle and stage-0 host
  code cannot establish allocator/borrow-checker parity.
- **P2:** independent security and ABI review, validated release provenance,
  then staged merge after each required backend has real guest receipts.
