import "@typespec/json-schema";
using TypeSpec.JsonSchema;

@jsonSchema
namespace Oreslang.ActorTreeV2;

model ActorIdentityV2 {
  @minLength(1) runtimeId: string;
  @minLength(1) actorId: string;
  @minValue(1) @maxValue(2147483647) incarnation: int32;
}

// JSON numbers are not suitable for cross-language signed i64 transport:
// IEEE-754 clients cannot represent all signed i64 values exactly.
// The canonical decimal string is validated by the semantic conformance gate.
model TaggedSignedI64V2 {
  @minLength(1) @maxLength(128) variant: string;
  @minLength(1) @maxLength(20)
  @pattern("^(0|-?[1-9][0-9]*)$") i64Decimal: string;
}

model TypedPipelineEnvelopeV2 {
  @minLength(1) @maxLength(128) messageId: string;
  direction: "forward" | "backward";
  from: ActorIdentityV2;
  to: ActorIdentityV2;
  @minValue(0) @maxValue(3) hopIndex: int32;
  @pattern("^[a-f0-9]{64}$") schemaHash: string;
  payload: TaggedSignedI64V2;
}

model ThreeActorRoundTripV2 {
  schemaVersion: "2.0.0";
  @minLength(1) @maxLength(128) pipelineId: string;
  @minItems(3) @maxItems(3) route: ActorIdentityV2[];
  @minItems(4) @maxItems(4) messages: TypedPipelineEnvelopeV2[];
}
