# Strict guest AOT / zero tracing-GC source-free adversarial model

**Status: SOURCE-FREE MODEL ONLY / NOT_EXECUTED as guest evidence / NOT_CERTIFIED.**

This test suite is a Rust-only synthetic admission model. It does **not** invoke
AttoLang compilers, linkers, a native or Wasm guest binary, GitHub's authenticated
APIs, a GC/allocator probe or a trusted workflow outside the PR head. No test
in this PR establishes true backend parity, an approved source export, a
release gate or native AOT support.

## How to run the proposed model tests

```sh
rustc --edition=2021 -D warnings --test tools/strict_guest_aot_gc_model.rs -o /tmp/strict-guest-aot-gc-model-tests
/tmp/strict-guest-aot-gc-model-tests
```

This model suite has 38 individually named Rust `#[test]` functions, including
mutation loops across required negative and positive classes. The accompanying
workflow pins the submitted PR head for checkout. **The source organization
currently fails Actions before runner step execution:** a created workflow
check by itself is neither proof that Rust tests ran nor compiler evidence.

## Negative compiler-before-IR matrix (16 classes)

| Required rejection | Boundary |
| --- | --- |
| `eval` | No dynamic source code evaluation |
| Runtime class creation | No new classes in sealed guest AOT |
| Runtime method creation | No late code generation or monkey patching |
| Open-ended reflection | Only static finite metadata |
| Unknown proxy target | Compile-time type/interface known |
| Private proxy escalation | Preserve method visibility |
| Erased dispatch edge | Preserve complete linker reachability |
| Escaping borrow | Reject invalid loans across suspension |
| Unrestricted strong cycle | Approved region/weak cycle strategy |
| Closure transported in channel | Sendable payload only |
| Stale actor generation | Prevent obsolete authority/reuse |
| Missing cleanup | Exactly-once frame/heap release |
| Ungoverned module loading | Sealed mode uses only prelinked code |
| Interpreter/JIT fallback | No hidden fallback in sealed AOT |
| Unbounded admission/quota | Bounded resource acquisition |
| Non-Sendable transport | Actor isolation and capability checks |

A future backend integration must supply canonical `.atto` fixture SHA,
executed compiler identification, a stable diagnostic and an **observed**
rejection before executable IR for **every** row. Source-only fixture
existence, parser-only checks and self-reported success do not meet this gate.

## Positive compiled guest matrix (8 classes)

- Virtual dispatch and complete static reachability.
- Statically generated proxy forwarding with valid receiver/effects.
- Owned closure capture in emitted code.
- Long-lived actor churn with independent allocation domains.
- Suspended task-frame cancellation and exactly-once cleanup.
- Module/actor generation retirement after all outstanding I/O loans.
- Bounded quota exhaustion and OOM failure paths.
- Sendable move/copy/share through actor/channel boundaries.

For each case: require emitted artifact digest, actual guest invocation,
allocator observations and exact source/fixture identity. Host-only emulation,
Java Native Image or .NET NativeAOT **host** compilation alone, Wasm Worker
simulation, or a stage-0 scalar oracle is insufficient.

## Adversarial evidence checks in the Rust suite

The synthetic model rejects stale/uppercase/zero SHAs, commit/tree mismatches,
unbound artifacts, invalid compiler/artifact digests, cross-repository source
transfer, self-review, absent or unprotected trusted review/workflows, missing
runner or attempt, zero/partial/duplicated steps, failed jobs, interpreter/JIT
fallback, unexecuted guests, uninstrumented allocations, incomplete/duplicated
positive and negative fixtures, and post-IR rejection disguised as an
early diagnostic.

It checks representative Java/GraalVM, LLVM, .NET NativeAOT, Wasm, Forge and
Cranelift target families; JavaScript transpilation is explicitly **not**
represented as native sealed guest AOT. Managed host garbage collectors and
guest zero tracing-GC remain distinct; stronger process-zero-GC claims require
separate proof. A synthetic model `Ok(())` is **only** a model candidate,
never release authorization or a verified receipt.

## Relationship to current work

- [Canonical spec chapter 22](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/18): target design, independent review pending.
- [Organization policy #38](https://github.com/ores-truffle-oreslang/.github/pull/38): review policy draft.
- Backend documentation: [LLVM #1559](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1559), [Wasm #428](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/428), [.NET #398](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/398), [Forge #220](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/220), [Cranelift #96](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/pull/96).
- [GitHub runner-admission blocker #315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315) and [private-source security gate](https://github.com/ores-truffle-oreslang/.github/issues/2).

**Next real certification step:** independently reviewed spec and protected CI
policy; exact-head runner with named nonempty executed steps; real backend
compiler-negative test suite and compiled positive guest artifacts under
sanitizer/allocator instrumentation. None is supplied by this source-free
model. No cross-organization private source transfer is authorized here.

## Audit hardening — synthetic replay and completeness boundaries

Adversarial review identified three previously untested false-positive patterns:
individual failed/skipped steps hidden by job-level success, stale approval or
runner-attempt metadata attached to a different exact head, and repeated fixture
digests standing in for the entire 24-case matrix.

The hardened model requires **exact-head approval state**, aligned source/job/run
SHA and attempt, a manual-dispatch exact checkout proof, each step's unique
nonzero index and matching job/attempt, successful terminal step metadata and
recorded logs, and **distinct SHA-256 fixture digests** for all 16 negative
and 8 positive classes. The model includes regression tests for each rejection.

**All fields remain synthetic and caller supplied.** This cannot authenticate
GitHub, prove compiler execution, certify guest code or authorize release.
The source-org Actions workflow is still blocked before runner allocation;
therefore new Rust test execution remains NOT_EXECUTED pending stepful CI.
