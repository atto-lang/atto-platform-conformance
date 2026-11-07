# Closed-world loan-token source model (NON-PROMOTING)

`src/ownership-nll-closed-world-v1.mjs` provides a **candidate-only** bounded straight-line token stream for shared/exclusive borrows, loan uses, source moves, and suspension. It derives last use indexes directly from the supplied operation stream. It rejects unminted/reused loan tokens, mismatched place and mode, unknown use tokens, mixed manual releases, missing final uses, unclassified reads/calls/sends/awaits, early moves and suspension while a loan's annotated uses remain outstanding.

Raw JSON input can omit real source uses or forge token identities. Therefore EVERY model result has `ok=false`, `verified=false`. Deriving an offset from untrusted input is not SSA, compiler provenance, or guest authorization.

`tests/ownership-nll-closed-world-v1.test.mjs` adds **20** named source-only tests. All passed in isolated V8 on exact fetched source, and **4/4** deliberate guard weakenings were detected. Inherited source-only groups total 163, so **183/183** isolated V8 groups pass across the full suite, using synthetic crypto/clone/GitHub API doubles. The hosted source-owned Node workflow now requires **184** groups (including one actual CLI subprocess test not executable in the V8 stub). No hosted Node or `.atto` guest run has executed.

The source-free GitHub Actions admission canary was re-run on existing run 42397858158; the new attempt's job still had `steps=null`. The underlying organization policy/billing/runner reason is not established by that symptom. No private source was exported.

The related LLVM child implements separate write-site tickets, unclassified-read denial and 28 new native C++ cases on production headers. Those cases require actual CTest execution and cannot be added to the JS result as compiler proof.

Pending: source-org runner recovery, exact-head executed C++/Node receipts, compiler-generated SSA use-def completeness, Java/GraalVM equivalence, exceptional/suspended task cleanup, and five-backend compiler guest parity.
