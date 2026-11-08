# Safe-point sampling and UNTRUSTED actor handoff — 2026-11-07

**Status: source-free policy model only. NOT_EXECUTED / NOT_CERTIFIED for all
real Java, LLVM, Wasm, Forge, Rust/browser and .NET guests.**

## The checkpoint contract

A cheap counter may be incremented after each **committed** loop backedge.
Trusted Java/GraalVM and LLVM fair scheduling sample a clock/checkpoint at
every 64th completed backedge until a 512-backedge reduction cap. Once
the reduction cap is due, the next post-commit boundary and **every**
subsequent committed backedge must test potential cooperation. An stale,
incorrect or manually suppressed `probeDue=false` is not allowed to mask a
reduction cap. This source-free conformance model now explicitly enforces
that invariant.

The first 511 completed backedges may defer a time-based scheduling probe
until the next batched boundary; the reduction cap overrides batching.
This does **not** permit UNTRUSTED security accounting to be batched: each
UNTRUSTED loop backedge still requires a real fuel/cancellation check.
Safety checks on calls, allocations, recursion and potentially expensive
loop bodies must be separately instrumented; source lines are never
trusted preemption boundaries. No fair-scheduler quantum is a hard
wall-clock deadline.

At any overdue poll, these remain mandatory: a heap-resumable
continuation, side effects already committed, no held live borrows,
critical sections, mutex guards or uncaptured host frames, valid cleanup
state, actor single-writer and carrier-exit fencing. If a runnable peer
is missing, do not discard the reduction debt for the next backedge.

## Untrusted source-level cooperation gate

Conserved fuel/wall/CPU across `await` and task migration is necessary but
**not sufficient** to enable source `rt cooperate` or implicit loop
cooperation. The canonical Java runtime keeps both disabled for UNTRUSTED
source turns. The admission model therefore requires an additional
`untrustedCooperationCertified` condition, defaulting false, only for
those two handoff kinds. It does not change ordinary continuation-backed
`await` admission with a continuous logical quota.

This is **only a policy simulation input**, not a guest-controlled flag,
runtime authorization token or production switch. No source PR may
enable the corresponding behavior until actual compiler + runtime
continuation/cleanup, scheduler cancellation, quota continuity and
revocable isolate checks pass with independent evidence.

## New deterministic conformance regression

The Node `safepoint-checkpoint-amortization-20261107.test.mjs` matrix
covers 8192 backedges, mandatory probes after 512, stale
`probeDue=false`, reduced/fresh physical dispatch, various live-loan
and partial-effect denial cases, no-runnable-peer behavior, untrusted
cooperation prohibition, and rejection of fractional/unsafe JS counters.
It cross-checks the **model only**, not generated Java/LLVM/Wasm guest
execution. The existing admission fixtures separately cover quota
continuity and explicit certification.

Suggested source-free local command:

```sh
node --test tests/safepoint-contract.test.mjs \
  tests/safepoint-budget-reentry-20261105-wave6.test.mjs \
  tests/safepoint-checkpoint-amortization-20261107.test.mjs
```

An acceptance claim must include exact source SHA/tree, non-empty
executed CI jobs/steps with successful exits, original source blob
provenance, real guest loop and recursion run results, timeout/kill
receipts, and unaffected neighbor tenant results. A failed workflow
before runner admission, an empty job steps list, a source-only test,
or a static source grep **never** certifies execution.
