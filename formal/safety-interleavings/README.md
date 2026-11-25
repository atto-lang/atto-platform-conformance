# Concurrent readers and exclusive writers

Property: Concurrent readers and exclusive writers.

## Scope and source mapping

Reviewed boundary: [formal/README.md](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/blob/672aec75b88b4ca2bb7dee5ebb677a781a75eb7d/formal/README.md).

Three callbacks, each acquiring read or write access once, with all acquisition/release orders. Safety only; no fairness, starvation, borrow checker, callback escape, or backend runtime proof. Complements CONTROL and worker-ticket models.


This is a finite design model. No source extraction, implementation trace replay, solver proof, production execution, or unbounded theorem is claimed. Production refinement remains a separate obligation.

## Reproduce

Requires Rust 1.75 or newer; standard library only. From the repository root:

```sh
mkdir -p tmp/formal-safety
rustc --edition=2021 --test -D warnings formal/safety-interleavings/check.rs -o tmp/formal-safety/check
tmp/formal-safety/check --nocapture --test-threads=1
```

The checker explores the reachable graph to a fixed point. Each invariant is checked at initialization and every successor. Breadth-first traversal emits a shortest action trace on violation. Exceeding 200,000 states fails rather than reporting a partial exploration as proof. Positive tests pin exact state/edge counts to catch accidental loss of reachable behavior. Negative controls must reach an invariant violation; compiler errors, panics, and exhausted exploration are not accepted counterexamples.

## Executed evidence

Local rustc 1.75.0, warnings denied: two tests passed. Positive exploration: **39 states / 78 edges**. One unsafe mutant detected. Hosted CI is separate evidence and must execute actual steps before being called passed.

## Refinement work

Map observed implementation events into these transitions; replay successful and rejected operations; demonstrate the same counterexamples against controlled implementation mutations. Preserve these bounds and assumptions when reporting results. Passing this model alone must not promote runtime, database, compiler, or backend conformance status.
