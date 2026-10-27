# Three AOT guarantees — formal verification workstream (v1)

**Status: proposed finite-state abstract model + bounded executable reference. NOT verified executable compiler semantics, zero-restart backend support, hard-RT qualification, or complete machine-checked TLA+/SMT proof.**

This extends the already active [formal core verification program](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/150) and the [shared three-guarantees draft](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/168). The executable parity tracker is [#188](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/188).

## Formal objects

- `ThreeGuarantees.tla` and three TLC config files: 3 finite generations, 2 session handles, image capacity 2, V1→V2→V3 staging, generation pins, consumed session tokens, admitted authorization, timed-out but unsettled requests, settlements, safe retirement.
- `ThreeGuaranteesRT.smt2`: a symbolic integer abstraction of response-time admission with all bound components and exact certificate match; a deliberately unsafe omission of cleanup must have a satisfying counterexample.
- `three-guarantees-bounded.mjs`: an **independent source-free finite-state executable checker**, with BFS shortest counterexample traces and an exhaustive small-range RT arithmetic check.
- `three-guarantees-bounded.test.mjs`: affirmative model checks and mandatory unsafe mutants, which ensure the model isn't trivially vacuous.

### Local reference execution

```sh
node --test formal/three-guarantees-bounded.test.mjs
```

Current local prototype results: normal finite state graph **855 states**, no modeled invariant violation; **37,908** bounded RT combinations; both unsafe TLA-equivalent mutations have counterexamples. Actual `ThreeGuarantees.tla` has **not yet been executed by TLC**, and `ThreeGuaranteesRT.smt2` has **not yet been executed by Z3/CVC5**. These are not formal solver receipts.

### TLC execution gate (required before advancing from unverified TLA model)

Pin a trusted, reviewable `tla2tools.jar` and record its cryptographic digest and version. From the `formal` directory:

```sh
java -cp /path/to/pinned/tla2tools.jar tlc2.TLC -deadlock -config ThreeGuarantees.cfg ThreeGuarantees.tla
java -cp /path/to/pinned/tla2tools.jar tlc2.TLC -deadlock -config ThreeGuaranteesUnsafePurge.cfg ThreeGuarantees.tla
java -cp /path/to/pinned/tla2tools.jar tlc2.TLC -deadlock -config ThreeGuaranteesUnsafeTimeout.cfg ThreeGuarantees.tla
```

Expected: normal model finishes without invariant violation; **both mutant runs must fail** on `NoDanglingPins` and `NoSpentPhaseResurrection` respectively. Do not accept a zero-step, skipped, timeout, incomplete-state, parse-error or tool-missing result as a valid counterexample/proof. A CI gate should check actual invariant names and counterexample traces, not merely expect nonzero exit.

For SMT, run a pinned Z3/CVC5 binary and assert the ordered answers are **unsat, sat**, followed by a valid counterexample model for the deliberately broken deadline rule. If the solver reports `unknown`, parse error, timeout, or incomplete model, the gate fails.

## Mathematical and implementation proof boundaries

| Level | Obligation | Evidence status |
| --- | --- | --- |
| F0: declarative contract | Finite code closure, actor phase invariants, rollback and timing definitions | Specified in common-source PR #168 |
| F1: abstract machine | TLA+ safety, selected fairness/liveness claims, SMT arithmetic and bad-rule counterexamples | Models authored; bounded JS check executed; solver runs pending |
| F2: compiler-source binding | Source `.ores` → compiler-owned typed HIR/MIR facts, CFG, capabilities, ownership, version/phase identity and effect closure; no forged user claims | **Not verified** |
| F3: translation validation | LLVM-native and generated Graal guest code correspond to HIR/MIR and preserve admitted transition/effect invariants; AOT linked closure attested | **Not verified** |
| F4: executable refinement | Compare structured event traces from real compiler-built **LLVM native** and **program-specific Graal Native Image guest** executables against the abstract model; hostile negative fixtures | **Not verified** |
| F5: deployment qualification | Signed/precompiled image loader or honest broker handoff, source/image/certificate SHA binding, memory/quiescence, target-specific WCET and schedulability validation | **Not verified** |

**Do not infer a proof of F2–F5 from passing F1.** Tests and trace comparison are useful implementation evidence but do not constitute full compiler correctness. Restrict proof claims to the actual verified source artifacts and exact assumptions.

## Safety and conditional progress properties

The small TLA model specifically checks *safety*:
- Active, staged, and session-pinned code images cannot be retired.
- At most 2 code images are retained in the abstraction; inability to stage V3 while V1 is pinned results in bounded rejection/defer rather than forced purge.
- An admitted session cannot regain the old `Created` authority after timeout.
- Phase transitions consume affine authority; timeouts preserve uncertainty until settlement.
- Session handles retain the code generation they started with; new sessions may use the newly published generation.

The model **does not prove** physical FFI/DMA quiescence, concurrent native loader correctness, cancellation termination, external exactly-once business effects, capability anti-forgery, actor CONTROL priority, network progress, or unconditional liveness. Future temporal proofs must name fairness assumptions explicitly; a permanently stuck external callback can legitimately prevent image retirement.

For real-time admission, the symbolic inequality is *only one obligation*. Real certification also requires sound source-derived bounds for WCET, jitter, interference, blocking, allocation/GC, FFI, cancellation/cleanup, and upgrade activation, plus platform/system scheduling proof. No finite arithmetic model alone turns generic GraalVM Native Image into a hard-real-time platform.

## Implementation plan

1. Run the pinned TLA+ and SMT solvers in approved CI with safe/mutant verification; record exact solver/toolchain and model blobs, all visited state counts, and negative witnesses.
2. Add a typed actor-session lowering fact envelope to both independent frontends; feed actual source/CFG facts to proof generators rather than manually authoring provenance.
3. Validate compiler-negative Oreslang fixtures for illegal phase, double-use, forged identity, stale generation, permission laundering, unknown effect and unsafe state loan.
4. Execute genuine LLVM compiled guest actor and Graal Native Image program-specific guest actor binaries; emit structured traces and compare to model action obligations.
5. Add a separate verified hot-loader/quiescence model and a platform-specific real-time budget/certificate verifier. Keep the existing hard-RT/no-GC and code image gates independent.

**No private compiler tree may be mirrored outside its owner without an explicitly reviewed private/private destination and proof of authorization.** Any GitHub Actions run with 0 executed steps is `not_executed`.
