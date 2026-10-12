# Supervisor host-effect runtime boundary: executed evidence

Status: **draft contract**, not a production-ready supervisor implementation.
This document complements the TLA+ supervision models, the schema-v2
`bin/verify-supervisor-trace.mjs` oracle, and the registry journal v1.
It is not a machine-checked proof that either compiler/runtime refines TLA+.

## One-shot source STOP host invocation

In the Java/GraalVM source STOP compiler's synchronous and awaiting paths, the
trusted ActorGroup now claims an exact `StopReservation` immediately before
entering the host lifecycle callback. The in-registry claim is keyed to the
one-use STOP nonce and original CONTROL turn. Duplicate, mismatched, stale and
post-UNCERTAIN invocation claims fail closed, without retrying the host effect.

The restricted native `install_source_supervisor_stop_verified` path calls
`claim_host_stop_invocation` at the equivalent real supervisor CONTROL boundary.
A native `StopReceipt.host_invoked` flag is set atomically under the registry
mutex, and the journal emits `stop.invoke-asserted`. This proves the trusted
call site claimed one entry; it does NOT prove the external host operation
completed or was durably applied. On a thrown sink outcome, the receipt remains
UNCERTAIN and RESTART is denied.

## Executed native end-to-end scenarios

**Funded source mirror**:
https://github.com/3fa-app-test/account-recovery-security/actions/runs/38192678679

The allocated Actions runner independently verified 22 exact Git blobs from
the Java, native, and conformance sources before building. The job passed:

- Actual Java 25 child registry: **21/21 original JUnit tests**, plus the
  isolated journal smoke check. Java's complete compiler/runtime was NOT
  mirrored or tested; the isolated scaffold substitutes only ActorRuntime IDs.
- Actual native child registry C++ test under GCC ASan and UBSan.
- Native **restricted source STOP**: compile the real Parser.cpp and
  OwnershipChecker.cpp; execute the real C actor scheduler, typed terminal
  PANIC callback, NativeSupervisorPanicBridge and SupervisorProcess; enter
  the compiled STOP host callback exactly once for both success and unknown
  outcome, with physical child DONE already observed by the scheduler.
- Native **admitted, unpublished RESTART interrupted by shutdown**: a real
  scheduler-issued replacement exists, is staged and admitted, but CONTROL
  closes before publication. Mail admission remains blocked. Aborting a live
  replacement is rejected; physical STOP and wait_done precede
  cleanup-verified and abort. An exact physical ActorRef is preserved in
  the abort journal. No `restart.commit` is recorded.
- The shared registry journal comparator passed **7/7** self-tests and
  accepted both runtime-emitted 11-action registry parity markers.

Recorded markers in funded CI:

```text
NATIVE_SUPERVISOR_STOP_OBSERVED_V1=successful reserved=1 invoked=1 uncertain=0 acknowledged=1
NATIVE_SUPERVISOR_STOP_OBSERVED_V1=uncertain reserved=1 invoked=1 uncertain=1 acknowledged=0
NATIVE_SUPERVISOR_RESTART_SHUTDOWN_E2E_PASS admitted=1 closed=1 cleaned=1 aborted=1 committed=0
SUPERVISOR_REGISTRY_PARITY_PASS {"ok":true,"scope":"trusted-host-registry-only","steps":11}
```

The audit found that the native scheduler's `poll_published()` API was
absent from the host header; declaring it, then matching the exact updated
`NativeActorScheduler.c` source blob, allowed the replacement publication
assertions to link and execute.

## Remaining refinement and release gates

1. The Java compiled-source sync and async STOP paths must run as part of the
   complete exact-head Maven/JDK25 + GraalVM Native Image suite, without an
   isolated ActorRuntime identity scaffold.
2. Independent host evidence must bind STOP effect identity, nonce, actor
   generation, and CONTROL turn. A Boolean callback or merely entering the
   host function is insufficient to prove external effect application.
3. The schema-v2 trace collector must merge independently observed scheduler
   and host events with registry-committed transitions, audit for missing
   events, and run the complete verifier on **real** Java and LLVM histories.
4. Bound shutdown/publication races in the complete execution contexts and
   run higher-volume concurrency/fault-injection tests. Model-level TLC
   invariants and synthetic comparator success remain separate evidence.
5. General typed guest `on_panic`, RESTART and ESCALATE lowering remains
   intentionally gated. The native source STOP fixture is a restricted
   compiled hook, not proof of general Oreslang supervisor execution.

Keep Java #657, LLVM #196, and conformance #13 **draft and unmerged**
until these source-level and implementation-refinement gates are satisfied.

## Later exact-source CONTROL-close refinement verification

