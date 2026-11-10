# AttoLang logical operators — audit and conformance hardening (2026-11-10)

**Status: DRAFT SOURCE CONTRACT — NO NEW COMPILER-BACKED EXECUTION VERIFIED.**

## Canonical target
- Lowercase reserved infix `and`, `xor`, `or`; precedence `and > xor > or`, left associative, below equality and above ternary.
- Strict bool operands and bool results; do not weaken type checking of unreachable RHS.
- `and` / `or`: left-to-right short circuit. `xor`: left operand then right, each exactly once unless earlier evaluation fails; no short circuit.
- `^` and `^^` rejected, without partial LLVM IR or executable artifacts. Historical punctuation operators are not treated as proof of new canonical words.
- Actor/task suspension and cancellation are separate follow-up tests: no self-certified parity from the scalar fixtures.

## Review targets, not acceptance
- Java/GraalVM [#2648](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2648): word parser, strict types and suspended XOR callback handling; draft, exact-head JUnit + guest execution still required.
- LLVM [#1554](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1554): word parser, typed i1 / branch-PHI/XOR codegen; draft, actual O0/O2 compiler→LLVM IR→Clang linked guest plus sanitizers still required.
- .NET NativeAOT [#415](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/415): structured CFG/CIL and MethodDef; draft, exact-head linked NativeAOT binary execution still required.
- Wasm: existing `tests/boolean-source-parity-wasm32.test.mjs` invokes a pinned upstream LLVM compiler when configured; this is **not** independent Wasm Rust-frontend logical-word execution evidence. No scoped logical-word PR or certified guest run found in this audit.
- Forge [#241](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/241): new draft repairs a concrete reserved-keyword acceptance bug in both i64 frontend and callable frontend; strictly **rejection-only**, with 54 parser and 96 CLI negative invocations authored, not yet executed. It still has no typed boolean lowering or guest operator execution.
- Older [Java #1190](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1190) and [LLVM #558](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/558) admit historical `^^` in drafts; do not mix their grammar with the newer reserved-word contract without explicit semantic reconciliation.
- [Language spec #17](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/17) remains draft, not a merged normative contract.

## Source witnesses (not compiler tests)
`fixtures/logical-word-operators-v1/` carries exact SHA-1 Git blobs copied from scoped compiler branches: universal scalar truth/precedence fixture `9e3d2d230faaba5e1ccfeaf1c4449c0c2a120c34` (exit 42), ten fail-closed negatives (including dead-RHS type checks and reserved `and`/`or`/`xor` names), three precedence guests, and four `borrow mut` effects fixtures (AND/OR skip; XOR eager/order) from LLVM's scoped branch.

The fixture inventory is now 18 pinned cases: eight guest-exit cases and ten compile-rejection cases. The three new guest cases distinguish `and > xor > or` precedence, and the new negatives prevent operators from being reused as function names. A forged manifest cannot reach even the receipt-candidate state; source-only evaluation checks all pinned identities and required-execution gates. Step numbers/names must be unique, and fixture paths cannot traverse symlinks. All tests remain authored, not executed on GitHub Actions.

The **baseline** profile is a target for all five backends; the **borrow_mut_class_effects** profile is a separate advanced target and MUST NOT silently pass through a reduced .NET/Wasm/Forge subset. Compiler check-only and host-only source emulators do not count as guest execution.

Run source-only manifest unit tests with:

```sh
node --test tests/logical-word-operators-v1.test.mjs
```

These tests validate identities, intentional semantics and receipt denial mutations. They do **not** invoke any compiler, and their passing is explicitly **not guest parity**.

## Next smallest compiler-backed checks
1. Java PR #2648: exact-head `LogicalWordOperatorTest` via real JVM/GraalVM; include a suspendable XOR with downstream continuation throwing to prove one completion and a cancelled/failed operand that never executes later effects.
2. LLVM PR #1554: run `tests/native_logical_word_operators.sh` against the exact compiler head with Clang -O0/-O2 and sanitizers; add dead-RHS negative fixtures and assert no IR files.
3. .NET PR #415: run both linked MethodDef NativeAOT apps and verifier-negative tests on Linux against exact source/tree; confirm strict bool typing even for skipped RHS.
4. Wasm/Forge: add/identify exact-head real guest compilation and execution of `scalar-parity.atto`; if unsupported, record explicit rejection, not a parity pass.
5. Capture source head/tree/blob, build artifact hash, run/job/attempt/runner and nonempty successful named steps, raw guest exit code/stdout, and negative no-IR/no-binary. Independent review and approved source transfer are separate gates.

If GitHub records `steps=[]`, `steps=null`, or `runner_id=0`, classification is **runner admission failure / NOT_EXECUTED**. A different funded repository may run only with an independently authorized exact-tree source export. `assessLogicalReceipt` cannot authenticate live GitHub metadata and **never returns VERIFIED**, even for a well-formed candidate.
