import "@typespec/json-schema";
using TypeSpec.JsonSchema;

@jsonSchema
namespace Oreslang.ActorTreeV1;

model ActorIdentity {
  @minLength(1) runtimeId: string;
  @minLength(1) actorId: string;
  @minValue(1) incarnation: int32;
}

model ChildResourceState {
  actor: ActorIdentity;
  physicalDone: boolean;
  @minValue(0) nativeLoans: int32;
  pendingCleanup: boolean;
}

model ShutdownFailure {
  @minLength(1) code: string;
  @minLength(1) message: string;
}

model ShutdownReceipt {
  schemaVersion: "1.0.0";
  @minLength(1) stopId: string;
  actor: ActorIdentity;
  physicalDone: boolean;
  shutdownResult: "pending" | "success" | "failure";
  @minValue(0) nativeLoans: int32;
  pendingCleanup: boolean;
  @maxItems(1024) children: ChildResourceState[];
  failure?: ShutdownFailure;
}

model LifecycleEvent {
  @minValue(0) sequence: int32;
  kind: "parent_stop" | "child_stop" | "native_loan_released" |
    "source_cleanup_drained" | "child_physical_done" |
    "parent_physical_done" | "stale_callback";
  actor: ActorIdentity;
  @minValue(0) nativeLoans: int32;
  pendingCleanup: boolean;
  physicalDone: boolean;
  children?: ChildResourceState[];
  ticket?: string;
  accepted?: boolean;
}

model LifecycleTrace {
  schemaVersion: "1.0.0";
  @minLength(1) traceId: string;
  @minItems(1) @maxItems(4096) events: LifecycleEvent[];
}

model TaggedI64 {
  @minLength(1) variant: string;
  value: int32;
}

model TypedPipelineEnvelope {
  schemaVersion: "1.0.0";
  @minLength(1) messageId: string;
  direction: "forward" | "backward";
  from: ActorIdentity;
  to: ActorIdentity;
  @minValue(0) @maxValue(1024) hopIndex: int32;
  @pattern("^[a-f0-9]{16}$") schemaHash: string;
  payload: TaggedI64;
}
