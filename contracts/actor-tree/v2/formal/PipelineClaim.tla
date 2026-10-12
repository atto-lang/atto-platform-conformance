------------------------------ MODULE PipelineClaim ---------------------------
EXTENDS Naturals, TLC
(*
  Host-owned durable replay-claim abstraction for one pipelineId/runtime scope.
  CLAIMED after an unknown effect result must be quarantined, not replayed.
  This is bounded state-safety, not proof of journal fsync or guest runtime.
*)
CONSTANTS UnsafeReplayCommitted, UnsafeRetryUnknown
ASSUME UnsafeReplayCommitted \in BOOLEAN /\ UnsafeRetryUnknown \in BOOLEAN
VARIABLES receiptState, externalEffects, replayRejected
vars == <<receiptState, externalEffects, replayRejected>>
Init ==
  /\ receiptState = "FRESH"
  /\ externalEffects = 0
  /\ replayRejected = FALSE
Claim ==
  /\ receiptState = "FRESH"
  /\ receiptState' = "CLAIMED"
  /\ UNCHANGED <<externalEffects, replayRejected>>
CommitEffect ==
  /\ receiptState = "CLAIMED" /\ externalEffects = 0
  /\ receiptState' = "COMMITTED"
  /\ externalEffects' = 1
  /\ UNCHANGED replayRejected
CrashBeforeEffect ==
  /\ receiptState = "CLAIMED"
  /\ receiptState' = "QUARANTINED"
  /\ UNCHANGED <<externalEffects, replayRejected>>
CrashAfterEffectBeforeReceipt ==
  /\ receiptState = "CLAIMED" /\ externalEffects = 0
  /\ receiptState' = "QUARANTINED"
  /\ externalEffects' = 1
  /\ UNCHANGED replayRejected
RejectReplay ==
  /\ receiptState # "FRESH" /\ ~replayRejected
  /\ replayRejected' = TRUE
  /\ UNCHANGED <<receiptState, externalEffects>>
UnsafeReplayAfterCommit ==
  /\ UnsafeReplayCommitted
  /\ receiptState = "COMMITTED" /\ externalEffects = 1
  /\ externalEffects' = 2
  /\ UNCHANGED <<receiptState, replayRejected>>
UnsafeRetryUnknownEffect ==
  /\ UnsafeRetryUnknown
  /\ receiptState = "QUARANTINED" /\ externalEffects = 1
  /\ externalEffects' = 2
  /\ UNCHANGED <<receiptState, replayRejected>>
Next ==
    \/ Claim \/ CommitEffect \/ CrashBeforeEffect
    \/ CrashAfterEffectBeforeReceipt \/ RejectReplay
    \/ UnsafeReplayAfterCommit \/ UnsafeRetryUnknownEffect
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ receiptState \in {"FRESH", "CLAIMED", "COMMITTED", "QUARANTINED"}
  /\ externalEffects \in 0..2
  /\ replayRejected \in BOOLEAN
NoDoubleExternalEffect == externalEffects <= 1
NoUnclaimedEffect == externalEffects > 0 => receiptState # "FRESH"
=============================================================================
