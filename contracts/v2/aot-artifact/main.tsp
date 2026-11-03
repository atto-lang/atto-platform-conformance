import "@typespec/json-schema";
using JsonSchema;
namespace Atto.Aot.V2;

// Shape only: backend/format/OS combinations are additionally constrained
// by manifest.schema.json and must be enforced by every typed backend parser.
model CompilerIdentityV2 {
  backend: "java-graalvm" | "llvm" | "wasm-wasmtime" | "dotnet-nativeaot";
  version: string;
  git_commit: string;
  mode: "per-guest-aot" | "portable-wasm" | "wasmtime-precompiled";
}
model SourceIdentityV2 {
  sha256: string;
  expanded_sha256: string;
  ast_sha256: string;
}
model ArtifactIdentityV2 {
  sha256: string;
  @minValue(1)
  @maxValue(9007199254740991)
  size_bytes: safeint;
  kind: "native-executable" | "portable-wasm" | "precompiled-wasmtime" | "native-wasm-host";
  format: "elf" | "pe" | "macho" | "wasm" | "wasmtime-serialized";
  os: "linux" | "windows" | "macos" | "wasi";
  arch: "x86_64" | "aarch64" | "wasm32";
  abi: "gnu" | "musl" | "msvc" | "darwin" | "wasi";
  target_triple: string;
}
model RuntimePolicyV2 {
  guest_jit: false;
  interpreter_fallback: false;
  runtime_guest_compilation: false;
}
model ProvenanceV2 { builder_id: string; }
@jsonSchema
model AotArtifactManifestV2 {
  schema_version: "atto.aot-artifact.v2";
  compiler: CompilerIdentityV2;
  source: SourceIdentityV2;
  artifact: ArtifactIdentityV2;
  runtime: RuntimePolicyV2;
  provenance: ProvenanceV2;
}
@jsonSchema
model DetachedSignatureV2 {
  schema_version: "atto.aot-artifact-signature.v2";
  manifest_sha256: string;
  algorithm: "ed25519";
  key_id: string;
  signature_base64: string;
}
