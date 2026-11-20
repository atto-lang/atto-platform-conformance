// Interchange format for a compiler/runtime-emitted trace; grammar/semantics
// are checked by src/pipeline-runtime-evidence.mjs and exact CI provenance.
namespace Oreslang.Pipeline.V1;
enum TraceOp {
  reserve: "reserve", publish: "publish", deliver: "deliver",
  finalize: "finalize", complete: "complete", stop: "stop",
  restart: "restart", dropStale: "drop-stale",
}
model PipelineTraceEvent {
  @minValue(0) @maxValue(127) seq: int32;
  `op`: TraceOp;
  @minValue(1) @maxValue(2) epoch: int32;
  request: string | null;
  hop: int32 | null;
  ticket: string | null;
  stage: "source" | "transform" | "sink" | null;
  variant: "Signal.Data" | "Signal.Result" | null;
  value: int64 | null;
}
model PipelineRuntimeTrace {
  schemaVersion: 1;
  kind: "compiled-actor-pipeline-trace-v1";
  backend: "llvm-native" | "java-graalvm";
  sourceGitBlobSha1: string;
  events: PipelineTraceEvent[];
}
