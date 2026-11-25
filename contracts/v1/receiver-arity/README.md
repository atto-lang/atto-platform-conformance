# Receiver-erased method arity: executable gate

This directory contains **12 canonical source fixtures**, bound to Git blob
identities in `manifest.json`. Four are accepted classes with exit `42`; four
are duplicate class method slots; four are duplicate actor slots.

## Source-free checks

From the repository root:

```sh
node --test contracts/v1/receiver-arity/manifest.test.mjs \
  contracts/v1/receiver-arity/run-llvm.test.mjs
```

These checks validate the corpus and the evidence gate's rejection logic.
They do **not** compile Oreslang and must not be reported as backend parity.

## Actual LLVM native class execution

Build the real LLVM compiler from an exact reviewed PR head. Then invoke:

```sh
node contracts/v1/receiver-arity/run-llvm.mjs \
  --compiler=/ABSOLUTE/PATH/oreslang-llvmc \
  --compiler-sha256=EXACT_SHA256_OF_EXECUTABLE \
  --compiler-source-sha=EXACT_40_HEX_SOURCE_COMMIT \
  --clang=clang
```

The runner snapshots and hashes the compiler and source fixtures, compiles
four native class guests to LLVM IR, links them, and checks exit code `42`.
Four duplicate method cases must fail with compiler-owned `x/0` or `x/1`
diagnostics, exit code 1, and no LLVM IR. The runner has no optional skip.
Missing compiler, wrong SHA, failed links and unexpected guest results fail.

A successful run reports four guest executions, four precise duplicate
rejections, and **four actor cases explicitly pending**. The
`compilerSourceShaClaim` field records only a caller-supplied revision label;
it does not attest that the compiler binary was built from that source.
Independent build provenance remains mandatory.

The LLVM actor frontend is currently restricted to synchronous scalar
`on_message(int)`. Generic parser rejection is not proof of actor method
overload parity. Actors are not executed by this native class gate.

## Private CI boundary

This test must run locally or within an authorized source context. A private
cross-org Git mirror requires independent, reviewed approval, protected
source main, exact destination identity and full-tree verification.
An alternate organization's available Actions minutes do not permit
private source transfer on their own.
