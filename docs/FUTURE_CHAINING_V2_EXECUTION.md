# Future chaining v2: compiler-backed execution admission

**Status: tooling committed, real guest acceptance NOT_EXECUTED.** This is not a
replacement for the existing source-free fixture gate. The eight-case manifest
continues to say `pending` for every backend. A native binary must actually
run the checks before anyone can claim observed guest evidence.

## Source and compiler inputs

Java's `dev.oreslang.launcher.OresMain` accepts
`oreslang-compiler --check source.ores` and
`oreslang-compiler source.ores`. The new Java-only executor
`tools/run-future-chaining-v2-guests.mjs` invokes **that** interface.

1. Obtain a native GraalVM Oreslang executable from an exact, independently
   approved Java source commit. Preserve the source commit SHA, Git root-tree
   SHA, complete build command, builder identity, toolchain version and the
   exact build run URL. Keep the binary and all dependencies inside the
   approved source/destination trust boundary.
2. Independently verify those build facts and the compiler binary's SHA-256.
   The JSON below is an *operator declaration*, **not** a signed attestation.
3. In an isolated, credential-free runner, with Node 22+, execute both the
   existing `npm test` suite and the compiler-backed command below.
   Do not use a private cross-org source carrier without the source project's
   explicit approval and protected-main contract.

A production provenance input has this structure (replace every placeholder
with independently verifiable real evidence):

```json
{
  "schemaVersion": 1,
  "backend": "java-graalvm",
  "compilerRepository": "ores-truffle-oreslang/oreslang-source.java",
  "compilerSourceCommit": "FULL_40_CHARACTER_COMMIT_SHA",
  "compilerSourceTree": "FULL_40_CHARACTER_ROOT_TREE_SHA",
  "compilerSha256": "FULL_64_CHARACTER_EXECUTABLE_SHA256",
  "buildCommand": "EXACT_REPRODUCIBLE_BUILD_COMMAND",
  "builderIdentity": "ACTUAL_APPROVED_BUILDER",
  "toolchain": "ACTUAL_JDK25_AND_GRAALVM_VERSION",
  "buildRunUrl": "https://github.com/OWNER/REPO/actions/runs/ACTUAL_RUN"
}
```

```sh
node --test tests/future_chaining_v2.test.mjs tests/future_chaining_v2_guest_gate.test.mjs
node tools/run-future-chaining-v2-guests.mjs \
  --compiler /absolute/path/to/native/oreslang-compiler \
  --provenance /absolute/path/to/build-provenance.json
```

The runner refuses missing pins, symlinks, non-regular inputs, mutated fixture
blobs, shell and JAR launchers (which cannot bind classpath dependencies by
hashing only the launcher), wrong native executable hash, timeouts, signalled
children, generic compile failures masquerading as expected rejection, and
incorrect runtime output. It copies the hashed native executable into a private
temporary workspace *before* running; it invokes no shell and provides no
repository credentials to the compiler. The eight fixtures are separately
checked against immutable Git-blob SHA-1 pins and hard-coded case expectations.
Positive cases require successful static checking **and** a successful guest
run with exact stdout. Rejection cases require a nonzero check exit and a
matching Future-layer/callback diagnostic fingerprint.

## Reporting and promotion boundary

- A run with all eight passing returns
  `COMPILER_EXECUTION_OBSERVED_PROVENANCE_UNATTESTED`, not a blanket
  release/pass claim. Verify source-to-binary build attestation, source-tree
  binding and exact carrier policy separately.
- A run with a missing/mismatched compiler, any error, timeout, or case mismatch
  exits nonzero. An unrelated native executable cannot count as a compiler.
- The source-free negative-control tests only prove that the gate rejects
  invalid artifacts, not that Oreslang guest semantics work.
- This gate does **not** prove actor physical retirement, scheduler lifecycle,
  GraalVM Native Image build reproducibility, cancellation races or parity on
  LLVM/WASM/.NET/Forge. Those require independently executed gates.
- The manifest must remain unchanged (all cases `pending`); promote per-backend
  evidence only after exact-head source/compilation/execution artifacts,
  independent review and binding to required source-PR checks.

**Security limit:** this runner is *not* an OS sandbox. A native binary can
execute arbitrary code. Run it only in a separately isolated, least-privilege,
network-controlled environment with no secrets and with explicit authorization
for any private code transfer.

## Native-image identity hardening and local source-free evidence (2026-10-30)

Before a guest check may count, the runner executes the pinned candidate with
`--build-info` under its credential-free, temporary workspace. The exact
native Oreslang launcher response must have **only** these fields:

- `build_mode: "aot"`
- `default_execution_mode: "aot"`
- `guest_execution: "interpreter-no-jit"`
- `managed_reference_mode: "compressed32"` or `"native64"`

Any nonzero exit, signal, execution error, unexpected stderr, missing/extra
field, wrong value, or oversized response fails closed. This is a behavioral
shape check **not a cryptographic signature or proof of origin**: independent
source-tree-to-binary attestation remains mandatory before release acceptance.

A `CAFEBABE` prefix is deliberately **rejected** rather than accepted as
Mach-O fat-binary evidence, because the same prefix also identifies Java
classfiles. Executable discovery remains conservative until an unambiguous
native format verifier and its adversarial tests are added.

**Local test evidence:** using Node `v22.16.0` on an ephemeral workspace, the
runner and regression test were independently verified against committed Git
blob SHA-1 identities `6c0c9d9fc78fcf2d59a7e768a0308989651e4ebf` and
`1ca7cb6f6d3c2d116b619103b2751499df45ea8a`. All seven source-free gate
negative controls executed and passed (7/7). The eight independently
reconstructed `.ores` fixtures matched their separately committed source
Git blob hashes (8/8); a manifest `verified=true` fault injection was rejected
and a fixture content-mutation hash drift was detected. The local manifest was
reconstructed from its contract fields, **not** asserted to match the original
manifest Git blob byte-for-byte; this does not imply the full repository
`npm test` suite executed. No production Oreslang native binary was present,
so guest compilation, runtime stdout, Native Image provenance and backend parity
remain **NOT_EXECUTED**. The source organization's Actions runner still reports
pre-step failures; no private cross-organization source export took place.
