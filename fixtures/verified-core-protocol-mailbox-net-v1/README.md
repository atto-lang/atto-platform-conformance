# Verified Core .NET protocol mailbox conformance

Run from an `atto-platform-conformance` checkout. Supply a .NET 10 SDK and a runtime identifier for the current machine.

```sh
node bin/verify-verified-core-protocol-mailbox-net.mjs ../atto-source.net dotnet osx-arm64 ../atto-common-source
```

The runner emits three verified actor sources through `oresnet emit-actor-csharp`, publishes the generated classes and the runtime into a native executable, and runs the host. It checks compiled Connection and Payment traffic, signed carriers, a standalone actor source, and rejected messages and lifecycle order. The live frames are compared with the independent codec in `atto-common-source`. The stop cases cover aborting queued work and the admissible outcomes of a stop racing with a transition. The runner prints the compiler checkout, SDK and target, and hashes of the native executable and source inputs.
