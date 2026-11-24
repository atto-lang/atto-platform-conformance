# Verified Core protocol handler binding cases

The accepted programs bind Connection and Payment actors to verified local graphs and run the enclosing scalar `main`. Rejected programs exercise coverage, message payload matching, destination selection, the transition-only body rule, and attempts to invoke a handler as a scalar function. These fixtures test compiler binding. Live mailbox behavior is covered separately by the shared reference model pending backend execution.

```sh
ATTO_VERIFIED_CORE_PROFILE=verified-core-protocol-handlers-v1 node bin/verify-verified-core-quantities-native.mjs java /path/to/atto-source.java
ATTO_VERIFIED_CORE_PROFILE=verified-core-protocol-handlers-v1 node bin/verify-verified-core-quantities-native.mjs llvm /path/to/oreslang-llvmc
ATTO_VERIFIED_CORE_PROFILE=verified-core-protocol-handlers-v1 node bin/verify-verified-core-quantities-net.mjs /path/to/atto-source.net
```
