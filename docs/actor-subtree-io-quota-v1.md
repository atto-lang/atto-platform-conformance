# Actor-subtree I/O quota reference contract (v1)

**Status: SOURCE-FREE REFERENCE ONLY — NOT VERIFIED ORESLANG GUEST EXECUTION.**

The canonical authority checks in `src/capability-io-admission.mjs` already
intersect host, artifact, runtime, actor, delegated, and ancestor actor policies.
This extension adds an aggregate in-flight I/O budget for each actor subtree,
so one child family cannot exhaust its parent's allowed admission credits.

## Contract

- A trusted host registers an actor with an optional
  `{maxSubtreeInFlight: N}` limit (positive safe integer, 1..65536).
- An omitted limit inherits the parent's ceiling, or the broker's global
  ceiling for a root. A child may narrow, never widen, the parent's limit.
- A successful admission charges the actor and **every** ancestor's aggregate
  subtree counter, including the root.
- Admission fails closed with `BACKPRESSURE_SUBTREE` if *any* ancestor is
  saturated. The separate global quota still reports `BACKPRESSURE`.
- Completion, cancel, revocation and shutdown **do not refund** any quota.
  Only the trusted host's authenticated physical-quiescence retirement
  releases the global credit and every original ancestor's credit once.
- A retired/stale/forged actor handle cannot admit work. A revoked parent
  recursively denies its descendants. Unrelated actors retain their budgets.
- Host-side broker serialization is assumed; native backends must perform
  quota checks, ticket publication, and refunds as one linearizable operation.
- Host-only `hostQuiesced: true` is a reference-model witness, **not**
  evidence of OS descriptor retirement, cancelled syscalls or a security sandbox.

## Required negative cases

1. A child saturates its own subtree without exhausting an unrelated sibling.
2. Two children saturate the parent while unrelated actors still progress.
3. Cancellation or revocation before physical retirement does not free quota.
4. Double retirement does not refund twice or underflow a parent quota.
5. Oversized, malformed, stale and forged quotas/actor handles fail closed.
6. A descendant that omits a quota inherits, rather than widens, the ceiling.
7. Non-quiesced operations cannot release quota, even at shutdown.
8. Reentrant authorization callbacks cannot publish after actor revocation.

Run source-free tests with:

```sh
node --test tests/capability-io-admission.test.mjs
```

The test is a deterministic Node reference broker, not a malicious-code sandbox,
an Oreslang compiler test, or cross-backend proof.

## Native implementation and evidence gates

Java/GraalVM, LLVM, Wasm, .NET NativeAOT, and Forge remain
`PENDING_REAL_GUEST_EVIDENCE` for this additional subtree-budget contract.
Each backend needs actor-incarnation-pinned quota identity; atomic
admission/refund; physical I/O loan and task quiescence; bounded mailbox/host
operations; exact-source compiled .ores positive and negative fixtures; and
executed CI steps with independently verifiable receipts.

Do **not** use private-source cross-organization mirroring without destination
authorization and independent security approval. A source-org workflow that
fails before runner steps is neither a pass nor a compiler failure.
