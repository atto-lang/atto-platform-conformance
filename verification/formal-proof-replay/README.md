# Source-linked formal replay (Rust-only, source-private)

This crate runs **genuine** SMT solver queries with a pinned solver SHA-256 and verifies exact Git checkout, source Git blob, proof query SHA-256, and required UNSAT and SAT-mutation results.

It intentionally has *no* third-party Rust dependencies and uses `cargo test --locked`. The binary is a build-time, Linux-oriented verifier that calls installed `git`, `sha256sum`, `timeout` and a **real** approved Z3 executable; it does not use Python, a network client or OresVM dependencies.

### Command

```
cargo run --manifest-path verification/formal-proof-replay/Cargo.toml --locked -- \
  --repository /path/to/exact/source-checkout \
  --commit EXACT_40_CHAR_SHA \
  --source stdlib/core.ores \
  --source-blob REVIEWED_40_CHAR_GIT_BLOB \
  --query-root /path/to/actual-ast-generated-smt \
  --solver /path/to/pinned/z3 \
  --solver-sha256 REVIEWED_64_CHAR_SHA256 \
  --proof min-implementation:min-proof.smt2:REVIEWED_QUERY_SHA256 \
  --mutant min-broken-source:min-mutant.smt2:REVIEWED_MUTANT_SHA256
```

Both query files must contain **one** SMT query each and emit exactly `unsat` and `sat` respectively. Do not feed the existing two-query `TypedScalarSmt.fromSource` output as though it were a one-query file: first split it through a separately reviewed and tested exporter; the verifier does not prove that extraction step is correct. Query signatures and expected digests must be independently reviewed; this tool **does not derive the proof from the AST**.

### Claims and limitations

- Pass output is `LOCAL_PROOF_REPLAY_PASSED_UNATTESTED`, not `backend_refined` or `release_qualified`.
- A syntactically SAT mutant is not sufficient to certify that it is a **real changed source program**; require signed source-linked mutant provenance and independently review the expected counterexample.
- This verifies bytes visible at the time of reading. Symlinks in source/query inputs are rejected, but a concurrent malicious local process could race solver and file replacement. Run in an isolated read-only checkout/runner, with immutable toolchain and no untrusted job privilege.
- It does not authenticate GitHub metadata or artifact identity, and a caller can submit a fake SHA-256 pair referencing their own solver/query. Production qualification requires a **trusted external manifest** and independent provenance retrieval.
- `timeout` and Z3 `-T:10` bound ordinary solver runtime, but this first pass has no memory RLIMIT; sandbox memory separately and reject unusually large solver stdout (4 KiB cap after execution).
- Arbitrary input SMT-LIB can encode trivial UNSAT/SAT. Formal source/model correspondence must be established by the real Java/LLVM checked-AST exporter and independent source contract.
- Java/Graal guest execution, LLVM O0/O2 execution, ABI/memory checks, effects/ownership proof and cross-backend parity are separate evidence levels.
- Private source must not be transferred to another GitHub org merely to obtain CI minutes. Only approved private runners/destinations may execute source-bearing verification.

This is the first executable Rust replay slice for conformance issue #184 and program #150, **not** a completion of authenticated release qualification.
