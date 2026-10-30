// Compiler-generated conformance data, never a guest-callable capability.
// Runtime admission additionally requires an authenticated scheduler identity,
// generation-checked execution handle, and the matching live native ticket.
namespace Oreslang.StateRegions;

@doc("Exact region + logical execution provenance for a scoped state loan.")
model StateRegionLoanProvenance {
  contractVersion: "1.0";
  @minValue(1)
  regionId: uint64;
  @minValue(1)
  regionGeneration: uint64;
  @minValue(1)
  runtimeDomain: uint64;
  @minValue(1)
  executionId: uint64;
  @minValue(1)
  executionSlot: uint32;
  @minValue(1)
  executionGeneration: uint32;
  @minValue(1)
  loanId: uint64;
  @minLength(1)
  place: string;
  kind: "read" | "write";
  action: "borrow" | "release";
}
