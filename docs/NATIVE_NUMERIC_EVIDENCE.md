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
      --clang-resource-dir=/canonical/reviewed/clang/resource/dir \
      --source-commit=EXACT_40_HEX_LLVM_HEAD \
      --manifest-sha256=EXACT_64_HEX_FIXTURE_HASH

This command has no skip mode: omitted/invalid pins exit 2. Compute the fixture hash independently using `sha256sum fixtures/numeric-separators-source-v1.json` on the exact reviewed corpus commit; the adapter will fail before spawning any tool if those bytes differ.
A completed but mismatching run exits 1; a matching 26-case execution exits 0
and prints a JSON *native LLVM guest evidence* receipt.

## Exact-source Git checkout preflight

Before building a real compiler from an approved local LLVM checkout, verify
the expected **commit and root Git tree** and require a completely clean
worktree (tracked changes, untracked files and dirty submodules fail closed):

    node bin/verify-source-checkout.mjs \
      --source-dir=/approved/absolute/llvm-checkout \
      --commit=f9e4dad86532509833400cc476abfbad2985a9c2 \
      --tree=3a7839550b3696bc65796a405e03b305227aacad

The expected pair above identifies LLVM PR #918 at the audit point; update
it only following an independently reviewed new exact commit/tree pair.
The preflight executes bounded, read-only Git object/index inspections
with a deliberately minimal environment, disables fsmonitor/untracked cache
and enforces executable file modes. It **does not invoke `git status`**,
which can run repository-configured clean filters. Instead it compares the
stage-0 index entries against `git ls-tree -r HEAD` and hashes **unfiltered
raw filesystem bytes** using the Git SHA-1 blob framing for every regular
tracked file. A clean-filter-normalized yet modified source file is
rejected. It also rejects symlinks, gitlinks, ignored and untracked files,
index concealment flags, SHA-256-format Git repositories, and unsupported
file counts/sizes (at most 25,000 files, 128 MiB per file, 1 GiB total).
A failed inspection exits 2.

The receipt includes `trackedRawBytesVerified:true`, a verified file count,
and `commitAndTreeVerified:true`, applying only to the **observed instant**.
These checks do not freeze a checkout against later mutation and explicitly
report `compilerBuildAttested:false` and
`privateSourceTransferAuthorized:false`. It must run **before** compilation:
a normal build writes output into the working tree, so compile into an
out-of-tree build directory and separately record the compiler output's
SHA-256 and the build logs.

The helper does not authorize a cross-org mirror, certify the binary was
built from the verified checkout, or substitute for required trusted review.
The fifteen self-contained Node tests in
`tests/source-checkout-evidence.test.mjs` exercise real local Git
repositories, positive admission, tracked/untracked/ignored file denial,
Git skip-worktree and assume-unchanged index concealment, wrong hashes,
tracked symbolic links and Git submodules, acceptance of regular executable
files, executable-mode changes hidden by
local `core.filemode=false`, symlinked roots, nested-directory and CLI
fail-closed behavior. The auditor forces `core.filemode=true` and only
admits index entries with regular-file modes `100644` or `100755`; the
current pinned LLVM PR #918 root Git tree (1,170 entries) was inspected and
contains no nonregular file entries. A further nine real-Git tests in
`tests/source-checkout-raw-blobs.test.mjs` cover malicious clean-filter
normalization, staged-index divergence, and ensuring the auditor itself
does not invoke configured filters. The two committed exact-source test
modules were executed together locally: **24 passing tests**, verified
against matching Git blob IDs. The full project `npm test` and real
Oreslang compiler execution still require an approved source runner.

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
5. Copy both SHA-256-verified compiler and Clang executable bytes to a new
   mode-0700 private workspace, chmod the executable snapshots 0500, and
   execute those snapshots (never the original caller path). Verify both
   snapshot hashes immediately after copying; path mutations during copy
   reject admission. Re-hash **both** snapshots and originals at suite exit.
   Any changed executable revokes all results. Temporary binaries, source,
   LLVM IR, executable and shim are removed.
6. Supply Clang's reviewed canonical resource directory explicitly with
   --clang-resource-dir. It can be determined from the trusted original
   installation with `/absolute/path/to/clang -print-resource-dir` before
   running the suite. The native runner requires a canonical **directory not
   writable by group or others**; symlink aliases and group/world-writable
   resource roots fail closed before any guest compiler invocation.
   The native runner executes only the **private snapshots**, not the mutable
   caller paths. The mode check is a limited local integrity precaution:
   resource contents are not copied/hashed, privileged or same-UID processes
   may still modify them, and parent directories may have separate risks.
   Resource files, shared libraries, the linker and host system remain
   **external trusted dependencies**, not part of the two executable hashes.
   Compiler build provenance still needs an independent exact-tree review.

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

## Subprocess evidence integrity

A rejected fixture cannot be accepted from a secondary or trailing forged
`oreslang-llvmc:` line: only the **first nonblank diagnostic line** supplies
the primary failure category. That first line's message must **begin** with
the exact expected category, rather than mentioning it inside a generic
internal error or quoted message. Every compiler receipt records its exit status,
signal/error, original stdout/stderr byte counts and SHA-256 checksums.
Clang and executed-guest receipts also record their signal/error, plus
appropriate output hashes and byte counts. An otherwise successful Clang
invocation with unexpected stdout is not accepted as a clean guest build;
Clang warnings on stderr are separately retained as hashed evidence. Hashes are computed on the *raw pipe buffers*
before UTF-8 decoding, so binary or malformed output cannot silently change
the evidence digest via text replacement characters. Process timeouts,
signals and output-buffer failures fail closed.

## Test coverage and executable identity limitations

`node --test tests/native-numeric-source-evidence.test.mjs` includes real
subprocess checks for exit failures, Unix signals, timeouts, bounded output,
fake compiler diagnostics, symlink rejection, wrong SHA-256, non-private
workspace admission and mutation of a caller's tool after snapshot.
These are **harness hardening tests**, never evidence of Oreslang execution.

Even a successful 26/26 receipt has `sourceCommitAttested:false` and
`parityCertified:false`: it is an **execution observation** pending
independent binary build provenance, reference-backend differentials,
runtime policy checks and reviewer approval.

Only trusted local toolchains may be executed; staged executable bytes help
prevent post-hash caller-path substitution, but do not sandbox malicious
compilers, dynamic libraries, external Clang resources or a hostile host.
