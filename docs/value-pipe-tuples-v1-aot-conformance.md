# AOT value-pipe tuples: executable conformance v1

Tracked by [#673](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/673).

Positive and four negative .atto inputs are byte-identical to the real guest
fixtures executed in private Scintilla run
[42936149128](https://github.com/scintilla-run/scintilla-run-e2e/actions/runs/42936149128),
where 30 actual Java/GraalVM JUnit cases passed and native-image produced a
native binary that executed the positive source. This is a *native launcher
running guest source*, not proof of compiler-generated standalone native guest
code for LLVM/NET/Wasm/Forge.

To generate a **candidate** backend execution receipt (not independent proof), set all of:
- ATTO_TUPLE_BACKEND: one of the contract's backend IDs
- ATTO_TUPLE_COMPILER_ID: exact compiler head SHA and toolchain identity
- ATTO_TUPLE_COMPILER_BINARY: path to the actual compile-check executable (this exact program must be argv[0] of ATTO_TUPLE_CHECK_ARGV_JSON; the guest-run executable is separately hashed)
- ATTO_TUPLE_WORKDIR: execution working directory
- ATTO_TUPLE_RUN_ARGV_JSON: JSON argv for guest execution, with "{fixture}"
- ATTO_TUPLE_CHECK_ARGV_JSON: JSON argv for compile-only validation, with "{fixture}"

Then execute: `node scripts/verify-value-pipe-tuples-v1.mjs`.

For Java CLI (working directory at its built tree) a sample execution argv is:
`["./target/ores-aot","{fixture}"]`. A companion compile-check argv
must invoke the *same* backend's compile-only gate, not a different parser.
The runner first requires **successful compile-only admission of the positive fixture** with the pinned compiler executable, then checks exact guest stdout `39\\n`. It validates Git blob SHAs, requires nonzero failures with category-matching diagnostics for every negative source, and emits SHA-256 identities of the compile-check executable and guest-run program. Both JSON argv arrays require exactly one standalone `{fixture}` argument, not an interpolated shell string.

Run `node --test tests/value-pipe-tuples-v1*.test.mjs` to check fixture integrity and the adversarial runner canaries: **host-only/source-only tests; no guest compiler execution**.

A passing run is insufficient for full parity until executed CI steps,
runner identity, exact source and compiler tree identities, binary/artifact
identity and independent review are also attached. Absent tools and
unsupported backends must fail rather than emit a synthetic success.

## Provenance boundary and adversarial result

The runner's `attestation_status` is **`UNVERIFIED` even when it exits zero**.
This is deliberate: a deliberately fabricated executable can accept the positive
source, print the expected `39\\n`, and reject all negative inputs by filename.
Local mock/negative-canary success proves only that runner checks behave as
specified, *not* that the chosen command is a genuine backend compiler.

Promote an execution to backend/AOT evidence only after independent checks of:
(1) compiler PR exact-head and Git tree; (2) compiler and, when separate,
compiled guest artifact hashes, with build/link commands; (3) matching canonical
fixture blob hashes; (4) executed CI job attempt, runner, and nonzero steps;
(5) actual generated guest code and stdout; (6) compile-phase negative rejection
without IR/artifact leakage; (7) independent reviewer approval. The Java
Native Image launcher does not substitute for LLVM/.NET/Wasm/Forge guest AOT.

The argv first element must be an explicit resolvable filesystem path; PATH
lookup and shell interpolation are intentionally disabled. An interpreter such
as Node or dotnet may pass the executable identity check while the real compiler
is a script/assembly; in that case the independent receipt **must also hash
and identify that compiler payload**. A user-supplied `ATTO_TUPLE_COMPILER_ID`
is not independent source provenance.
