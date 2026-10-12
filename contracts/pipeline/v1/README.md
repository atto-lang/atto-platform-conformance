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
  shape/vocabulary. A standard schema validator should also be run when
  promoting this proposal; the tests currently assert schema vocabulary
  concordance, not a complete TypeSpec emission equivalence proof.
- `three-actor.json` is an admitted contract-only sample, **not** a compiled
  `.ores` program or host-side simulation of compiled pipeline execution.
- `src/pipeline-contract.mjs` validates stage roles, precise nominal type
  matching, adjacency, capacity limits and dangerous authority mismatches.
- `formal/TypedPipelineDirections.tla` explores two forward/two reverse hops,
  shutdown/restart and stale-reply discard in a two-generation bounded model.
  Its intentionally invalid early-reverse transition must be rejected by TLC.

All four backends remain `pendingBackends`. Do not promote any value to
`confirmedBackends` until the same actual `.ores` three-actor source compiles
and runs with typed downstream and upstream messages on the relevant backend.
The formal model does not establish implementation refinement, liveness,
backpressure fairness, OS worker exit, or transport behavior.