The bridge later gained a host-only `SupervisorProcess.with_healthy_restart_transaction`
decision fence that serializes CONTROL close/failure classification with the
entire scheduler-pinned RESTART publication transaction. The current
`NativeSupervisorPanicBridge.hpp` and `SupervisorProcess.hpp` Git blobs
were mirrored together and actually executed with the host scheduler source.

**[Final funded source-level CI #38192907210](https://github.com/3fa-app-test/account-recovery-security/actions/runs/38192907210): PASS.**
All 22 exact Git blob checks completed; the 21 Java registry JUnit
tests passed; the native registry, restricted source STOP path, and real
scheduler RESTART close/cleanup/abort path passed under ASan/UBSan;
the runtime-emitted parity comparator passed all seven Node tests.

The verified latest bridge/process blobs are
`069a7d6e65506b25bb136e1848255646d741fb8f` and
`c525270dc9a2fdcf3753f013c08853d246fba6a0`.
The test establishes this particular host-level shutdown transaction under
its exercised schedules; it is not an unbounded concurrency proof, and the
complete LLVM CMake matrix plus unrestricted guest supervisor lowering
remain gated.


## STOP authorization audit: applied receipts require claimed host entry

A later cross-backend audit found a real contract bypass: although both
source-compiled STOP installers recorded a one-use callback-entry claim, the
registries still permitted an unclaimed STOP to be marked APPLIED by a trusted
but incorrectly wired caller. Java also allowed a direct PENDING host-ACK
without the invocation claim.

The Java child registry now rejects `markStopApplied` and
`acknowledgeHostStop` on an unclaimed PENDING receipt. The native registry
now rejects `record_stop_applied` without `host_invoked`, and the host panic
bridge offers `claim_finalized_stop_host_invocation` to be invoked *just
before* the real host effect. The bridge's native integration test first
asserts that a premature ACK fails, then claims entry and invokes the
physical effect. Java's acknowledgment-versus-reconciliation race test
similarly claims host entry before starting both competitors.

The independently authoritative, read-only reconciliation path is
intentionally separate: the registry does not fabricate host invocation
from external evidence, and an uncertain receipt is never replayed.
Native now explicitly rejects classification of an APPLIED or ACKNOWLEDGED
receipt as UNCERTAIN, matching Java's existing fail-closed behavior.

### Final audited exact-source subset

**[Funded CI #38194891660](https://github.com/3fa-app-test/account-recovery-security/actions/runs/38194891660) passed.**

- 24 exact Java/native/conformance Git source blobs verified before build.
- Java 25 original child-registry JUnit suite: 22/22 passed. The isolated
  ActorRuntime ID compilation scaffold remains distinct from the real
  interpreter/compiler and is not a full Maven or Native Image run.
- Native child registry under ASan/UBSan: passed.
- Real native scheduler + source STOP + typed PANIC + CONTROL host
  integration passed for both successful and uncertain host effects.
- Physical RESTART admission interrupted by close: admitted=1, closed=1,
  cleaned=1, aborted=1, committed=0.
- New scheduler-owned initial-registration lease and unpublished RESTART
  lease test passed under ASan/UBSan.
- Native CONTROL-close/restart-publication decision fence stress passed
  12 consecutive independent executions under ASan/UBSan.
- Shared registry comparator self-tests passed 7/7 and accepted the 11
  committed transition names from actual Java/native executed tests.

The model's `stop.invoke` precondition is now better aligned with the
source-compiled host `stop.applied` implementations, but no complete
schema-v2 runtime trace refinement has yet been run. In particular,
`stop.invoke-asserted` is a one-shot host callback ENTRY signal, not
independent/durable proof of an external STOP side effect. The bool-based
host verifier remains a caller trust boundary that needs a concrete
provenance-bound evidence backend. Do not merge runtime drafts or enable
general guest RESTART based solely on these bounded tests.


## Full-source compiler and host-effect evidence milestone

The isolated registry smoke suite above is **not** the only compiler evidence
anymore. Two separate funded branches now contain complete exact-source trees.

### Java/GraalVM

[Funded full-source Java verification #38196942944](https://github.com/zed-pkg-test/java-app/actions/runs/38196942944)
passed a full Maven `verify`: **1,493 JUnit tests, zero failures/errors**,
using a 403-file Java source mirror, not the earlier identity-only scaffold.
The real `ActorRuntime`/compiled `SourceSupervisorLowering` integration ran
in the focused test gate. This exposed and repaired a Java test generic
inference regression (`ActorRef<Object>` instead of `ActorRef<String>`),
plus corrections to isolation-test callbacks, fail-closed dispatcher
admission, and post-failure notice accounting.

The funded run also **compiled the full GraalVM AOT Native Image
successfully**, but its AOT smoke step failed on a removed
`--internal-native-shutdown-selftest` launcher flag. It would be incorrect
to call that whole job green. The funded workflow was subsequently updated
to run the real `contracts/v1/fixtures/literal-42.ores` guest program using
the native `--mode=aot/hybrid` options. The AOT and hybrid executable smoke
gates must be assessed from a newer completed run, not assumed successful.

The Java PR has moved while other changes land. A successful funded mirror
applies to the **exactly verified source blobs of that particular run**,
not automatically to future PR heads.

### LLVM

[Funded complete LLVM CMake/CTest #38197281070](https://github.com/zed-pkg-test/java-app/actions/runs/38197281070)
verified the full 308-file source subtree and built the complete compiler
plus host/runtime tests. Its **10/10 supervisor/restart tests** and
**182/182 full CTest cases** passed. The separate ASan/UBSan configuration
passed all 10 supervisor/restart tests.

The first full CTest run exposed two outdated test expectations about a
rejected supervisor CONTROL dispatch. Both tests now explicitly require
fail-closed admission to throw, while asserting that no guest decision was
applied. This is a test-contract repair; it does not weaken admission.

### Schema-v2 STOP permit and signed proof verification

The executable trace verifier now requires a globally unreused
`stopPermitId` on STOP reservation. The exact permit must be preserved
across `stop.invoke`, `stop.applied` or `stop.uncertain`, optional
`stop.proof`, and `stop.ack`. Test callers can require
`expectedSourceSha` and `expectedBackend` from an independently
verified checkout. Neither the JSON source SHA nor a claimed signed receipt
is sufficient on its own.

`bin/verify-signed-stop-receipt.mjs` defines a domain-separated Ed25519
receipt contract for externally configured host authorities. It signs the
specific source, backend, supervisor, logical child, physical actor, actor
incarnation, CONTROL turn, STOP permit, receipt/evidence ID, operation ID,
and `applied` status. The verifier requires a public-key trust anchor and
source SHA supplied **out of band**; rejects mismatched signatures, actor
identities, turns, permits, duplicate evidence and operation IDs; and can
authorize the verifier's explicit `stop.proof` action.

[Funded signed-receipt/schema-v2 CI #38197896901](https://github.com/zed-pkg-test/java-app/actions/runs/38197896901)
verified the exact four conformance blobs and passed **15/15** positive and
adversarial Node tests on an allocated runner. Earlier attempts in the
previous test organization failed **before runner allocation**, not due to
assertions; they are not implementation test evidence.

**Trust limitation:** A valid Ed25519 signature authenticates that the
configured host issuer *asserted* application. It cannot certify that the
external STOP operation actually occurred, that evidence is durable across
process crashes, or that an issuer signed only after a successful effect.
The host must separately implement a durable, idempotency-aware operation
ledger and issuer policy. No complete, independently observed real schema-v2
trace of a production supervisor execution has been verified yet.

All Java #657, LLVM #196, and conformance #13 PRs remain draft and must not
be released based on these bounded checks alone.

## Schema-v2 evidence identity replay hardening

The shared schema-v2 oracle now permanently fences reuse of three
distinct event-evidence identifiers within one validated history:
`restart.admit.admissionId`, `restart.cleanup.cleanupId`, and
independently verified `stop.proof.evidenceId`. This prevents an
otherwise well-formed second child or restart attempt from laundering
a prior physical admission, physical cleanup, or host-proof record.
The cleanup event must also carry the staged replacement's **exact**
`newGeneration`, not merely its actor identifier.

These rules are checked by new negative tests that reserve a second
RESTART, reuse the first operation's evidence identities, and substitute
an incorrect physical cleanup incarnation. The verifier already requires
a separate trusted `verifyProof` callback for a STOP proof: these replay
checks are an additional safety constraint, **not** authentication of
arbitrary JSON-supplied evidence.

Runtime-produced schema-v2 histories, durable host receipts, and full
source compiler builds remain independent release blockers. Passing
the existing registry comparator does not pass the schema-v2 oracle.

## Callback-isolation and provenance audit of schema-v2 host proofs

A focused replay audit found that `stop.proof` checked the one-use
`evidenceId` **after** invoking `verifyProof`. An attacker supplying a
well-formed second STOP under a distinct supervisor could reuse a prior
proof ID and trigger the trusted verifier a second time before rejection.

The verifier now checks that proof ID against the per-history used-proof
set **before** calling `verifyProof`. Reuse cannot invoke another external
verification callback in the same trace. This is a per-trace safety rule,
not a durable global nonce ledger.

The trusted proof path now also requires caller-provided
`expectedSourceSha` and `expectedBackend`. These must originate from an
independently verified executable/checkout, **never** be copied out of the
untrusted trace JSON. An external proof callback alone is insufficient
to accept a STOP proof when those bindings are absent.

The verifier snapshots all event records and the source/backend identity
before executing host callbacks. Mutations to the original document by
an external callback can no longer rewrite pending STOP acknowledgments,
the terminal count, or checked runtime provenance during the same pass.

**Funded, allocated-runner check:**
[zed-pkg-test/java-app #38198954665](https://github.com/zed-pkg-test/java-app/actions/runs/38198954665).
Both exact source blobs of `bin/verify-supervisor-trace.mjs` and
`test/supervisor-trace.test.mjs` were Git-hash pinned. Node's original
conformance tests plus the three new adversarial cases passed **16/16**,
zero failures.

The gate demonstrates verifier contract behavior only. It does not yet
establish that a real Java/GraalVM or LLVM scheduler emits complete
schema-v2 history, or that the host verifier has actual, independently
authenticated and durable physical STOP evidence. Do not use it to
remove any runtime PR's release blocker.


## Native host-owned physical DONE receipts (restricted source supervisor)

A further implementation milestone in the LLVM draft introduced
`NativePhysicalStopEvidence.hpp`. Unlike the registry receipt's
`host_invoked` bit or the decision sink's Boolean return, the
process-local ledger rereads the authoritative STOP reservation, observes
the native scheduler's actual physical `DONE` barrier, and issues a
single immutable receipt bound to exact supervisor/domain, logical child,
physical actor slot and generation, incarnation, and CONTROL turn.

The native source STOP integration now tests three cases: normal ACK,
UNKNOWN with no attestation (remains STOPPING), and LOST ACK with an
already-recorded physical DONE attestation (reconciles without invoking the
host sink again). The separate physical regression intentionally supplies
a false early FINALIZED registry claim for a live actor; host issuance is
denied until scheduler DONE. A forged registry ticket, wrong turn/actor
generation, duplicate issuance, and legitimate slot zero are covered.

**Actual GitHub Actions run:**
[zed-pkg-test/java-app #38200268818](https://github.com/zed-pkg-test/java-app/actions/runs/38200268818)
**PASS**. 18 exact LLVM C/C++ source/test Git blobs and ASan/UBSan
native scheduler, parser/ownership checker, source STOP and adversarial
host receipt test. This is an executed restricted native integration
slice, not an entire LLVM CMake/CTest verification.

**Boundary:** the new evidence proves physical native actor completion
only; it is in-memory, is not crash-durable, and cannot attest an
arbitrary external STOP side effect. Nor does it produce full real
schema-v2 scheduler/host traces. The schema-v2 `verifyProof` adapter
must eventually consume separately authenticated host records with
independently pinned source/backend identity before claiming end-to-end
runtime refinement. General guest RESTART and all release gates remain
unchanged.


## Attested native restricted source STOP: callback-only ACK is rejected

The restricted native `install_source_supervisor_stop_verified` adapter
now accepts an **optional** `NativePhysicalStopEvidence` instance in its
trusted host API. In this opt-in mode, a normal host callback return does
NOT authorize `stop.applied`: the installer rereads the authoritative
reservation, checks for a separately issued scheduler-DONE receipt for
the exact child/actor incarnation and CONTROL turn, and only then commits
`STOPPED`. If the callback returns normally but the ledger has no
matching evidence, the STOP stays **UNCERTAIN / STOPPING** with no retry.
A thrown callback may likewise be reconciled only if the host had already
recorded physical DONE in the same process.

[Actual funded native CI #38200659588](https://github.com/zed-pkg-test/java-app/actions/runs/38200659588):
**PASS**, 18 Git-blob-exact LLVM subset sources, GCC ASan/UBSan,
real scheduler, Parser.cpp, OwnershipChecker.cpp and restricted compiled
source `on_panic(f: Failure)` `self.stop(f.child)`.

Executed regressions cover:
- successful STOP with one physical receipt and one host invocation;
- unknown outcome without evidence remaining quarantined;
- LOST ACK with independently recorded physical DONE reconciled without
  reinvoking the host callback;
- a normal callback return **with no receipt** remaining quarantined;
- registry asserted FINALIZED while scheduler still executes the actor,
  rejected until physical DONE;
- forged child/turn/generation, replay/duplicate, and slot-0 actor identity.

**Not proven by this subset:** durable cross-process effects, cryptographic
host receipt attestation, arbitrary external STOP side effects, complete
Java/GraalVM parity, whole-compiler CMake/CTest or Maven, or schema-v2
actual event-stream emission and TLA+ refinement. The older optional-null
legacy adapter is source-compatible but **must not** be used as a general
guest STOP proof. The three PRs remain draft/unmerged.
