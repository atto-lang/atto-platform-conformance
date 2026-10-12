# Actor-tree physical completion safety

Model: one parent, two structured children (one holds a native loan; one drains
source-owned cancellation cleanup). The safe TLC run must preserve
`NoEarlyParentDone`, `NoLoanAtNativeDone`, `NoPendingCleanupAtChildDone`,
and `NoPostStopGuestAdmission`. Two mutation configurations must produce the
specific expected invariant violations. Both child release orders are explored.
A matching Java runtime test exercises live actor STOP with these two siblings.

This is bounded safety, not a Java-to-TLA+ refinement proof, liveness proof,
or general LLVM guest-language cancellation parity.
