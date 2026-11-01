# Userland .ores portability: exact-fixture evidence gate (candidate, not certification)

The canonical source/oracles live in the **private** `oreslang-proof-of-concepts`
repository under `src/libraries`. This source-free conformance manifest pins
five examples (`vec`, `hashmap`, `dop`, `iter`, `channels`) at immutable
PoC source commit `b7e92b77e86ffe2be29fa9163e61787285c2b245` (all 10
source/oracle blobs independently re-read and SHA matched) to their **Git blob
SHA-1s** and expected stdout. No compiler or library source bytes are copied
into this repo. A blob SHA is an identity hint, not proof of source provenance
or permission for cross-repository private-source transfer.

Six **independent** toolchain profiles are enumerated: Java/GraalVM, LLVM,
Wasm, native Rust+Cranelift, .NET Native AOT, and Forge. Cranelift is its own
`oreslang-source.cranelift` repository; it is **not** Forge or merely Wasmtime.
`oreslang-source.cranelift` currently compiles only a narrow scalar expression
subset and **cannot** compile these userland programs (which use helpers,
arrays, control flow, stdio and/or channels). It must continue to reject them
until native compilation support is actually added. .NET, Wasm and Forge also
require positive real-source evidence before their capability claims advance.

## Execution contract

For each profile, independently compile and run all five **unchanged** `.ores`
fixtures **on the original private PoC repository runner** at the pinned fixture
commit; the compiler repository and binary are independently recorded and
verified, but the test run must not move the PoC source to a compiler repo. Preserve exact stdout bytes including newline and exit code 0. Do
not implement or replace the `.ores` algorithms in Java/C#/Rust/JavaScript,
substitute model results, or silently skip unsupported fixtures. Keep
`src/libraries` immutable and verify the full exact source/oracle blobs on an
authorized original repository checkout. Record separate PoC run/source SHA and compiler source commit/tree,
compiler artifact SHA-256, target guest artifact SHA-256, run/job attempt,
actual assigned runner, checkout/compile/guest steps and each guest binary hash.

Receipts are one-profile-per-file, with the fields validated by
`tools/verify-userland-portability.mjs`. Missing case, wrong fixture hash,
non-executed step, absent runner, substituted source repository, host-only
output, wrong stdout/exit status or wrong toolchain identity is `UNVERIFIED`.
A consistent synthetic receipt yields `RECEIPT_METADATA_CONSISTENT` and
**still** reports `portable:false` and `independentlyAttested:false`. The CLI
returns exit code **3**, not 0, for such an untrusted candidate; malformed
or incomplete receipts exit 1/2. This is intentionally not a release check.

To obtain actual conformance, a separate trusted attestor must retrieve raw
GitHub run/job records (including complete pagination), exact current head,
immutable source blobs, original checkout provenance, compiler outputs,
actual guest logs and binary digest evidence independently. A report is not
proof just because its JSON shape is internally consistent. Missing actual
compiler execution or a zero-step Actions job means **not verified**.

## Security and ownership

The open private-source CI incident hold (#22 and #77) forbids using an
unapproved cross-org carrier, including private ones, to get Actions minutes.
This manifest and verifier read no private Git bytes from another repository;
source-local CI with preapproved access is the first choice. Independent
security review and protected main are required before any source transfer.
Zero-GC LLVM/Cranelift and minimal-GC Java remain implementation targets;
stdout matching alone does **not** prove GC, memory, async, actor or hard
real-time properties.

## Implementation order

1. Obtain a real source-org runner with executed steps. Make the five tests
   runnable from the original private PoC repository with pinned compilers,
   without copying private source into a new organization.
2. Implement and verify scalar/library imports and helper calls in Cranelift,
   `.NET` Native AOT and other bootstrap toolchains, then arrays/stdlib and
   channel oracles. No C#/Rust replacement of the userland algorithm.
3. Run the exact fixture/negative matrix on Java, LLVM, Wasm, Cranelift, .NET,
   and Forge. Certify each backend only with independent, exact-head evidence;
   report per-backend unsupported cases until then.
