# Oreslang backend parity: batch 1 (tasks 1–5)

Status: proposed, unverified; no source-backend semantic parity is certified by this change.

## Context / why this is separate

The existing `fixtures/manifest.json` and `src/harness.mjs` provide a two-case scalar admission harness. Preserve those contracts and their tests. Conformance PR #41 is hardening that existing runner; this wave-one addition is a **separate** corpus and matrix, so its tests do not override or accidentally promote the current admission evidence. Java #1067 validation integrity, Java #1087 lexical captures, Java #1090 private-abstract actor entrypoints, .NET #37 / Forge #30 shared scalar suites and Common Source #28 HIR/MIR are independent work in progress.

## Five scoped deliverables

1. **Feature matrix** (`manifest.json`): five implementations and ten engineering categories. `reported` / `partial` are inventory observations based on repository documentation, never execution evidence; all `verified` values are fixed to `false` pending independently reviewed evidence.
2. **Executable real-compiler admission tool** (`bin/wave1.mjs`): requires absolute executable, declared exact 40-character source SHA, and one standalone `{file}` argument; shell-free subprocess with bounded output/time and SHA-256 hashes of each fixture and executable. An `OBSERVED_PASS` is an admission observation only, not source-to-binary attestation or guest execution. The tests use **fake compiler responses** solely to validate the runner.
3. **Grammar contract**: valid `define pub fnc` and malformed parameters, where the rejection requires a primary syntax diagnostic.
4. **Scope contract**: module-scoped source and an unresolved symbol inside a module, requiring that identifier in a primary error diagnostic.
5. **Type/call contract**: typed function, valid invocation, and extra-argument rejection requiring a primary arity diagnostic.

## How to run

```sh
node --test parity/wave1/tests/wave1.test.mjs
node parity/wave1/bin/wave1.mjs --list
node parity/wave1/bin/wave1.mjs --backend=java
node parity/wave1/bin/wave1.mjs --backend=llvm --category=scalar --argv='["/absolute/path/to/oreslang-llvmc","{file}"]' --source-sha=REPLACE_WITH_REAL_40_HEX_SHA
```

The final command makes a **compiler-admission attempt only** if the actual native compiler is installed. Source compilation may need a reviewed backend-specific adapter for diagnostic categorization or calling convention. Hashing a launcher or a compiler executable does not authenticate its dependency closure. No backend should be marked conformant based on the ledger, mock tests, an untrusted JSON report, or a job that ran no steps.

## Follow-up acceptance gates

- Inspect actual source frontend syntax and diagnostic output in each backend and adapt only with reviewed normative language requirements; do not loosen strict negative controls simply because a compiler fails for another reason.
- Integrate independently pinned real Java and LLVM compiler commands, then .NET, Forge and LLVM→Wasm. Compile **and execute** accepted cases, compare actual guest values, and add negative type/scope fixture checks before promoting readiness.
- Verify real source Git trees, compiler artifact provenance, fixture blobs, toolchains, Actions jobs and runner-executed steps. Use a separately reviewed evidence schema if verification states ever become writable.
- Preserve source-org privacy; no Git-tree copying into public or unapproved cross-organization carriers to work around Actions admission failures.
- Keep Java PRs #1087/#1090, conformance #41 and Common Source #28 separate; review compatibility and do not claim this corpus implements those language features.
