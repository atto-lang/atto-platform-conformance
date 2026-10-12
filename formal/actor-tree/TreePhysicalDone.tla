--------------------------- MODULE TreePhysicalDone ---------------------------
EXTENDS Naturals, TLC
(*
 Parent P owns native-loan child N and source-cleanup child C.
 Either child may finish first. A stale callback never re-admits guest work.
 Bounded safety abstraction, not Java/LLVM refinement or liveness.
*)
CONSTANTS UnsafeEarlyParent, UnsafeStaleAdmit
ASSUME UnsafeEarlyParent \in BOOLEAN /\ UnsafeStaleAdmit \in BOOLEAN
VARIABLES parentStop, nativeStop, cleanupStop, nativeLoan,
          cleanupDrained, nativeDone, cleanupDone, parentDone,
          staleSeen, guestAdmitted
vars == <<parentStop, nativeStop, cleanupStop, nativeLoan,
          cleanupDrained, nativeDone, cleanupDone, parentDone,
          staleSeen, guestAdmitted>>
Init ==
  /\ parentStop = FALSE /\ nativeStop = FALSE /\ cleanupStop = FALSE
  /\ nativeLoan = 1 /\ cleanupDrained = FALSE
  /\ nativeDone = FALSE /\ cleanupDone = FALSE /\ parentDone = FALSE
  /\ staleSeen = FALSE /\ guestAdmitted = FALSE
RequestParentStop ==
  /\ ~parentStop /\ parentStop' = TRUE
  /\ UNCHANGED <<nativeStop, cleanupStop, nativeLoan, cleanupDrained,
                  nativeDone, cleanupDone, parentDone, staleSeen, guestAdmitted>>
StopNativeChild ==
  /\ parentStop /\ ~nativeStop /\ nativeStop' = TRUE
  /\ UNCHANGED <<parentStop, cleanupStop, nativeLoan, cleanupDrained,
                  nativeDone, cleanupDone, parentDone, staleSeen, guestAdmitted>>
StopCleanupChild ==
  /\ parentStop /\ ~cleanupStop /\ cleanupStop' = TRUE
  /\ UNCHANGED <<parentStop, nativeStop, nativeLoan, cleanupDrained,
                  nativeDone, cleanupDone, parentDone, staleSeen, guestAdmitted>>
ReleaseNativeLoan ==
  /\ nativeStop /\ nativeLoan = 1 /\ nativeLoan' = 0
  /\ UNCHANGED <<parentStop, nativeStop, cleanupStop, cleanupDrained,
                  nativeDone, cleanupDone, parentDone, staleSeen, guestAdmitted>>
DrainCleanup ==
  /\ cleanupStop /\ ~cleanupDrained /\ cleanupDrained' = TRUE
  /\ UNCHANGED <<parentStop, nativeStop, cleanupStop, nativeLoan,
                  nativeDone, cleanupDone, parentDone, staleSeen, guestAdmitted>>
FinishNativeChild ==
  /\ nativeStop /\ nativeLoan = 0 /\ ~nativeDone /\ nativeDone' = TRUE
  /\ UNCHANGED <<parentStop, nativeStop, cleanupStop, nativeLoan,
                  cleanupDrained, cleanupDone, parentDone, staleSeen, guestAdmitted>>
FinishCleanupChild ==
  /\ cleanupStop /\ cleanupDrained /\ ~cleanupDone /\ cleanupDone' = TRUE
  /\ UNCHANGED <<parentStop, nativeStop, cleanupStop, nativeLoan,
                  cleanupDrained, nativeDone, parentDone, staleSeen, guestAdmitted>>
FinishParent ==
  /\ parentStop /\ nativeDone /\ cleanupDone /\ ~parentDone /\ parentDone' = TRUE
  /\ UNCHANGED <<parentStop, nativeStop, cleanupStop, nativeLoan,
                  cleanupDrained, nativeDone, cleanupDone, staleSeen, guestAdmitted>>
ObserveStaleCallback ==
  /\ parentStop /\ nativeDone /\ ~staleSeen /\ staleSeen' = TRUE
  /\ UNCHANGED <<parentStop, nativeStop, cleanupStop, nativeLoan,
                  cleanupDrained, nativeDone, cleanupDone, parentDone, guestAdmitted>>
UnsafeFinishAfterOneChild ==
  /\ UnsafeEarlyParent /\ parentStop /\ ~parentDone
  /\ (nativeDone \/ cleanupDone) /\ ~(nativeDone /\ cleanupDone)
  /\ parentDone' = TRUE
  /\ UNCHANGED <<parentStop, nativeStop, cleanupStop, nativeLoan,
                  cleanupDrained, nativeDone, cleanupDone, staleSeen, guestAdmitted>>
UnsafeAdmitStaleCallback ==
  /\ UnsafeStaleAdmit /\ parentStop /\ nativeDone
  /\ ~staleSeen /\ ~guestAdmitted
  /\ staleSeen' = TRUE /\ guestAdmitted' = TRUE
  /\ UNCHANGED <<parentStop, nativeStop, cleanupStop, nativeLoan,
                  cleanupDrained, nativeDone, cleanupDone, parentDone>>
Next ==
    \/ RequestParentStop \/ StopNativeChild \/ StopCleanupChild
    \/ ReleaseNativeLoan \/ DrainCleanup \/ FinishNativeChild
    \/ FinishCleanupChild \/ FinishParent \/ ObserveStaleCallback
    \/ UnsafeFinishAfterOneChild \/ UnsafeAdmitStaleCallback
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ parentStop \in BOOLEAN /\ nativeStop \in BOOLEAN
  /\ cleanupStop \in BOOLEAN /\ nativeLoan \in 0..1
  /\ cleanupDrained \in BOOLEAN /\ nativeDone \in BOOLEAN
  /\ cleanupDone \in BOOLEAN /\ parentDone \in BOOLEAN
  /\ staleSeen \in BOOLEAN /\ guestAdmitted \in BOOLEAN
NoEarlyParentDone == parentDone => (nativeDone /\ cleanupDone)
NoLoanAtNativeDone == nativeDone => nativeLoan = 0
NoPendingCleanupAtChildDone == cleanupDone => cleanupDrained
ChildDoneRequiresStop == (nativeDone => nativeStop) /\ (cleanupDone => cleanupStop)
NoPostStopGuestAdmission == parentStop => ~guestAdmitted
=============================================================================
