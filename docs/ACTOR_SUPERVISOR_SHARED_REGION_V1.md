# AttoLang: actor/supervisor shared-region ownership + fair RW admission V1

**Status: executable source-free specification only, not implemented compiler/runtime semantics.**

## Safety invariant

For a region `R`, at every instant there is at most **one semantic owner**:

```
owner(R) ∈ {Actor(actor-id, incarnation), Supervisor(supervisor-id), None}
∀R: count(valid_owner_tokens(R)) <= 1
```

Borrowing is NOT ownership transfer. A single owner may authorize several
simultaneous **immutable scoped reads**. A **mutable scoped borrow** has exclusive
access to the whole affected place/alias set (unless a finer verified field
projection proves disjointness). A supervisor's parent/control status does not
implicitly authorize raw reads, writes, use-after-move, or reclamation.

```
active_writers(R) ∈ {0,1}
active_writers(R) == 1 ⇒ active_readers(R) == 0
active_readers(R) > 0  ⇒ active_writers(R) == 0
```

A lock admission ticket is not a proof of ownership: *both* compile-time
lifetime/provenance/alias checking and runtime authenticated RW admission are
necessary. The production implementation must couple them atomically to the
protected state access; never trust a stale `heldBy()` check followed by an
unrelated raw read or write.

## Borrow-checker rules (language level)

- `rt borrow` is scoped immutable access. `rt mut borrow` is scoped exclusive
  mutable access. Neither operation confers ownership or allows a raw mutable
  escape to a supervisor, child, task, closure, FFI bridge, channel, or pub-sub.
- Within a lifetime, every material alias of the same root/place contributes to
  the exclusion check, including projections, indirect fields, arrays, and
  captured/aliased references. A frozen binding is **not** automatically deeply
  immutable.
- The compiler must reject a write loan if any overlapping read/write loan
  exists; reject a read loan if an overlapping write loan exists; reject
  reentrant upgrade/downgrade until it is separately proven.
- A cross-boundary loan requires a *typed, one-use, scoped grant* bound to the
  owner, recipient execution and region incarnation; a boolean "has lock"
  attestation is not sufficient. The owner remains unique even while another
  execution holds a delegated read ticket.
- No `rt take` / owner move with an outstanding loan, queued reservation,
  unpublished completion, or active guest turn. Move revokes old authority,
  all stale capabilities, and bumps a monotonic region/owner epoch.
- For V1, reject loans spanning `await`, `suspends`, task cancellation/escape,
  actor hops, and generator yield. Later nonlexical-lifetime refinement may
  permit some bounded suspension with an explicit continuation-safe protocol;
  do not silently admit it today.
- Compile-time check happens in each backend's type-check/MIR pass; host-only
  runtime checks or independent models do not establish compiler soundness.

## Runtime RW gate rules

1. Admission binds region ID + actor incarnation + owning epoch + authenticated
   principal + **logical execution ID/slot/generation**, never only Java/C++
   carrier-thread identity. Authorizations cannot be guest-minted.
2. Grant readers together unless an earlier writer is queued; a queued writer
   imposes a barrier on subsequent readers. One writer runs alone. This gives
   bounded-queue, FIFO writer fairness under finite critical sections.
   Bound **active readers** as well as queued waiters and outstanding unconsumed
   delegation grants; a queue bound by itself does not bound memory growth.
3. Reject recursive acquisition, upgrade attempts, duplicate release,
   cross-execution release, forged/stale grants, and cross-actor access.
4. A pending request cancellation removes its queue reservation and re-drives
   the fair queue. Cancellation of an *active* loan must not pretend the loan's
   physical lifetime ended. Unlock is performed by an authenticated cleanup
   path after guest code and destructors unwind.
5. Never park a scheduler carrier or hold the metadata mutex across guest
   execution, completion callbacks, `await`, or external I/O. Lock ordering
   across multiple regions must either be statically proven or fail closed.
