# Five-backend checked-i64 scalar verification (not certified)

This is a **source-free evidence-admission gate**, not a compiler runner,
sandbox, actor-isolation proof, source-transfer authorization, or release certificate.

The authored `.ores` fixture files in `verification/fixtures/five-backend-scalar/`
are eight *test programs*, not copies of any compiler or runtime source.
Their SHA-256 bytes are pinned in `verification/five-backend-scalar-gate.mjs`.

The six accepted cases cover signed-i64 literals, grouping/precedence, unary
negation and the MIN/MAX boundaries. Two negative cases demand an actual
checked-overflow failure with **no stdout**. They intentionally omit actor,
ownership, heap, mutable state and tenant isolation claims.

Required independently executed profiles:

| Backend | Required mode(s) | Native verification here |
| --- | --- | --- |
| Java/GraalVM | jit, aot, hybrid | UNVERIFIED |
| LLVM | native-aot | UNVERIFIED |
| WASM | wasm-runtime | UNVERIFIED |
| Cranelift | jit | UNVERIFIED |
| .NET | native-aot | UNVERIFIED |

A structurally eligible receipt must include the eight identical pinned fixture
digests for **each** profile, an exact source commit/tree, compiler commit/tree
and executable hash, exact run attempt, assigned runner, completed steps, explicit
guest invocation and observed positive/negative outputs. The seven mode
executions must not recycle run IDs or jobs to double-credit coverage.

**Important limitation:** an attacker can fabricate all of those fields. The
pure validator does not call GitHub, authenticate signatures, verify the bytes
of a compiled binary, attest a runner, inspect compiler diagnostics or validate
independent approvals. A trusted external verifier MUST independently:
1. Read the GitHub run, attempts, jobs, steps and checkout SHA from source-org APIs;
   reject `runner_id=0`, empty steps and failed admission.
2. Compare the Git blob/bytes and SHA-256 of the eight fixtures to the pinned
   files, and pin each compiler and backend build from its **own** source repo.
3. Execute actual guest code on the specified backend/mode, capturing raw stdout,
   stderr, exit status and exception/overflow category (not just pass markers).
4. Verify platform identity, provenance/attestations, independent review and
   security authorization. Never reinterpret approval booleans as evidence.
5. Compare each result and document any unsupported mode as **UNVERIFIED**,
   never quietly skip it or claim five-backend parity.

Runner admission is currently blocked for private-repo Actions in the source
organization; this workflow, if it receives zero steps, yields **NO test proof**.
See `oreslang-source.java#963`. Private source transfer security holds
`oreslang-platform-conformance#22`, `#77` and
`ores-llm-ml-conformance-tests#29` remain open: **do not export private
compiler/runtime source to a different organization** to obtain runner minutes.

The focused workflow only executes Node host tests. CI success, if achieved,
proves the source-free fixture/receipt guards, NOT compiled Oreslang correctness.
