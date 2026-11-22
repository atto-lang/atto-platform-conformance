# Atto std.actor compiled guest receipt candidates

This source-only classifier **never emits PASS**. Even a synthetic, internally
consistent successful CI receipt yields `POLICY_EVIDENCE_CANDIDATE` with
`policyGuestVerified:false` and `runtimeVerified:false`. A reviewer must
independently authenticate GitHub repository, exact PR head and tree, blob SHAs,
compiler toolchain, run attempt, real job/runner/steps, guest artifacts and
test logs. Native runtime authority, supervisor CONTROL and physical quiescence
require separate executed proof.

The checker requires three compiled positive guests, six compiled guard mutation
canaries (exits 1, 18, 34, 100, 166, 232), and three semantic compiler-negative
no-artifact cases. It rejects a missing trusted backend-specific test plan; it
does not assume that Java, LLVM, .NET or other compilers use Rust CI job labels.
Future backends can use independent implementations and build procedures.

This code does not authorize private source export or establish Actions minutes.
