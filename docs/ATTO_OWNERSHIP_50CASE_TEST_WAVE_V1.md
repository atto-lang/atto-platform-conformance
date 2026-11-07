# Ownership test-wave matrix — 50 new test cases across three source repositories

**Design/evidence classification: NOT_EXECUTED backend proof.**

| Repository | New cases | Test surface |
| --- | ---: | --- |
| Java/GraalVM (stacked child of #2607) | 15 | JUnit Jupiter dynamic tests: parse success followed by production `OwnershipChecker.check` and exact `E_TAKE_UNTRACKED_PLACE` semantic code |
| LLVM (stacked child of #1494) | 10 | Native C++ AST place/loan authority classifier cases; actual compiler `OwnershipChecker.cpp` also patched for borrowed class-field Share |
| Platform conformance (stacked child of #546) | 25 | Named Node reference-model scenarios: canonical aliases, loans, moves, CFG joins, suspension and actor transport |
| **Total** | **50** | Three independent evidence classes; **not** interchangeable |

Additionally, the LLVM PR adds **one separate real .atto compiler-negative fixture**, `atto_share_borrowed_class_field_rejected`, requiring parser-positive semantic diagnosis `E_SHARE_BORROW`, raising its scoped compiler/guest inventory from 19 to 20. This extra compiler fixture is not counted in the 50-case matrix.

The conformance child increases the source-only Node workflow expectation from 34 to **59** named test groups (10 receipt-shape, 13 place/CFG, 10 mocked runner API, 1 CLI denial, 25 additional model scenarios). The **25 new model scenarios passed in isolated V8** against the exact retrieved reference module (synthetic/offline, not Node or backend execution); full 59-group hosted Node execution remains pending.

The source-owned LLVM and Java workflows must execute real compiler checks. A successful host-only C++ classifier, conformance model or synthetic receipt cannot replace parser-positive semantic rejection, correct emitted/absent binary proof, exact head and tree read-back or independent reviewer approval.

**Fail-closed acceptance before promotion:** exact PR head, clean source checkout with verified Git tree, assigned runner with nonzero actual executed steps, actual parser+ownership checker invocations, expected diagnostic, native or GraalVM guest oracle where positive, no skipped tests, independent review. No private source transfer to a different GitHub organization or unverified “green” override.
