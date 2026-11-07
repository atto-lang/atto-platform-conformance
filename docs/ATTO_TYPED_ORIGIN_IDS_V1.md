# AttoLang typed origin ID shape contract (NON-PROMOTING)

The JS `src/ownership-typed-origin-ids-v1.mjs` inspects a candidate typed place shape: positive numeric `bindingId`, nonnegative `originId` (zero means unknown), lexical root, owned/shared-loan/exclusive-loan mode, and up to eight named field projections. Rejects forged verification fields, unminted or unsafe IDs, malformed modes, unknown fields and overdeep paths.

Even two different positive `OriginId` values do **not** prove independent heap ownership without an independently attested compiler allocation/transfer proof. Every result is `ok=false`, `verified=false`, and `independentStorageVerified=false`. This JS module is NOT the production Java or LLVM compiler.

**Tests:** `tests/ownership-typed-origin-ids-v1.test.mjs` adds **22** source-only adversarial groups, all **22/22** executed in isolated V8 against the fetched exact authored JS. Existing source-only suites had 106/106 isolated groups; the new full authored inventory is 129 Node groups (128 runnable in isolated V8 and one CLI subprocess group requiring actual Node). Hosted Node run has not executed. Java and LLVM separately authored native compiler/JUnit tests; their results must never be combined as if identical proof classes.

**Backend contracts:** LLVM mints lexical `BindingId` per current function and nonzero fresh-only `OriginId` for admitted new class construction; a class move preserves its allocation origin. Java currently mints lexical BindingIds but retains unknown allocation origins (zero) until a later typed-MIR allocation pass. Neither backend may assert disjoint storage merely from distinct lexical IDs, and the JS model cannot promote claims to proof. Native five-backend conformance remains pending.
