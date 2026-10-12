--------------------- MODULE NativeTerminalReceipt ---------------------
EXTENDS Naturals, TLC

(*
 * Bounded host-owned terminal receipt. The scheduler records a full,
 * generation-bound PANIC envelope BEFORE attempting parent CONTROL
 * admission. A stopped parent leaves the receipt RECORDED. A recovered
 * parent may claim the original receipt once. Host effect admission can
 * commit without its acknowledgment: CLAIMED then remains quarantined.
 *
 * This is an in-memory, at-most-once safety model, not process-crash
 * durability and not a machine-checked refinement of the C scheduler.
 *)
VARIABLES childDone, parentLive, recoveredParent, recorded, status,
          claimed, effectCount, lostAcknowledgment, independentProof, normalSealed, rejected

vars == <<childDone, parentLive, recoveredParent, recorded, status,
          claimed, effectCount, lostAcknowledgment, independentProof, normalSealed, rejected>>

Init ==
  /\ childDone = FALSE
  /\ parentLive = TRUE
  /\ recoveredParent = FALSE
  /\ recorded = FALSE
  /\ status = "None"
  /\ claimed = FALSE
  /\ effectCount = 0
  /\ lostAcknowledgment = FALSE
  /\ independentProof = FALSE
  /\ normalSealed = FALSE
  /\ rejected = 0

StopChild ==
  /\ ~childDone
  /\ childDone' = TRUE
  /\ UNCHANGED <<parentLive, recoveredParent, recorded, status, claimed,
                 effectCount, lostAcknowledgment, independentProof, normalSealed, rejected>>

StopParent ==
  /\ parentLive
  /\ parentLive' = FALSE
  /\ UNCHANGED <<childDone, recoveredParent, recorded, status, claimed,
                 effectCount, lostAcknowledgment, independentProof, normalSealed, rejected>>

RecordFailure ==
  /\ childDone
  /\ ~normalSealed
  /\ ~recorded
  /\ recorded' = TRUE
  /\ status' = "Recorded"
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, claimed,
                 effectCount, lostAcknowledgment, independentProof, normalSealed, rejected>>

NormalExit ==
  /\ childDone
  /\ ~recorded
  /\ ~normalSealed
  /\ normalSealed' = TRUE
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, effectCount, lostAcknowledgment, independentProof, rejected>>

RecoverParent ==
  /\ ~parentLive
  /\ ~recoveredParent
  /\ recoveredParent' = TRUE
  /\ UNCHANGED <<childDone, parentLive, recorded, status, claimed,
                 effectCount, lostAcknowledgment, independentProof, normalSealed, rejected>>

ClaimOneUse ==
  /\ childDone
  /\ status = "Recorded"
  /\ (parentLive \/ recoveredParent)
  /\ ~claimed
  /\ claimed' = TRUE
  /\ status' = "Claimed"
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded,
                 effectCount, lostAcknowledgment, independentProof, normalSealed, rejected>>

AdmitHostEffect ==
  /\ status = "Claimed"
  /\ effectCount = 0
  /\ ~lostAcknowledgment
  /\ effectCount' = 1
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, lostAcknowledgment, independentProof, normalSealed, rejected>>

LoseAcknowledgment ==
  /\ status = "Claimed"
  /\ effectCount = 1
  /\ ~lostAcknowledgment
  /\ lostAcknowledgment' = TRUE
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, effectCount, independentProof, normalSealed, rejected>>

Acknowledge ==
  /\ status = "Claimed"
  /\ effectCount = 1
  /\ ~lostAcknowledgment
  /\ status' = "Acknowledged"
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, claimed,
                 effectCount, lostAcknowledgment, independentProof, normalSealed, rejected>>

/* A lost acknowledgment may be reconciled only after a separate host
 * receipt proves the exact effect actually committed. Neither action
 * retries guest policy or reenters external STOP/CONTROL host work. */
