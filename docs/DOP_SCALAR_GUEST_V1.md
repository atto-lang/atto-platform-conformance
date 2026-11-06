# AttoLang DOP scalar guest v1: reference oracle and evidence boundary

This is a **versioned portable target**, not a claim that all five compilers
execute data-oriented source. The precise fixture is byte-for-byte identical
to oreslang-source.llvm draft PR #1308 at its recorded source blob SHA.
The fixture is an actual .atto program using two separately allocated
primitive Array<int> columns. It deliberately **does not** claim an
inverted class/struct, AoSoA lowering, actor-owned storage, or true SIMD.

## What is checked now

Run: node --test tests/dop-scalar-guest-v1.test.mjs (Node >=22).
These tests verify fixture provenance and reference computation for AoS, SoA and
AoSoA-16 at empty, edge and 32,768-row inputs. They check signed-i64
arithmetic bounds and poison evidence receipts that have missing CI steps,
a mismatched HEAD, missing compiler/guest hashes or no executed tests.
This only executes the Node host-model oracle, **not the .atto compiler**.

For 32,768 rows and ten sweeps, the guest must exit 0 after verifying
checksum 537509888, first position 20, last position 32787, and final
velocity 2. This workload is within LLVM's existing per-array limit
of 65,536 elements, as documented in PR #1308.

## Exact-head backend gate (each backend independently)

1. Pin the compiler repository's 40-character HEAD SHA, its Git tree SHA,
   and the fixture's Git blob SHA. Re-check them after execution. Do not
   implicitly replace the fixture with translated or host-only source.
2. Compile that same .atto fixture through the **real backend toolchain**;
   run the resulting guest executable/module with a positive control and
   confirm exit 0. A parser-only pass is not a guest pass.
3. Record the compiler and fixture SHA-256, generated guest artifact SHA-256,
   actual command/toolchain, discovered/executed test count, GitHub run and
   admitted runner IDs, and nonempty timestamped **executed** step records.
4. Read the run/jobs/artifact details back from the GitHub API and compare to
   the receipt. validateDopGuestReceipt only validates a receipt's shape;
   its synthetic positive control is **not a cryptographic attestation**.
5. Classify each backend as PASSED, FAILED, UNSUPPORTED, or NOT_EXECUTED.
   When the feature is absent, require an executed compiler-owned rejection
   without an output binary before calling it UNSUPPORTED; otherwise use
   NOT_EXECUTED. Zero-step runner failures are NOT_EXECUTED.

LLVM draft #1308 supplies scripts/verify-dop-atto-aot.sh for real LLVM IR
and Clang guest execution, but the execution gate still needs a stepful,
verified exact-head receipt. Java draft #2272 is only a closed scalar cpu {}
preview and not interchangeable with the two-array guest fixture; Java
#2550/#2554 host storage and unsupported inverted declarations must not be
counted as positive guest execution. Wasm, Forge and .NET require their own
real compiler and runtime execution receipts, not host storage tests.

## Separate future gates

- Add compiler-owned inverted AoS/SoA/AoSoA layout selection and generation/
  ownership checks: stale and foreign handles, overlapping loans, close while
  borrowed, swap-delete reuse, forbidden actor-state escape and cancellation.
- Add real scalar/SIMD **guest** instruction comparison with partial tails,
  unaligned accesses, checked integer arithmetic and defined floating-point
  NaN/signed-zero semantics. An admission-only Wasm SIMD test is insufficient.
- Only after a device ABI exists, add typed gpu { cpu {} } and
  cpu { gpu {} } source checks, upload/download ownership and physical GPU
  receipts. Explicit GPU calls must never fall back to CPU silently.

No private GitHub source-tree transfer or cross-organization CI mirroring is
part of this contract. The source-owner's security approval is required for
any independent private runner/export, separately from this test corpus.
