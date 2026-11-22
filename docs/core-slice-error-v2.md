# Core slice + error behavior contract v2

This is a **candidate**, not source compilation or real guest execution.
The JSON file contains signed i64 string vectors, checked owned-copy
`Option<int>` cases, Error numeric catalog conditions and nine negative
lifetime/exception admission requirements. All cases remain NOT_EXECUTED
until exact-head stepful compiler and guest evidence has been reviewed.

`node --test tests/core-slice-error-v2.test.mjs` runs an **independent
BigInt model oracle**, not any AttoLang compiler. The model check is useful
for identifying regressions in constants and arithmetic but cannot replace
compiler typechecking, guest execution or nominal class identity proofs.

Reconcile candidate spec atto-spec #31, Java core #1768, LLVM #867, and
the sibling nine-backend slice/iter/cmp draft PRs. Backend-specific source
is maintained independently, not shared as canonical byte-identical files.

No one should flip backend_evidence to VERIFIED without a real source
commit SHA, identical tested tree, nonempty CI steps and guest results.