6. STOP immediately seals new admission and invalidates logical access, but
   physical memory remains pinned while any active loan, running guest turn,
   pending completion, callback or FFI pin is outstanding. Only after physical
   quiescence may the supervisor reclaim memory. Restart uses a fresh
   incarnation/generation, never a recycled valid old capability.
7. The supervisor may request STOP and receive sanitized lifecycle snapshots.
   CONTROL capability is not a transferable actor-state data capability.
8. Grant issuance and consumption must be failure-atomic: invalid execution,
   recursive access, exhausted serials and queue overflow must not consume a
   one-use delegation. On successful admission, consume it **exactly once**;
   never leave consumed capabilities in an ever-growing strong-reference map.

## Executable reference model in this package

`src/actor-supervisor-region-v1.mjs` and
`tests/actor-supervisor-region-v1.test.mjs` exercise a finite deterministic
admission model: owner transfer, typed delegated borrows, reader cohorts,
writer exclusion and FIFO barrier, bounded pending queue, cancellation,
suspension rejection, STOP, physical-reclamation fencing, reincarnation ABA,
and forged/foreign ticket rejection.

### Additional audit findings and hardening in this draft

The original V1 oracle had observable authorization/alias-model gaps, now
covered by targeted red-to-green regression tests:

| Gap | Hardening in source-free reference | Mandatory production follow-up |
| --- | --- | --- |
| Failed full-queue/recursive admission consumed a valid one-use supervisor grant | Commit admission only *after* validation, checked capacity and reservation; retain grant on failure | Implement atomic grant/loan transition on authenticated native runtime paths |
| Unlimited outstanding grants or concurrent reader tickets could exhaust process memory | Default bounded grant ledger (64) and active-reader limit (1024), plus existing bounded pending queue | Enforce per-actor quotas before allocation; measure worst-case latency and allocation |
| Owner raw access bypassed loan overlap in the lexical oracle | Treat raw owner read as shared access and raw owner write as exclusive; block conflicting loans | Check all owner field loads/stores in compiler MIR (not only explicit borrow instructions) |
| Released loan escape or post-`end` operation silently passed source-free checks | Reject stale escapes, reused linear loan identities, nonterminal `end` and malformed suspension | Typed CFG/NLL and exception-edge cleanup proof |
| Material field/indirect alias was invisible to overlap checks | Conservative `alias` / `project` / `drop-alias` lifetimes, root resolution, no move/write/suspend while aliased | Actual projection-sensitive alias analysis, including nested collections and captures |
| Foreign principal could obtain a trivial suspension-clear answer in the model | Reject principals outside the actor/supervisor pair and reject post-STOP suspension | Use authenticated execution handle, slot, generation and region identity |
| Restart checked generation overflow but not owner-epoch overflow | Fail closed before incrementing either counter | Persist/guard epoch fence under supervisor restart and hot reload |

**Important model limitations:** The JavaScript test-driver `owner` getter is
deliberately trusted instrumentation. A user who can call that getter is able to
obtain the current symbolic owner token, so the oracle itself provides **no
hostile-tenant security boundary**. No production code may expose the getter,
arbitrary role strings, raw state pointers or ticket objects as sufficient
authorization. In particular, the runtime must bind authority to an
unforgeable logical execution and region generation. `alias` and `project`
assume a live immutable view of the whole root and may reject safe disjoint
field accesses; that conservatism is intentional until field proofs exist.

**Limits**: no real AttoLang parser, typed MIR, compiler dataflow proof, JVM
memory model, native mutex, Truffle guest, scheduler callbacks, OS-level thread
interleavings, sanitizer, NativeAOT, or Wasm guest execution is present. The
model exposes its symbolic owner token via `owner` to its trusted TEST DRIVER;
**DO NOT expose that getter in a guest-visible runtime API.** A runtime must
check actual trusted execution context and domain identity, and treat this
reference as an untrusted test oracle, not a synchronization primitive.

