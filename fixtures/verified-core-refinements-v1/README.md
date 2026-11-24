# Verified Core scalar refinement and contract cases

The shared fixtures exercise interval and relational checks at immutable bindings, private calls, and returns. They cover signed `int` and `i32` carriers, including bounds on normal results, explicit widening through a typed binding, and overflow before a later operation could cancel it. They check diagnostic classes for unavailable proofs, mismatched units, contradictory assumptions, and attempts to export a verified helper.

From an `atto-platform-conformance` checkout use the existing source-to-guest runners with the refinement profile selected:

```sh
ATTO_VERIFIED_CORE_PROFILE=verified-core-refinements-v1 node bin/verify-verified-core-quantities-native.mjs java /path/to/atto-source.java
ATTO_VERIFIED_CORE_PROFILE=verified-core-refinements-v1 node bin/verify-verified-core-quantities-native.mjs llvm /path/to/oreslang-llvmc
ATTO_VERIFIED_CORE_PROFILE=verified-core-refinements-v1 node bin/verify-verified-core-quantities-net.mjs /path/to/atto-source.net
```

An arithmetic failure is a distinct observation from a source rejection. JVM and CoreCLR report their respective arithmetic failure classes. The LLVM runner checks emitted guard blocks and a native trap. These runners produce local execution evidence without certifying builds through GitHub Actions.
