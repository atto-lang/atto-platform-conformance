# Verified Core protocol declaration cases

These cases check the file-local `define protocol` grammar, deterministic state/message edges, and typed scalar payloads through the normal compiler entry points. Accepted cases execute the enclosing scalar `main`. Rejection cases verify diagnostic categories and require that LLVM and .NET emit no guest artifact. Protocol actor binding and dispatch are outside these compiler fixtures.

```sh
ATTO_VERIFIED_CORE_PROFILE=verified-core-protocol-declarations-v1 node bin/verify-verified-core-quantities-native.mjs java /path/to/atto-source.java
ATTO_VERIFIED_CORE_PROFILE=verified-core-protocol-declarations-v1 node bin/verify-verified-core-quantities-native.mjs llvm /path/to/oreslang-llvmc
ATTO_VERIFIED_CORE_PROFILE=verified-core-protocol-declarations-v1 node bin/verify-verified-core-quantities-net.mjs /path/to/atto-source.net
```
