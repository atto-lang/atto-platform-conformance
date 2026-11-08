# AttoLang cooperative execution checkpoint contract v1

**Scope: source-free contract, JavaScript host reference oracle, and evidence-shape tests only. No compiled guest or production sandbox is certified.** The existing Java 64-backedge/512-reduction scheduler contract is not silently changed here.

## Two-tier fast and slow path

A compiler should inject a strictly positive and bounded fuel charge on every reachable cyclic control-flow path. For the default interval 128, every charged basic block (including a backedge) updates a cheap actor-local counter; a bitmask enters the expensive scheduler/cancel/deadline path only once per 128 charged blocks. Reading the actual monotonic clock must happen **only inside the slow path**, never eagerly at every backedge. Allowed intervals: 32, 64, 128, 256, 512. Fuel exhaustion is a separate immediate denial, even between periodic polls or inside a critical region.

Conceptual MIR, not executable AttoLang syntax:

    on_actor_entry_or_resume:
      validate_unforgeable_logical_fuel_cpu_deadline_and_cancellation()
    on_instrumented_basic_block_or_backedge:
      charge_positive_bounded_basic_block_cost_or_fail_stop()
      counter = wrapping_u64_add(counter, 1)
      if (counter & 127) == 0:
        now = monotonic_clock_read()  # only on the expensive path
        validate_deadline_cpu_and_cancellation(now)
        if trusted && safe_borrows_and_locks: publish_resumable_step()
        else if trusted: defer_handoff_until_critical_exit()
        else: continue_without_unsafe_guest_stack_suspension()

Never reschedule a borrowed or locked guest stack by implicit preemption. A blocked foreign call can take arbitrarily long between loop backedges; neither the bitmask nor a cooperative 4ms watchdog promises hard wall-time bounds. Native foreign code and hostile tenants need enforceable isolation, independent termination and tested neighbor survival. Browser Worker termination is not an OS tenant security boundary.

## Required backend integrations

1. Add stable observable MIR ChargeFuel(cost) and Checkpoint operations, and a post-optimization CFG/bytecode/native verification step so optimized loops cannot bypass charges.
2. Meter all cyclic paths including nested and continue edges, recursive SCC call entries and stack depth, straight-line weighted blocks, allocations, async resume and outbound FFI. Admit only bounded positively charged guest operations; reject unknown-cost unsafe paths.
3. Keep each logical untrusted task's wall deadline, per-carrier CPU deltas, saturating fuel, **and outstanding sampling-counter remainder** across every await, callback, worker dispatch or carrier migration. Frequent resumes must not starve clock/cancellation polls. The interval is immutable after runtime admission.
4. Preserve critical-read/write, mutex and borrow authority: defer cooperative handoff, but never defer exhausted quota denial.
5. For LLVM/Forge/.NET native AOT and JVM/Graal, use independent process/isolate enforcement for hostile FFI; for Wasm use bounded runtime fuel/epoch, validated imports/Store and termination; for JS use worker/process isolation plus verified generated guards. Implement only what each backend actually supports.
6. Prove behavior with real compiled .atto guests at exact commit/tree/artifact/fixture hashes, source-scoped CI run ID/attempt/job ID and observed executed steps. Re-run at current target after optimization and compare performance at allowed intervals.

## Conformance and evidence

The cooperative-execution-v1 manifest lists 17 cross-backend conformance obligations over Java, LLVM, Wasm, Forge, .NET and JS. The host model includes additional tests, including exhaustive small-graph checks and large control-flow stress cases. Every backend starts NOT_EXECUTED. The cooperative-meter.mjs file is a source-free host oracle. Its cycle and call-graph checks are conservative and do not replace actual final compiler IR validation.

The verifier rejects missing or malformed source/tree/fixture/artifact hashes, zero-step CI runs, mismatched backend run URLs, wrong outcomes, host-only masquerading as compiled guest, and missing hard-kill evidence. It only validates receipt structure: SHA-shaped strings and plausible Actions URLs do not authenticate CI, a runner, artifact origin or independent enforcement. A reviewer must separately read the exact workflow run, job steps, artifacts and guest transcript before changing any NOT_EXECUTED claim.

Local commands:

    node bin/verify_cooperative_execution.mjs
    node --test tests/cooperative-execution*.test.mjs

Neither command executes an AttoLang compiler. Keep this work separate from private-source export/mirror approval and security incidents. No cross-organization private source transfer is authorized by this contract.

## Security audit follow-up (2026-11-08 UTC)

The reference model now protects its sampling interval in a private field, carries its 64-bit sampling counter across logical resumes, polls charged straight-line blocks as well as backedges, and fails closed on critical depth exhaustion, malformed FFI descriptors, clock-source errors and reentrancy. Both CFG and recursive-call admission proofs use bounded iterative graph traversals with a 65,536-edge input cap; this prevents the verifier itself from exhausting its JS call stack on deep hostile graphs. The manifest validator pins all 17 obligation identities and outcomes, mandatory receipt fields, and independently enforced hard-kill cases against accidental downgrades.

The host model supports a host-supplied **lazy monotonic clock thunk** invoked only at the slow poll. Synthetic numeric timestamps are allowed for test determinism; in a real backend, the monotonic clock must be runtime-owned and not derived from untrusted guest data. No true wall-time guarantee follows from cooperative metering alone; independently killable boundaries remain required for hostile calls.
