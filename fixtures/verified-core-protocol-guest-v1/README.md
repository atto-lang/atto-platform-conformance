# Connection guest conformance

Run the shared fixture from the conformance checkout and supply the paths to the compilers and the shared reference checkout.

```sh
node bin/verify-verified-core-protocol-guest.mjs java /path/to/atto-source.java /path/to/atto-common-source /path/to/java /path/to/mvn
node bin/verify-verified-core-protocol-guest.mjs llvm /path/to/atto-source.llvm /path/to/atto-common-source /path/to/oreslang-llvmc /path/to/clang
node bin/verify-verified-core-protocol-guest.mjs net /path/to/atto-source.net /path/to/atto-common-source /path/to/dotnet osx-arm64
```

Set `ATTO_PROTOCOL_SOLVER` to the Z3 executable to check the reviewed fixture's serial staging model. For LLVM and .NET, set `ATTO_PROTOCOL_EVIDENCE_DIR` to a new directory to retain the five binaries and the proof and execution receipt. Replay with the same source and compiler revisions and solver binary.

```sh
node bin/verify-verified-core-protocol-proof.mjs /path/to/bundle /path/to/compiler-checkout /path/to/atto-common-source /path/to/z3 /path/to/compiler-executable
```

For .NET the compiler executable path is `oresnet.dll` next to its compiler core assembly. This replay runs the recorded native binaries. Use a bundle from an authorized, independently authenticated build of the pinned sources. The model proof and binary replay provide scoped conformance evidence. Full preservation of model semantics by compilation is a separate obligation.
