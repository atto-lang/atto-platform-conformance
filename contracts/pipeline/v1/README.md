# Typed actor pipelines — proposal v1 (not compiler support)

The versioned proposal fixes the **first-class** Oreslang operations
`self.forward(value)` and `self.backward(value)`; the former sends an owned
nominal type to the immediate downstream stage, and the latter sends a
separately typed, correlation-bound result to the immediate upstream stage.
`self.backward` is not caller `self.respond` or supervisor CONTROL mail.

The three-stage example has distinct source, transform and sink roles, two
bounded DATA hops downstream, and two typed reverse hops upstream. Each
successful forward future acknowledges only **mailbox admission**, not
execution. The runtime must bind reverse replies to an originating request,
physical generation and actor incarnation. No stream becomes observable
until all connections have been allocated and published atomically; failure
must roll back. Stage restarts must fence old producer/consumer capabilities.

- `actor-pipeline.tsp` provides TypeSpec shape/vocabulary.
- `pipeline-graph.schema.json` supplies a **closed** JSON Schema 2020-12
  shape/vocabulary. The pipeline workflow executes both the pinned TypeSpec
  compiler and a draft-2020-12 Ajv validator against the positive fixture.
  Tests also assert vocabulary concordance; generated TypeSpec-to-Schema
  equivalence is not yet a machine-checked guarantee.
- `three-actor.json` is an admitted contract-only sample, **not** a compiled
  `.ores` program or host-side simulation of compiled pipeline execution.
- `src/pipeline-contract.mjs` checks semantic correctness of caller-owned data,
  but its yes/no result is NOT a durable authorization token.
- `src/pipeline-admission.mjs` creates and validates a deep-frozen own-data
  snapshot before any constructor can consume roles, edges or grants. Consumers
  **must use `admitPipelineContract(input).contract`**, never the mutable input
  after validation. The admitted object is local structural policy evidence,
  not an executable actor capability or proof of runtime/scheduler behavior.
- `formal/TypedPipelineDirections.tla` explores two forward/two reverse hops,
  shutdown/restart and stale-reply discard in a two-generation bounded model.
  Its intentionally invalid early-reverse transition must be rejected by TLC.

All four backends remain `pendingBackends`. Do not promote any value to
`confirmedBackends` until the same actual `.ores` three-actor source compiles
and runs with typed downstream and upstream messages on the relevant backend.
The formal model does not establish implementation refinement, liveness,
backpressure fairness, OS worker exit, or transport behavior.

## Formal and security limits after the ticket audit

The original `TypedPipelineDirections` model checks stage ordering with two
forward and two backward hops, but did not represent request-specific identity.
`TypedPipelineTickets` now explores two correlation tickets and two physical
epochs, including STOP/restart, same-ID reuse, safe discard of late replies and
an intentionally unsafe old-epoch completion. CI must observe the
`CompletionBoundToCurrentEpoch` counterexample in the unsafe configuration.
The test does **not** establish unbounded exactly-once delivery, fairness, a
physical STOP barrier, or a refinement mapping to any compiled runtime.

`admitPipelineContract` snapshots only admitted primitive fields and deeply
freezes the resulting own-data graph; rejecting accessors, noncanonical arrays
and mutable caller aliasing. Its trust boundary is JSON-like objects in a
trusted JavaScript realm. A hostile `Proxy`, compromised JS built-ins, or
concurrent shared-memory producer are not safely normalized by this function.
Callers should parse JSON in a trusted realm, validate the original content
and use only the returned owned `contract` for subsequent construction. It is
a proposal-level structural admission, **not** an actor execution capability.

## Executable compiler-guest evidence versus a model trace

LLVM PR #180 already contains **real compiled** actor source
\`tests/fixtures/source-actor-pipeline-bidirectional.ores\`, which exercises
\`self.forward\` and \`self.backward\` through Source, Transform and Sink and
checks final source state 19. The current bounded LLVM and Java implementations
are distinct from this proposal's future role-declaration syntax.

\`runtime-trace.tsp\` and \`runtime-trace.schema.json\` define a closed exchange
format for ordered reserve, publish, deliver, finalize, complete, STOP, restart,
and stale-reply discard events. \`trace-three-actor.json\` is an **illustrative,
synthetic** single-flow trace. \`verifyPipelineTrace()\` checks that ordered
events are consistent with five typed hops and generation fencing, but this
does **not** prove that the compiled runtime emitted them. The Java/LLVM runtime
instrumentation and trusted runner-side provenance are still needed for an
implementation-to-TLA+ refinement claim. It does not prove arbitrarily many
flows, exact-once delivery in general, or progress/fairness.

\`verifyNativeGuestSummary()\` is intentionally weaker and accepts only the
already-existing LLVM compiled guest's aggregate result plus its three physical
actor STOP receipts and group close. It rejects wrong values, duplicates,
missing stop receipts, terminal failures, and the wrong source fixture Git blob.
This gate must be fed stderr and exit status **captured directly from a real
compiled executable in trusted GitHub Actions**, not manually constructed
JSON. It cannot establish event ordering or incarnation replay safety merely
from this aggregate transcript.

A CI runner can run:

\`\`\`sh
node bin/verify-pipeline-evidence.mjs --trace contracts/pipeline/v1/trace-three-actor.json
node bin/verify-pipeline-evidence.mjs --native-summary path/to/captured-native-execution.json
\`\`\`

Successful parsing validates internal coherence, **not** authenticity of a
runner, an executable, or a build artifact. The wire/source compatibility
still needs executable common-source fixtures and SHA-exact compiler builds.
