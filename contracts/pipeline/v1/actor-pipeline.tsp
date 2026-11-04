// Proposal-level TypeSpec. Nominal adjacency/role position are validated by
// validatePipelineContract(), not by TypeSpec's structural types alone.
namespace Oreslang.Pipeline.V1;

enum StageRole {
  readable: "readable",
  transform: "transform",
  writable: "writable",
}

model PipelineOperations {
  forward: "self.forward";
  backward: "self.backward";
}

model PipelineSemantics {
  forwardAcknowledges: "mailbox-admission";
  backwardCorrelation: "explicit";
  supervisorDataRouting: false;
  generationFencing: true;
  atomicPublication: true;
}

model PipelineStage {
  id: string;
  role: StageRole;
  forwardIn: string | null;
  forwardOut: string | null;
  backwardIn: string | null;
  backwardOut: string | null;
}

model PipelineEdge {
  from: string;
  to: string;
  forwardType: string;
  backwardType: string;
  @minValue(1) @maxValue(256) capacity: int32;
}

model PipelineProposal {
  schemaVersion: 1;
  kind: "typed-actor-pipeline-proposal-v1";
  operations: PipelineOperations;
  semantics: PipelineSemantics;
  stages: PipelineStage[];
  edges: PipelineEdge[];
  confirmedBackends: string[];
  pendingBackends: string[];
}
