# Random roadmap wave — five source-free reference obligations

Selected from roadmap tasks **#37, #64, #29, #67, #35** on November 8, 2026.
This change is a **testable backend-neutral reference layer**. It does not add
a production guest compiler, actor broker, tracing-GC monitor, or channel
implementation. No source-private code was transferred between organizations.

| Task | New reference module | Adversarial obligation | Smallest missing real integration |
|---|---|---|---|
| #37 guest zero-GC profile | `random-five-zero-gc-metrics-v1.mjs` | Reject any observed guest tracing collection, unmatched actor teardown, leaked region, zero-step or unbound runner claim. Distinguish JVM/.NET host GC from guest heap GC. Even a passing shape is **UNAUTHENTICATED**. | Run an actual compiled guest workload on Java/Graal, LLVM, .NET, Wasm and Forge; independently bind memory counters, emitted binary, exact checkout tree, run/job/attempt and artifact checksum. |
| #64 bounded pub-sub | `random-five-pubsub-delivery-v1.mjs` | Distinguish RELIABLE backpressure from DROP_NEW, DROP_OLDEST and LATEST; retain FIFO per publisher, refuse early ACK, cancel pending publication, fence old subscription generations and group close. | Compile and execute publish/receive in each backend, assert mailbox/arena quotas, carrier nonblocking, cancellation races and receive traces, not merely JS reference output. |
| #29 nested Option/Future | `random-five-nested-types-v1.mjs` | Never implicitly convert `Future<Future<T>>` to `Future<T>`, `Option<Option<T>>` to `Option<T>`, or `Future<Option<T>>` into `Option<Future<T>>`; permit **explicit one-layer** flattening only. | Wire canonical negative `.atto` cases into each backend type checker and assert a semantic rejection **before** IR/object generation. |
| #67 race-safe select | `random-five-select-arbitration-v1.mjs` | Only one reserved operation may commit; all losers roll back once; cancel/timeout and commit are mutually exclusive; reject late messages, token replay, duplicate branch and oversized payload. | Exercise real concurrent producers, select waiter registration, cancellation and rollback in guest/native runtimes with deterministic replay. |
| #35 compile-time borrows | `random-five-ownership-v1.mjs` | Reject take while borrowed, cross-actor private access, callable transport, exclusive actor-state loan across await, duplicate/ABA borrow tokens and foreign loan release. | Integrate diagnostics into source parser / CFG borrower pass and prove compile-reject with no emitted object on five actual backends. |

## Running checks

The repository uses Node 22 and already has a `node --test` suite:

```sh
node --test tests/random-five-*.test.mjs
npm test
```

Node tests cover reference behavior only. All five modules are independent of
native backend binaries and have no authority to classify a real compiler or
runtime as passing. Their models are deliberately bounded; finite-state and
linear-trace checks are **not** a complete concurrency/ownership proof.

The contract manifest in `contracts/roadmap-random-five-v1.json` starts with
all backend evidence at `NOT_EXECUTED`. Do not update that status until
an authenticated exact-PR-head run has positive executed steps, a verified
source tree/compiler and a matching guest diagnostic/output trace.

## Existing work to reconcile, not duplicate

- Zero-GC: existing actor-GC verifier and draft #586/#587.
- Pub-sub: source-free formal draft #460/#461 and portable broker draft #305.
- Nested types: Option/Result/trap draft #290 and compiler-side fixes.
- Select: existing channel/select lowering and critical/suspends PRs.
- Borrow: existing ACT-BORROW-V1 conformance plans and backend lowering.

This PR introduces **new files only**, intentionally separate from those
agents' working branches. The next step is to attach real backend fixtures
and executed CI, not to promote these local oracles as guest parity.

## Release and CI boundary

Private GitHub Actions currently suffer runner admission failures. An Actions
job with `steps=[]` or `steps=null` is **NOT_EXECUTED**. Hosted checks must
run on the exact PR head/tree, with independent review and protected-main
requirements satisfied before merge. No external private-source carrier or
bypass is authorized by this proposal.
