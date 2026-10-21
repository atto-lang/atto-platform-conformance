# Wave 1 (tasks 1–5): pinned five-backend language targets

Status: **contract and test-harness changes only**, not implementation or runtime parity.

This is the first batch in the 30-task Oreslang parity roadmap. The authoritative
machine-readable target inventory is [../contracts/wave1-parity.json](../contracts/wave1-parity.json).
Every one of Java/Graal, LLVM, .NET, Wasm and Forge remains **pending** in this
inventory until real compiler and guest results have independently verified
source/build provenance. Existing independent work is linked in each task row.

| Task | Scope | Existing implementation/review context |
| --- | --- | --- |
| 1 | Versioned feature readiness matrix | platform-conformance #36, #40, #41 |
| 2 | Real compiler/guest evidence | platform-conformance #1, #40, #41 |
| 3 | Grammar and parser agreement | Java #1087; backend-specific grammars |
| 4 | Lexical scope and package-root imports | Java #1050; LLVM #448 |
| 5 | Nominal class/method slots | Java #1044; Java #1087 |

Run the registry self-tests from this repository on Node 22+:

    npm test
    node bin/wave1-status.mjs

The normal CLI prints a JSON consistency result with
status "CONTRACT_ONLY", compilerExecutions 0, and parityEstablished false.
For release gates use:

    node bin/wave1-status.mjs --require-parity

This intentionally exits **1**, even with seven SHA-256-matched fixtures.
A zero-exit registry validation is **not** proof that any compiler was invoked.

## Fixtures and limitations

- Grammar: canonical one-function arithmetic acceptance and malformed
  parameter-list rejection.
- Scope: lexical local binding acceptance and unresolved-name rejection.
- Package root: traversal via +/../ must be rejected. Actual import grammar,
  path resolution, manifests, package roots and diagnostics require real
  integration with the Java and LLVM branches.
- Methods/types: a basic nominal class method call and duplicate same-slot
  rejection. This is an admission target, not proof of generated method calls
  or the Java draft enum-overload vtable design.

All seven sources are immutable by SHA-256 in the manifest. These new files are
**not** automatically appended to the existing two-fixture compiler harness:
a backend may be unable to parse a proposed fixture until the relevant PR is
merged. No skip is silently converted into a pass. Backends should first run
fixture-specific positive and negative checks and then explicitly register
supported fixtures with pinned compiler and runtime execution records.

Wasm may use the LLVM compiler, but LLVM execution does not establish Wasm
runtime parity. .NET must prove strict Native AOT on its Windows target; Forge
interpreter runs do not establish native code generation. Actor/memory/async
parity is addressed in later roadmap batches.

## Promotion policy

A future evidence-aware schema must require exact immutable source and
compiler tree/commit identities, fixture hashes, binary/artifact fingerprints,
toolchain, executable command, actual guest/negative results, successful
executed CI jobs and an independent provenance review before any feature is
marked verified. Never populate a verified state in this schema by editing
JSON: version 1 rejects it.

No source export or CI mirroring is authorized by this feature matrix.
Private sources may move only through the independently reviewed private
repository allowlist/protected-branch policy. This PR neither changes that
policy nor claims an available runner.
