# Verified Core scalar refinement and contract cases

The shared fixtures exercise interval and relational checks at immutable bindings, private calls, and returns. They cover signed `int` and `i32` carriers, including bounds on normal results, explicit widening through a typed binding, and overflow before a later operation could cancel it. Explicit casts exercise signed lower and upper checks, narrowing on a successful return, and preservation of an operand's prior failure and relations. Static rejection cases cover unavailable proofs, incompatible units, contradictory assumptions, and attempts to export a verified helper.

From an `atto-platform-conformance` checkout use the existing source-to-guest runners with the refinement profile selected:

```sh
ATTO_VERIFIED_CORE_PROFILE=verified-core-refinements-v1 node bin/verify-verified-core-quantities-native.mjs java /path/to/atto-source.java
ATTO_VERIFIED_CORE_PROFILE=verified-core-refinements-v1 node bin/verify-verified-core-quantities-native.mjs llvm /path/to/oreslang-llvmc
ATTO_VERIFIED_CORE_PROFILE=verified-core-refinements-v1 node bin/verify-verified-core-quantities-net.mjs /path/to/atto-source.net
```

The corpus observes arithmetic failure, refinement violation, and source rejection separately. JVM and CoreCLR report distinct runtime diagnostics. The LLVM runner checks emitted guard blocks and a native trap. These runners produce local execution evidence without certifying builds through GitHub Actions.