VerifyIndependentCommit ==
  /\ status = "Claimed"
  /\ effectCount = 1
  /\ lostAcknowledgment
  /\ ~independentProof
  /\ independentProof' = TRUE
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, effectCount, lostAcknowledgment, normalSealed, rejected>>

ReconcileProvenAcknowledgment ==
  /\ status = "Claimed"
  /\ effectCount = 1
  /\ lostAcknowledgment
  /\ independentProof
  /\ status' = "Acknowledged"
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded,
                 claimed, effectCount, lostAcknowledgment, independentProof,
                 normalSealed, rejected>>

RejectReplay ==
  /\ status \in {"Claimed", "Acknowledged"}
  /\ rejected < 2
  /\ rejected' = rejected + 1
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, effectCount, lostAcknowledgment, independentProof, normalSealed>>

Next == StopChild \/ StopParent \/ RecordFailure \/ NormalExit
     \/ RecoverParent \/ ClaimOneUse \/ AdmitHostEffect
     \/ LoseAcknowledgment \/ Acknowledge \/ RejectReplay
     \/ VerifyIndependentCommit \/ ReconcileProvenAcknowledgment

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ childDone \in BOOLEAN
  /\ parentLive \in BOOLEAN
  /\ recoveredParent \in BOOLEAN
  /\ recorded \in BOOLEAN
  /\ status \in {"None", "Recorded", "Claimed", "Acknowledged"}
  /\ claimed \in BOOLEAN
  /\ effectCount \in 0..2
  /\ lostAcknowledgment \in BOOLEAN
  /\ independentProof \in BOOLEAN
  /\ normalSealed \in BOOLEAN
  /\ rejected \in 0..2

TerminalNeverLost == recorded => status # "None"
AtMostOneHostEffect == effectCount <= 1
AcknowledgmentNeedsEffect ==
  status = "Acknowledged" => effectCount = 1
ClaimIsOneUse == (status \in {"Claimed", "Acknowledged"}) => claimed
NoEffectWithoutClaim == effectCount > 0 => claimed
NeverRelabelPANICNormal == recorded => ~normalSealed
NoUnclaimedEffect == ~claimed => effectCount = 0
NoUnprovedLostAcknowledgment ==
  (status = "Acknowledged" /\ lostAcknowledgment) => independentProof

UnsafeDropOnParentStop ==
  /\ parentLive
  /\ recorded
  /\ status = "Recorded"
  /\ parentLive' = FALSE
  /\ status' = "None"
  /\ UNCHANGED <<childDone, recoveredParent, recorded, claimed,
                 effectCount, lostAcknowledgment, independentProof, normalSealed, rejected>>

UnsafeReplayHostEffect ==
  /\ status = "Claimed"
  /\ effectCount = 1
  /\ effectCount' = 2
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, lostAcknowledgment, independentProof, normalSealed, rejected>>

UnsafeAckWithoutEffect ==
  /\ status = "Claimed"
  /\ effectCount = 0
  /\ status' = "Acknowledged"
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, claimed,
                 effectCount, lostAcknowledgment, independentProof, normalSealed, rejected>>

UnsafeNormalAfterFailure ==
  /\ recorded
  /\ ~normalSealed
  /\ normalSealed' = TRUE
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, effectCount, lostAcknowledgment, independentProof, rejected>>

UnsafeForgedAckAfterLoss ==
  /\ status = "Claimed"
  /\ effectCount = 1
  /\ lostAcknowledgment
  /\ ~independentProof
  /\ status' = "Acknowledged"
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded,
                 claimed, effectCount, lostAcknowledgment, independentProof,
                 normalSealed, rejected>>

DropSpec == Init /\ [][Next \/ UnsafeDropOnParentStop]_vars
ReplaySpec == Init /\ [][Next \/ UnsafeReplayHostEffect]_vars
AckSpec == Init /\ [][Next \/ UnsafeAckWithoutEffect]_vars
RelabelSpec == Init /\ [][Next \/ UnsafeNormalAfterFailure]_vars
ForgedAckSpec == Init /\ [][Next \/ UnsafeForgedAckAfterLoss]_vars
=============================================================================
