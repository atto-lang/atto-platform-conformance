# AttoLang cooperative scheduling — common 128/512 contract (2026-11-09)

**Evidence class:** SOURCE-FREE REFERENCE ONLY / NOT CERTIFIED. This draft is stacked on conformance PR #589. It does not authorize private-source transfer, untrusted auto-cooperate, or a release merge.

## Normative model targets

- One **cheap** counter/phase operation at every committed backedge; fixed **128**-backedge *slow* scheduler poll. A short physical dispatch, await, carrier migration or saturated total cannot reset or suppress the logical polling phase.
- **512** reductions = a **soft** physical fairness target, never a tenant hard-fuel quota. An overdue no-yield request remains sticky until an actual recorded legal cooperate handoff. A guard-exit hint does not itself authorize suspension.
- One-use polling tickets: unscheduled/duplicate checks must not perform clock or watchdog slow-path work. Hard untrusted fuel and cancellation are independent of, and cannot be amortized by, these soft polls. Untrusted implicit cooperation remains disabled until independently certified.
- Signed clock regression, signed overflow, and mathematically huge elapsed intervals must fail closed. Clock samples are cold-path-only except the physical-dispatch and real cooperation timestamp operations.
- Suspension requires a committed heap continuation, completed effects, released critical/borrow guards, and safe actor single-writer/ownership handoff. Long FFI/host instructions remain an explicit watchdog containment gap.
- A source-free model and host-only C++/Java smoke cannot certify general source-compiled guests, true one-carrier multi-actor fairness, Native Image, tenant isolation, or hard real-time preemption.

## Shared fixture and source-free tests

- Fixture: `fixtures/safepoints/cooperation-128-v1.json` (five-backend guest statuses **NOT_EXECUTED**, no fabricated PASS evidence).
- Tests: `node --test tests/cooperation-128-regressions-20261109.test.mjs`.
- Covers 127/128/129, 511/512/513, 640, eight 127-edge redispatches, 512 guard-deferred debt, one-use watchdog tickets, signed clocks, 64-bit saturation, and untrusted logical fuel persistence.

## Candidate reconciliation

- Java #2655 + stacked #2723: keep #2655's per-edge untrusted quotas and overflow-safe clocks, #2723's lifetime phase/single-use ticket, and its sticky handoff debt. Parallel #2657 has overlapping phase tests; avoid reapplying its unsafe raw signed time subtraction.
- LLVM #1571 + stacked #1624: keep #1571's 128 interval, saturation-safe independent phase and non-refillable scalar AOT fuel; #1624's overflow-safe clock and sticky handoff debt. Review #1570/#1572/#1574 separately for their extra guard-exit/no-yield tests; #1572 defaults to 64 and has distinct semantics and therefore is **not** drop-in parity.
- Wasm #434, Forge #223 and .NET #401 remain **guest NOT_EXECUTED** for this common 128/512 cooperative contract. .NET's 128 CFG-block visits / trap-only prototype is not reduction-level suspension.

## Release/evidence gates

1. Source-org workflow admission must allocate a runner and execute at least one step; issue LLVM #159 is still open. Admin must establish reason from GitHub annotations/billing/runners, not guess exhausted minutes.
2. Execute exact-head Java JDK25 Maven/JUnit and LLVM compiler + native CTest under GCC/Clang, O0/O2/O3, ASan/UBSan where applicable, with no skipped/absent cases and immutable SHA receipts.
3. Run actual source-compiled two-actor **same-carrier** fairness tests, critical/borrow, cancellation, recursive loops, fuel lifetime, synthetic checkpoint-erasure mutants, and watchdog-escalation negative controls.
4. Independently review source-export incident #22 before any alternate-org private compiler mirroring; private status and available Actions minutes alone are insufficient security authorization.

Do not mark the five backend evidence statuses PASS based solely on the Node oracle.
