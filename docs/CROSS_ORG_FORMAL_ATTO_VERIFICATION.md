# Cross-organization formal/AttoLang verification ladder (proposal)

Coordinates five distinct PRs, **not five production-level proofs**:

| Project | PR | Initial obligation |
| --- | --- | --- |
| Compiler | https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/478 | import roots |
| Orestra | https://github.com/orestra/orestra-conformance/pull/42 | reconciliation/fencing |
| OresLLM | https://github.com/ores-llm/ores-llm-ml-conformance-tests/pull/47 | numerical tolerance |
| Bretelle | https://github.com/bretelle-co/bretelle-e2e.rs/pull/13 | origin failover |
| Volucro | https://github.com/volucro/tenant-conformance.rs/pull/12 | capabilities/revocation |

## Evidence ladder (no implicit promotion)

- **L0 specified:** bounded domains, assumptions, named invariants; no pass claim.
- **L1 host model checked:** exact test artifact, explored bound and nonzero host execution.
- **L2 temporal/SMT checked:** real solver version, discharged property, explicit assumptions, negative controls and witnesses.
- **L3 native AttoLang checked:** real backend-specific compiler and guest execution with pinned source/compiler SHA and output assertions.
- **L4 integrated system checked:** exact deployed binary, fault injection, observed security boundary and cross-service results.

Host-only JavaScript/Rust models do not establish compiler parity, actual native execution, host isolation or universal proof outside their finite state space. A committed .atto fixture is not evidence of parsing/compiling/executing. Missing jobs, zero-step runs, and pending runs remain NOT_EXECUTED.

## Promotion prerequisites

1. Ratify language/runtime oracle, include independent positive, negative and mutant counterexamples.
2. Run identical pinned .atto guest fixtures on Java/GraalVM, LLVM, Wasm, Forge and .NET as individually supported. Project import root (+) and environment variable interpolation (dollar-brace repo) must remain separate.
3. Report PASS / FAIL / UNSUPPORTED / NOT_EXECUTED for each combination.
4. Capture source commit/tree, compiler commit/binary hash, fixture SHA-256, toolchain version, CI job/step URLs, executed count, guest exit and captured outputs.
5. Reject zero executed tests, source-only results mislabeled native, wrong tree, unverified compiler SHA and silent skips.
6. Threat-model security separately; bounded in-process model tests cannot certify hostile-code containment.

## Higher-confidence next proof

- **Compiler:** actual source-to-module resolution with symlink and env collision cases on all five backends.
- **Orestra:** TLA+/SMT refinement of scheduler state, plus live partition/fencing tests.
- **OresLLM:** ratified tolerance semantics and actual CPU guest results with independent gradients and integer overflow negatives.
- **Bretelle:** real control-plane/gateway races under sleep, tunnel failure, failback and revision changes.
- **Volucro:** linearizable handle transitions and adversarial tenant process/sandbox tests on Linux and macOS.

This document is a coordination contract, not merge approval or production certification.
