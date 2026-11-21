# Actor-state borrow CFG / nine-backend conformance gate

**Status: model baseline only. No nine-backend executable parity is claimed.**

The companion `semantic-cases.json` is the same Git blob in each active
`atto-source.*` backend (Java, LLVM, .NET, Wasm, Forge, Cranelift, JavaScript,
Rust and HDL). Run:

```sh
node --test tests/borrow-mir-v1-contract.test.mjs
```

It checks 22 restricted *source-free* ownership CFG cases, bounded input
vocabulary, distinct owner/loan definitions, graph joins, and rejection of
unsupported operations or forged certification receipts.

## Evidence levels

A source-free model pass cannot establish that a real compiler emitted the
tested facts. Backend receipts must be independently bound to an exact
source commit, Git tree, Git blob inventory, compiler-produced typed-MIR
inventory, emitted instructions/diagnostics, executed runner steps, and
independent review. No self-reported `CERTIFIED` bit is trusted.

The Rust browser compiler draft PR #488 implements **restricted source-derived
V0 flat guards and V1 literal-condition four-block diamonds**, checked against
the standalone canonical Rust checker draft PR #46. Its exact-source private
run [44946623658](https://github.com/ores-data-platform/atto-ci/actions/runs/44946623658)
also proves the default-thread-stack 250-link addition regression now passes.
This is `HOST_ONLY`, **not** full typed CFG/NLL or guest certification.

Other backend implementation states remain **NOT_EXECUTED** for this complete
borrow-CFG contract until native compiler-derived and executed evidence is
collected. Rejecting unsupported actor borrows before emitting code is an
admission safety property, not a claim that actors are implemented.

`atto-source.atto` and `atto-source.realtime` are presently minimal
repository scaffolds, not functional additional compilers.

## Required native parity progression

1. Accept/reject the same canonical positive and negative `.atto` sources
   inside each backend's real parser and type checker.
2. Verify dynamic branches, independent read/write loan rights, last-use
   lifetimes, joins, loops, suspension, exceptions and cancellation; if
   unsupported, issue a stable diagnostic **before** code emission.
3. Cross-check real compiler-generated MIR with canonical Rust, not a
   separately invented fixture report.
4. Verify actual guest/native execution, including negative emission denial.
5. Maintain exact-head private CI and independent human/AI reviews under the
   existing ready-cycle policy.

This contract is intentionally fail-closed until all of those proofs exist.
