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
          claimed, effectCount, lostAcknowledgment, normalSealed, rejected

vars == <<childDone, parentLive, recoveredParent, recorded, status,
          claimed, effectCount, lostAcknowledgment, normalSealed, rejected>>

Init ==
  /\ childDone = FALSE
  /\ parentLive = TRUE
  /\ recoveredParent = FALSE
  /\ recorded = FALSE
  /\ status = "None"
  /\ claimed = FALSE
  /\ effectCount = 0
  /\ lostAcknowledgment = FALSE
  /\ normalSealed = FALSE
  /\ rejected = 0

StopChild ==
  /\ ~childDone
  /\ childDone' = TRUE
  /\ UNCHANGED <<parentLive, recoveredParent, recorded, status, claimed,
                 effectCount, lostAcknowledgment, normalSealed, rejected>>

StopParent ==
  /\ parentLive
  /\ parentLive' = FALSE
  /\ UNCHANGED <<childDone, recoveredParent, recorded, status, claimed,
                 effectCount, lostAcknowledgment, normalSealed, rejected>>

RecordFailure ==
  /\ childDone
  /\ ~normalSealed
  /\ ~recorded
  /\ recorded' = TRUE
  /\ status' = "Recorded"
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, claimed,
                 effectCount, lostAcknowledgment, normalSealed, rejected>>

NormalExit ==
  /\ childDone
  /\ ~recorded
  /\ ~normalSealed
  /\ normalSealed' = TRUE
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, effectCount, lostAcknowledgment, rejected>>

RecoverParent ==
  /\ ~parentLive
  /\ ~recoveredParent
  /\ recoveredParent' = TRUE
  /\ UNCHANGED <<childDone, parentLive, recorded, status, claimed,
                 effectCount, lostAcknowledgment, normalSealed, rejected>>

ClaimOneUse ==
  /\ childDone
  /\ status = "Recorded"
  /\ (parentLive \/ recoveredParent)
  /\ ~claimed
  /\ claimed' = TRUE
  /\ status' = "Claimed"
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded,
                 effectCount, lostAcknowledgment, normalSealed, rejected>>

AdmitHostEffect ==
  /\ status = "Claimed"
  /\ effectCount = 0
  /\ ~lostAcknowledgment
  /\ effectCount' = 1
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, lostAcknowledgment, normalSealed, rejected>>

LoseAcknowledgment ==
  /\ status = "Claimed"
  /\ effectCount = 1
  /\ ~lostAcknowledgment
  /\ lostAcknowledgment' = TRUE
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, effectCount, normalSealed, rejected>>

Acknowledge ==
  /\ status = "Claimed"
  /\ effectCount = 1
  /\ ~lostAcknowledgment
  /\ status' = "Acknowledged"
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, claimed,
                 effectCount, lostAcknowledgment, normalSealed, rejected>>

RejectReplay ==
  /\ status \in {"Claimed", "Acknowledged"}
  /\ rejected < 2
  /\ rejected' = rejected + 1
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, effectCount, lostAcknowledgment, normalSealed>>

Next == StopChild \/ StopParent \/ RecordFailure \/ NormalExit
     \/ RecoverParent \/ ClaimOneUse \/ AdmitHostEffect
     \/ LoseAcknowledgment \/ Acknowledge \/ RejectReplay

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

UnsafeDropOnParentStop ==
  /\ parentLive
  /\ recorded
  /\ status = "Recorded"
  /\ parentLive' = FALSE
  /\ status' = "None"
  /\ UNCHANGED <<childDone, recoveredParent, recorded, claimed,
                 effectCount, lostAcknowledgment, normalSealed, rejected>>

UnsafeReplayHostEffect ==
  /\ status = "Claimed"
  /\ effectCount = 1
  /\ effectCount' = 2
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, lostAcknowledgment, normalSealed, rejected>>

UnsafeAckWithoutEffect ==
  /\ status = "Claimed"
  /\ effectCount = 0
  /\ status' = "Acknowledged"
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, claimed,
                 effectCount, lostAcknowledgment, normalSealed, rejected>>

UnsafeNormalAfterFailure ==
  /\ recorded
  /\ ~normalSealed
  /\ normalSealed' = TRUE
  /\ UNCHANGED <<childDone, parentLive, recoveredParent, recorded, status,
                 claimed, effectCount, lostAcknowledgment, rejected>>

DropSpec == Init /\ [][Next \/ UnsafeDropOnParentStop]_vars
ReplaySpec == Init /\ [][Next \/ UnsafeReplayHostEffect]_vars
AckSpec == Init /\ [][Next \/ UnsafeAckWithoutEffect]_vars
RelabelSpec == Init /\ [][Next \/ UnsafeNormalAfterFailure]_vars
=============================================================================
