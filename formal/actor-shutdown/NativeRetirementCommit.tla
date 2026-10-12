------------------------ MODULE NativeRetirementCommit ------------------------
EXTENDS Naturals, TLC

(*
  Two-phase physical native retirement safety abstraction.
  A quota refund is NOT sufficient evidence that a registered native region's
  post-refund cleanup callback has returned. A completed actor may no longer
  retain any actor-owned region. One actor / one region / one loan are bounded.
  Java/LLVM refinement and liveness are not asserted here.
*)
CONSTANT UnsafeQuotaOnlyFinalize
ASSUME UnsafeQuotaOnlyFinalize \in BOOLEAN

VARIABLES stopped, activeTurn, loanCount, arenaClosed,
          quotaRefunded, regionRegistered, physicalDone

vars == <<stopped, activeTurn, loanCount, arenaClosed,
          quotaRefunded, regionRegistered, physicalDone>>

Init ==
  /\ stopped = FALSE
  /\ activeTurn = TRUE
  /\ loanCount = 1
  /\ arenaClosed = FALSE
  /\ quotaRefunded = FALSE
  /\ regionRegistered = TRUE
  /\ physicalDone = FALSE

RequestStop ==
  /\ ~stopped
  /\ stopped' = TRUE
  /\ UNCHANGED <<activeTurn, loanCount, arenaClosed,
                  quotaRefunded, regionRegistered, physicalDone>>

ExitTurn ==
  /\ stopped
  /\ activeTurn
  /\ activeTurn' = FALSE
  /\ UNCHANGED <<stopped, loanCount, arenaClosed,
                  quotaRefunded, regionRegistered, physicalDone>>

ReleaseLoan ==
  /\ loanCount = 1
  /\ loanCount' = 0
  /\ UNCHANGED <<stopped, activeTurn, arenaClosed,
                  quotaRefunded, regionRegistered, physicalDone>>

CloseArena ==
  /\ stopped
  /\ ~activeTurn
  /\ loanCount = 0
  /\ ~arenaClosed
  /\ arenaClosed' = TRUE
  /\ UNCHANGED <<stopped, activeTurn, loanCount,
                  quotaRefunded, regionRegistered, physicalDone>>

RefundQuota ==
  /\ arenaClosed
  /\ ~quotaRefunded
  /\ quotaRefunded' = TRUE
  /\ UNCHANGED <<stopped, activeTurn, loanCount,
                  arenaClosed, regionRegistered, physicalDone>>

UnregisterRegion ==
  /\ quotaRefunded
  /\ regionRegistered
  /\ regionRegistered' = FALSE
  /\ UNCHANGED <<stopped, activeTurn, loanCount,
                  arenaClosed, quotaRefunded, physicalDone>>

Finalize ==
  /\ stopped
  /\ ~activeTurn
  /\ loanCount = 0
  /\ arenaClosed
  /\ quotaRefunded
  /\ ~regionRegistered
  /\ ~physicalDone
  /\ physicalDone' = TRUE
  /\ UNCHANGED <<stopped, activeTurn, loanCount,
                  arenaClosed, quotaRefunded, regionRegistered>>

UnsafePublishAfterRefund ==
  /\ UnsafeQuotaOnlyFinalize
  /\ stopped
  /\ ~activeTurn
  /\ loanCount = 0
  /\ arenaClosed
  /\ quotaRefunded
  /\ regionRegistered
  /\ ~physicalDone
  /\ physicalDone' = TRUE
  /\ UNCHANGED <<stopped, activeTurn, loanCount,
                  arenaClosed, quotaRefunded, regionRegistered>>

Next == \/ RequestStop
        \/ ExitTurn
        \/ ReleaseLoan
        \/ CloseArena
        \/ RefundQuota
        \/ UnregisterRegion
        \/ Finalize
        \/ UnsafePublishAfterRefund

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ stopped \in BOOLEAN
  /\ activeTurn \in BOOLEAN
  /\ loanCount \in 0..1
  /\ arenaClosed \in BOOLEAN
  /\ quotaRefunded \in BOOLEAN
  /\ regionRegistered \in BOOLEAN
  /\ physicalDone \in BOOLEAN

NoRegisteredRegionAtDone == physicalDone => ~regionRegistered
NoNativeLoanAtDone == physicalDone => loanCount = 0
NoActiveTurnAtDone == physicalDone => ~activeTurn
NoUnrefundedArenaAtDone == physicalDone => (arenaClosed /\ quotaRefunded)

=============================================================================
