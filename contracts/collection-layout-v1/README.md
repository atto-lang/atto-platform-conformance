# Collection layout v1 — AoS, SoA, AoSoA

**Status: TARGET / NOT_EXECUTED across all backends.** Companion spec: [named generic collection layout v1](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/blob/spec/named-collection-layout-v1-20261117/spec/27-collection-layout-named-generics.md). Compiler preflight candidate: [atto-source.rs PR #312](https://github.com/atto-lang/atto-source.rs/pull/312).

This contract deliberately separates (a) future positive source-compiled guest behavior, (b) compiler-negative diagnostics, and (c) manifest self-checks. The five positive fixtures require **actual guest execution**, including the AoSoA partial final block, rather than host simulation or a parser-only pass. Six negative fixtures require real compiler rejection before emitting an artifact. Some negative diagnostic classes are *semantic* until the canonical checker specifies a machine code.

Run the registry-only consistency test:

```sh
node --test tests/collection-layout-v1.test.mjs
```

Passing this test demonstrates only that the fixture registry is coherent, all referenced sources exist, all backends remain NOT_EXECUTED, and no executable claim is accidentally promoted. It does **not** invoke AttoLang compilers or prove any physical storage property.

A future implementation must provide for each backend: source and compiler immutable commit/tree SHAs, exact fixture blob hashes, compiler acceptance/rejection details, executed guest output/exit, true physical column/block storage evidence (not a layout tag), backend/toolchain version, nonzero GitHub runner/job/step records, and independent ownership/alias tests. A host-only shape planner, structurally green CI job, or zero-step workflow is NO_EVIDENCE. Do not change a status to verified without the raw reproducible evidence.

`List<T, layout=...>` is restricted to implementations declaring the contiguous-layout capability; these fixtures target `Array` and do not assume a linked list can have SoA storage. No private source is mirrored by this contract.

## Struct initializer spelling parity

`Particle{x: 10, ...}` is a struct field literal and `Particle(x=10, ...)` is a dedicated equals-based **struct aggregate initializer**, not an ordinary function named-argument call. `struct-initializer-equivalence.atto` requires matching logical values in a SoA array; `reject-duplicate-struct-field.atto` rejects repeated field keys before guest emission. This does **not** relax the general `name: value` callable rule and does not claim compilation or runtime execution.

## Strict native compiler -> guest Wasm harness (not yet passing)

Once the compiler actually supports these source constructs, use an independently built, immutable native `attoc` binary:

```sh
ATTOC=/absolute/path/to/attoc ATTO_COMPILER_SOURCE_SHA=<checked-source-commit> \
  node tests/collection-layout-v1.guest.mjs
```

The runner invokes `attoc` against **each actual .atto fixture**, validates produced WebAssembly, instantiates each positive guest, calls exported `main()`, compares its integer result (including 15 for the SoA example), and verifies that negative cases produce no artifact and the required error class. The runner fails closed if the compiler is missing or any semantic diagnostic class has no agreed machine-stable code. It computes fixture, compiler-binary and generated-Wasm SHA-256 receipts. **It does not prove the physical layout**, and neither a runner pass alone nor a self-test pass can promote a backend status without independent heap/column/borrow evidence.

This workflow is deliberately not connected to automatic CI until a genuine compiler implementation and an authorized test runner exist. No cross-organization private source transfer is performed by this script.
