import "@typespec/json-schema";
using JsonSchema;
namespace Atto.Aot.V2;

// Detailed backend and target constraints are specified by manifest.schema.json.
@jsonSchema
model AotArtifactManifestV2 {
  schema_version: "atto.aot-artifact.v2";
}
