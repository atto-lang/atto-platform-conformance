# Oreslang actor and ownership source admission — candidate v1

**Status: candidate, not ratified, not compiler-verified, not guest execution.**

This contract operationalizes a first slice of [the actor/ownership research crosswalk](../../docs/ACTOR_OWNERSHIP_CONCURRENCY_RESEARCH_V1.md) as nine actual `.ores` fixture files. The executable Node 22 entrypoint checks *real compiler source acceptance and semantic rejection* **only when a caller supplies an independently built compiler executable**. The default/unconfigured result is a nonpassing `UNCONFIGURED`. It does not build a compiler, execute compiled guests, or authenticate a compiler-to-source SHA mapping.

## Origin and precise limitations

- `AO01_SOURCE_ORDER`: exact LLVM `main` fixture `tests/fixtures/source-actor-interleaved-stop.ores`, blob `c7488835f34e926dfa4c8766c8917301fe84da09`. Source ordering and two distinct ActorRefs **do not prove physical overlap**.
- `AO03_AFTER_STOP`: exact LLVM `main` fixture `tests/fixtures/source-actor-send-after-stop.ores`, blob `ba046cb355fd16d9b5f6f7b39ace45356ef497db`. Compile-time rejection does not prove stale callback fencing.
- `AO04_PRIVATE_STATE`: exact LLVM *draft* [#1215](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1215) fixture `tests/fixtures/source-isolated-actor-sealed-write.ores`, blob `9bec6500694b826ccb3c0d2fc292bba816437dbc`. One actor's sealed state is **not** distinct-two-heap proof; draft source may be absent from compiler `main`.
- `OW03_NESTED_RETURN`, `OW03_CLOSURE_ESCAPE`, `OW03_SUSPENSION_ESCAPE`, `OW04_TASK_CAPTURE`: extracted source bodies from *draft* Java [#2098](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2098), with semantic diagnostics from `StaticBorrowEscapeBoundaryTest.java`. Do not infer merged support.
- `OW01_MOVE_AFTER_TAKE` and `OW02_ALIAS_MUTABLE`: **new candidate negative source syntax**; not yet proven to parse/reject for the intended semantic reason on any pinned compiler. They are expected to fail a real source-admission gate if the compiler has incompatible semantics; this is deliberate evidence, not an acceptable green result.
- `AO02_CONTROL_PRIORITY`, physical AO01/AO04, stale native completion, Send/Sync derivation, and `OW05_REGION_GENERATION_FENCE`: unimplemented gates in this suite. See [conformance #122](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/122), [Java #1437](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1437), and [Java/LLVM actor parallelism test drafts](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2355).

The entire corpus is **compiler-admission candidates**. Never mark the suite as `GUEST_PASS`, `PHYSICAL_PASS`, or `PARITY_PASS` from this runner.

## Tests and invocation

Node 22 test suite (source integrity and fake-result unit checks only):

```sh
node --test tests/actor-ownership-source-v1.test.mjs
```

To run a **real** native compiler already built at an exact revision, supply an absolute executable path and an argv array with one standalone `{file}` token:

```sh
node bin/actor-ownership-source-v1.mjs \
  --backend=llvm \
  --source-sha=EXACT_40_HEX_COMMIT \
  --argv='["/absolute/path/to/oreslang-llvmc","{file}"]'
```

For Java/GraalVM, supply its actual compiler-entry argv shape (e.g. an independently built executable/launcher and its source-check switches). Do not guess that a JAR/launcher accepts the LLVM CLI format. `--source-sha` is a **caller declaration**, not a cryptographic linkage to the executable or checkout. The runner hashes executable bytes and checks the path/digest after every case, but independent build provenance is needed.

The runner requires: exact exit `0` and no primary compiler error for a positive source case, or exact exit `1` with a *primary* `error:` diagnostic containing the declared semantic substring for a negative case. Other codes, signals, timeouts, malformed diagnostics, binary drift, unexpected source mutation and crashes cannot count as acceptance. It compiles a per-case private snapshot and checks unchanged bytes afterwards; same-user tampering can still race with these checks, so this is detection rather than a protected sandbox. Unknown/unsupported compiler syntax must not be reinterpreted as successful feature denial.

All source fixture labels are provisional and backend-specific. This runner intentionally does **not** claim runtime output, actual non-reentrancy, timer/order fairness, physical arenas, actor-lifecycle tracing or verified AOT. Real guest behavioral and physical safety reports require additional native runner evidence, generated executable hashes and independently checked trace refinement. A zero-step GitHub Actions result is `NOT_EXECUTED`, never a test failure or a pass.

## Promotion criteria

1. Independently pin and compile each fixture from exact Java and LLVM branch tips; record SHA/tree, actual binary SHA and build evidence.
2. Remove candidate caveats only after semantic diagnostic review (particularly OW01/OW02) and ratify syntax against latest ownership rules.
3. Implement AO01/AO02/AO03/AO04 event instrumentation and mutation-negative trace refinement; require genuine compiled guest events.
4. Execute complete semantic, race, source, isolation and cancellation suites on approved private runners with recorded nonzero steps.
5. Merge independently only when exact-head checks are available, with additional security review for tenant/physical isolation claims.
