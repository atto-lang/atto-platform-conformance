# Numeric source parity: real LLVM/Clang execution gate

This is an opt-in, required-on-invocation, real-compiler evidence lane for
the candidate fixture file at fixtures/numeric-separators-source-v1.json.
The 26 cases include 12 accepted i64 results and 14 rejected source forms.
WASM is LLVM-derived and must not be counted as an independent parser.

## Preconditions

- Use a trusted, locally approved checkout of the exact LLVM PR head containing
  signed-minimum and unary-plus source support.
- Build the real oreslang-llvmc, with LLVM development files and Clang installed.
- Use Node.js 22+ in the approved workspace. All source and toolchain paths
  remain local; no private cross-organization repository export is performed.
- Independently verify the Git tree, build command, toolchain versions, compiler
  provenance and binary-to-source relationship. The command accepts a commit
  string but cannot cryptographically prove that it built the compiler.
- Supply canonical absolute, non-symlink paths and exact SHA-256 of both
  executables. Clang is a build dependency, not a guest implementation.

Example (replace all paths and pins with locally verified values):

    node bin/verify-native-numeric-source.mjs \
      --compiler=/approved/build/oreslang-llvmc \
      --compiler-sha256=EXACT_64_HEX_HASH \
      --clang=/approved/toolchain/clang \
      --clang-sha256=EXACT_64_HEX_HASH \
      --source-commit=EXACT_40_HEX_LLVM_HEAD

This command has no skip mode: omitted/invalid pins exit 2.
A completed but mismatching run exits 1; a matching 26-case execution exits 0
and prints a JSON *native LLVM guest evidence* receipt.

## What is executed

For each of the 26 exact guestSource byte sequences:

1. Compile using the pinned native Oreslang LLVM frontend with --target=host.
   Rejected programs must not leak any LLVM IR on stdout.
2. Negative cases must fail via the actual primary oreslang-llvmc diagnostic
   with the required separator, signed-i64-overflow, type or syntax category.
   A Clang failure, signal, timeout, nonzero exit without the right diagnostic,
   or LLVM IR output does not satisfy an expected source rejection.
3. Accepted host-target LLVM IR must contain the **actual two-function
   ABI**: exactly one `i64 @__oreslang_guest_main()` Oreslang function and
   one `i32 @main()` OS/process wrapper. Retire only the i32 host wrapper,
   then link a trusted C reporting shim that calls the real i64 guest symbol.
   The ordinary wrapper clamps/converts exit status; it is **not** a source of
   full-width i64 evidence. This is verified against LLVM LlvmCodegen.cpp.
4. Execute the compiled guest; compare its exact decimal stdout to the expected
   i64. Any extra output, nonzero exit or signal fails.
5. Re-hash compiler and Clang binaries after the suite. Detected drift revokes
   the entire run. Temporary source, LLVM IR, executable and shim are removed.

Only use this runner with reviewed compiler/source bytes: it executes real
subprocesses and is not a sandbox for untrusted executables.

## What this does not prove

This lane does not execute Java/GraalVM, .NET/CIL or WASM guest modules.
Those backends require separate real-fixture execution adapters.

The receipt explicitly says sourceCommitAttested: false because a declared Git
revision is not proof of the binary build. Neither is this proof of actor
isolation, async semantics, GC, cancellation or cross-platform source parity.

Current GitHub Actions workflows that report zero job steps supply only
pre-execution infrastructure evidence. If Actions remains blocked, use an
approved local/self-hosted runner and obtain independent review. Private
mirroring must pass the mandatory pre-copy visibility and allowlist gate.
