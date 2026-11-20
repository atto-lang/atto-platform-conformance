namespace Oreslang.StateRegions;

@doc("Compile-time symbolic requirement; never contains fabricated runtime IDs.")
model StateRegionLoanRequirement {
  contractVersion: "1.0";
  @minLength(1)
  regionBinding: string;
  executionBinding: "current-logical-execution";
  generationFence: true;
  @minValue(1)
  loanId: uint64;
  @minLength(1)
  place: string;
  kind: "read" | "write";
  action: "borrow" | "release";
}
