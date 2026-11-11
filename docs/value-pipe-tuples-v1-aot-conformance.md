# AOT value-pipe tuples: executable conformance v1

Tracked by [#673](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/673).

Positive and four negative .atto inputs are byte-identical to the real guest
fixtures executed in private Scintilla run
[42936149128](https://github.com/scintilla-run/scintilla-run-e2e/actions/runs/42936149128),
where 30 actual Java/GraalVM JUnit cases passed and native-image produced a
native binary that executed the positive source. This is a *native launcher
running guest source*, not proof of compiler-generated standalone native guest
code for LLVM/NET/Wasm/Forge.

To run an independent backend proof, set all of:
- ATTO_TUPLE_BACKEND: one of the contract's backend IDs
- ATTO_TUPLE_COMPILER_ID: exact compiler head SHA and toolchain identity
- ATTO_TUPLE_COMPILER_BINARY: path to the actual executable binary
- ATTO_TUPLE_WORKDIR: execution working directory
- ATTO_TUPLE_RUN_ARGV_JSON: JSON argv for guest execution, with "{fixture}"
- ATTO_TUPLE_CHECK_ARGV_JSON: JSON argv for compile-only validation, with "{fixture}"

Then execute: `node scripts/verify-value-pipe-tuples-v1.mjs`.

For Java CLI (working directory at its built tree) a sample execution argv is:
`["./target/ores-aot","{fixture}"]`. A companion compile-check argv
must invoke the *same* backend's compile-only gate, not a different parser.
The runner compares exact stdout `39\n`, validates Git blob SHAs, requires
nonzero failures with category-matching diagnostics for every negative source,
and emits JSON metadata with the binary SHA-256.

Running `node --test tests/value-pipe-tuples-v1.test.mjs` only validates
source fixture integrity: **host-only, no guest execution**.

A passing run is insufficient for full parity until executed CI steps,
runner identity, exact source and compiler tree identities, binary/artifact
identity and independent review are also attached. Absent tools and
unsupported backends must fail rather than emit a synthetic success.
