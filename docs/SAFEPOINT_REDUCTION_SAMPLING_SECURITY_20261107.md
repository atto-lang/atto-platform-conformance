# Safe-point sampling and UNTRUSTED actor handoff — 2026-11-07

**Status: source-free policy model only. NOT_EXECUTED / NOT_CERTIFIED for all
real Java, LLVM, Wasm, Forge, Rust/browser and .NET guests.**

## The checkpoint contract

A cheap counter may be incremented after each **committed** loop backedge.
The hardened Java candidate and current LLVM fixed-cadence drafts target a
**128-backedge** slow-scheduling poll, including after the **512**-backedge
soft fairness target. Expensive runtime/clock/watchdog inspection must **not**
begin running on every iteration after 512. A stale `probeDue=false` cannot
suppress a scheduled checkpoint at 512, 640, 768, etc., but an unscheduled
513/575/641 backedge performs only its cheap counter updates. An explicit
compiler-proven guard-exit can request a one-off check independently.

The 512 reduction threshold is **not hard execution fuel**. After a guarded
handoff is deferred at 512, the next periodic slow-poll opportunity is 640,
not 513. A newly runnable peer may be delayed by at most 127 additional
committed backedges at that point; an individual backedge may still be
arbitrarily expensive, so no hard wall-time guarantee follows.
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
is missing, do not discard the reduction debt for the next scheduled poll.

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
covers 8192 backedges, periodic mandatory probes after 512, stale
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
