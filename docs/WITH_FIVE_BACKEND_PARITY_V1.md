# AttoLang `with` immutable updates — five-backend conformance v1

**Status: contract and guest fixtures only. No five-backend execution parity is claimed.**

The 10 immutable guest `.atto` files in `fixtures/with-ownership-v1/`
are the byte-identical inputs to be used by all compiler/toolchain
admissions. Functions use snake_case; instance receiver is **`self`**, not
`this`, and all callable returns are explicit.

## Required ownership contract

- A readonly structural record whose fields are certified `Copy` may be
  reconstructed from an ordinary value or `rt copy`, preserving the old value.
- A nominal class requires an explicit validated copy contract for `rt copy`;
  `with` must construct a distinct owner, not alias a JVM/managed pointer.
- `rt take` transfers the source owner; subsequent source reads fail.
- All replacement fields must be type/visibility/ownership checked; expressions
  evaluate once in source order and observe the *original* receiver, not prior
  replacements. Publication occurs only after successful evaluation.
- Live borrows, actor `self` sealed state, mutable guards, resources lacking a
  copy contract, unverified aliases or cross-isolate owner handles cannot copy.
- Unwind must release replaced affine resources exactly once; no blanket
  deep clone. Full AOT must avoid runtime reflection and hidden GC assumptions.
- Until a backend has typed lowering and real guest execution, it must
  **fail closed with a compiler-owned `WITH_BACKEND_UNSUPPORTED` diagnostic**.
  Generic syntax failures, JS simulators, scalar constant-folding and
  host-only models do not count as guest execution parity.

## Expected evidence (per backend and per exact Git SHA)

| Backend | Current reference evidence | Release gate |
| --- | --- | --- |
| Java / Truffle | Draft PR #2832 narrow guest subset passed 19/19; new contract fixtures unexecuted | Full-tree JVM + GraalVM Native Image |
| LLVM | No `with` native IR/drop/ownership lowering | Compiler-owned rejection, then native O0/O2/ASan/UBSan |
| Wasm | Depends on pinned LLVM frontend; no independent semantics in JS host | Diagnosed LLVM compiler reject or executed wasm32 export |
| Forge | Stage-0 scalar compiler, no class/record update IR | Compiler-owned rejection, then JIT and full AOT guest |
| .NET | Scalar Native AOT subset, no typed `with` lowering | Compiler-owned rejection, then Linux/Windows Native AOT guest |

The manifest `contracts/with-ownership-v1.json` is deliberately marked
`candidate-not-five-backend-verified`. The source-only verifier ensures
that evidence cannot be promoted through a manifest label change.

**Security:** These contract files were independently authored in the
source organization. Do not transfer additional private source files to
an alternative runner without independent approved carrier policy,
exact-SHA pinning and authenticated receipts.