## Backend integration (not yet performed)

- Java/GraalVM: integrate owned-region provenance with
  `OwnershipChecker` / `StateRegionLoanRequirement` on the active compiler
  work; bind `ActorStateRwLoans` to a trusted region owner at allocation,
  not the first arbitrary caller. Check guest-visible access through the live
  generation-fenced lease. Existing Java drafts #2296 and #2317 contain
  related, **unmerged** slices. Add source-level positive/negative JUnit and
  Graal guest tests on their exact tested heads.
- LLVM: integrate with the actor-state gate from draft #255, real compiler
  source lowering and native scheduler; run CTest + ASan/UBSan + O0/O2 guest.
- .NET NativeAOT, Wasm, Forge/Cranelift: each must enforce the SAME move,
  loan, lifetime, and generation contract at compile time, then execute the
  memory-sharing guest fixture. A host-only canary does not establish parity.
- Common conformance: coordinate with open draft #646 (borrow-check
  unification) and the earlier supervisor / critical access model #617.
  This model is additive and must not replace their guest-verification gates.

## Minimum real-guest acceptance matrix (required before shipping)

- **Positive:** two actor/supervisor logical executions obtain read tickets,
  observe immutable state, and release; writer takes precedence over a later
  reader; explicit transfer after quiescence makes the new owner sole owner.
- **Compile-negative:** simultaneous read/write, two writers, move with a live
  borrow, supervisor raw access, projection alias laundering, borrow escape or
  use-after-move, await under active mutable loan, forged cross-boundary grant.
- **Runtime-negative:** writer starvation, cancel-vs-grant race, close-vs-STOP,
  duplicate/cross-execution release, physical retirement while a reader exists,
  stale actor generation after restart, self-upgrade deadlock, queue overflow.
- Capture **exact PR head commit and Git tree**, executed runner job ID, step
  count > 0, compiler guest command, diagnostic expectations, test logs,
  native/sanitizer results and independent review. `steps=[]`, `steps=null`,
  or a source-free-only pass is NOT compiler/runtime verification.

Run the local reference tests with:

```
node --test tests/actor-supervisor-region-v1.test.mjs
```

## Follow-up audit: supervisor physical turn and derived alias fences (2026-11-10)

This V1 oracle now tracks `activeSupervisorTurn` separately from
`activeActorTurn`. A supervisor's lifecycle authority does **not** grant raw
actor-state ownership, but an in-flight supervisor guest turn is nevertheless
physical activity: neither owner transfer nor STOP reclamation is safe until
both actor and supervisor guest turns have unwound. The model's supervisor-turn
methods are **trusted-driver abstractions**, not an authorization mechanism.
Runtime integration must bind them to authenticated scheduler execution and
maintain physical-quiescence receipts, even when logical STOP revokes access.

The lexical checker now records each derived alias's parent and denies:
- dropping an alias while a derived projection is still live;
- dropping an alias while a read/write loan borrowed through it is live.

These are conservative root-level provenance constraints. Real compiler
checking still needs path-sensitive MIR, nonlexical lifetime analysis,
transactional ownership transfer and exception/unwind coverage. The source-free
model does not represent actual object memory or protect asynchronous host
callbacks from touching it.

The additional tests exercise a STOP/transfer interleaving with simultaneous
actor and supervisor turns, stale owner token after transfer, nested alias
parent-before-child release, and 500 seeded no-double-owner transfer attempts.

For cross-organization GHA validation, **never** checkout the source private
repo using the destination repo's `GITHUB_TOKEN`. An explicitly authorized
**private** destination can receive exact *blob bytes* using the connector,
with SHA checks against the source head. Test the mirrored files using the
same source-relative paths and pinned expected blob SHAs. A partial mirror
proves only the copied code's identity; its overall Git tree SHA must **not**
be claimed equal to the entire source repository's tree. Record both Git trees,
actual executed runner steps and test results. A zero-step job is not evidence.
