# AttoLang typed GPU kernel source-HIR v1

These eleven fixtures specify the narrow `pub gpu fnc` source-HIR subset.
They are **not** evidence of physical kernel support. See
[common-source GPU contract](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/245),
[Java/Graal GPU PR](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2582),
and [LLVM admission PR](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1457).

Java's `GpuKernelSourceHirV1` supports a closed typed scalar/buffer source IR.
`GpuKernelTailGuardV1` additionally checks that each 1D buffer access
uses the lane-zero index on a path guarded by `i < n`, or following a
must-return `i >= n` branch. This is source-shape domination only.
It **does not** prove that `n` is within every real allocation, nor
thread-group/barrier convergence, aliasing, tenant/device ownership, physical
SIMT execution, or completion-fence lifetime.

LLVM recognizes the explicit typed `gpu fnc` header and selected forbidden
tokens but rejects **every** device declaration before host codegen with
`GPU-KERNEL-008`; it does not yet have matching typed device AST/HIR.
There is no cross-backend compiler parity claim. Kernel ABI types here are
`int`/`i64`, `f32`, `bool`, and explicit f32
`GpuReadBuffer`/`GpuWriteBuffer`/`GpuReadWriteBuffer` views.

The corpus has one proposed accepted source shape and ten expected negative
cases, all marked `NOT_EXECUTED`. The Node test is only an exact-blob/schema
test. Promote a backend only after its own executed compiler evidence,
negative no-artifact receipts, source/tree/fixture/kernel binary SHA,
provider/driver identity, physical dispatch, numerical oracle, buffer loans
and independently verified device completion. Zero-step workflows do not
count as execution.

## G1c tail-bound source hardening

A canonical 1D f32 memory access is now admitted only under the specific `n`
integer kernel parameter that the proposed capacity preflight will check.
The previous acceptance of `if i < m` (some other integer parameter) or
`if i < 1024` (constant unrelated to the provider extent) was unsafe for
future composition with `over: [n]` and is rejected with `GPU-KERNEL-010`.
The two extra proposal-only fixtures are pinned in the source corpus.
These source checks are not authenticated allocation proof, JUnit execution,
physical GPU result, or cancellation/fence authority.


### G1f forged typed-HIR source-validation boundary (not device execution)

The Java GPU tail-guard verifier accepts public, constructible typed-source
records, so its verification cannot rely on compiler-lowering provenance.
At draft [Java GPU integration #2610](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2610),
head `0d0ac00a9258d91c9f9a0edc09e9a84b12567485`,
it rechecks typed expression opcode allowlists and arity, operand types,
declared read/write buffer parameters, scalar-only local bindings, branch
and return metadata, and void kernel results before source-tail claims.

[The G1f mutation manifest](../contracts/atto-gpu-typed-hir-forgery-v1.json)
pins 21 Java JUnit method names (20 expected rejections and one
nonexecuting canonical SAXPY control), plus exact Java Git blob identities.
The Node manifest test validates only declared metadata, not Java source
execution. The Java CI run `42333323638` had `steps=null`.
Do not treat these authored tests as observed `GPU-KERNEL-010` errors
until an authorized exact-source Java runner executes with nonzero steps.
No compiler-issued immutable ownership proof, device allocation loan,
GPU binary, provider completion fence, hardware result or CPU fallback
is established.
