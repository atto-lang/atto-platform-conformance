# Six-backend algebraic-data-type parity (additive v2)

The canonical Oreslang fixture bytes and semantics are unchanged from
`contracts/enum-semantics-v1.json` (36 cases: 8 accept, 28 semantic
reject). The new `contracts/enum-semantics-v2.json` targets **six**
backend implementations: Java/GraalVM, LLVM, Wasm, .NET Native AOT,
Cranelift and Forge. It is **additive**, so clients consuming v1 are not
silently reinterpreted. It contains 216 backend/case target assignments,
**zero certified guest executions**.

| Backend | Current audited boundary | Required for certification |
| --- | --- | --- |
| Java/Graal | Built-in Option/Result pattern coverage exists on main; nominal user enums are on draft stacks | Exact-head JDK 25 Graal guest + type and ownership diagnostics |
| LLVM | User-defined enum source currently rejected by compiler | Nominal frontend, IR lowering, Clang execution, ASan/UBSan |
| Wasm | LLVM-to-wasm32 scalar bridge denies unsupported ADTs | Actual compiled Wasm instantiation, owner/tag/payload identity, Wasmtime isolation |
| .NET | Scalar CIL bootstrap explicitly refuses nominal enums | Checked CIL emission and Native AOT guest execution |
| Cranelift | Scalar i64 JIT only; explicit nominal-ADT denial | Real nominal-tagged CLIF + native guest execution and drop/borrow gates |
| Forge | Independent bootstrap / self-hosting route, not synonymous with Cranelift | Independent compiled guest and strict source/ABI evidence |

Related native source-local drafts:
Java `audit/adt-six-backend-parity-20261101`;
LLVM PR #1257; Wasm PR #217; .NET PR #281;
Cranelift `audit/adt-six-backend-parity-20261101`.
The cross-backend test target is **not an implementation proof**.

## Verification sequence

1. Exact repository, compiler **source commit/tree**, fixture Git blob,
   executable binary SHA-256 and immutable input snapshot.
2. Runner successfully admitted with **nonempty job steps**, real toolchain
   execution, no skipped or expected-failure gate counted as pass.
3. Each of 8 accepted sources: genuine compiler frontend, lowered guest
   execution, byte-exact stdout and trusted termination; no host stub.
4. Each of 28 rejected sources: compile exit 1 with the **specific semantic
   diagnostic**, no code artifact. Generic unsupported-feature, parser crash,
   timeout, or missing runner does not count.
5. Separate actor-wire fuzz, unknown-tag rejection, bounded recursive layout,
   version fencing, move/drop/borrow and FFI payload proofs.
6. Independent review, branch protection and exact-head CI before any merge.

A local Node source/manifest validator, CTest refusal, C# parser denial,
Cranelift parser denial or source-free canary may improve security posture but
**never promotes** one of the six `confirmedBackends` values.
Private source must not be transferred outside authorized repositories.
