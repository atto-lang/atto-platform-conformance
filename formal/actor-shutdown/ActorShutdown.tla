------------------------------ MODULE ActorShutdown ------------------------------
EXTENDS Naturals, TLC

(*
  Abstract actor shutdown with one actor, two host closers, one suspended
  lexical cleanup obligation, one outstanding native loan and a stale Future.
  This is a bounded SAFETY model, not a Java refinement proof or an assumption
  that stuck cleanup can complete. The immutable actor identity is implicit.
*)
CONSTANTS MaxClose, UnsafeEarlyFinalize
ASSUME /\ MaxClose \in Nat \ {0}
       /\ UnsafeEarlyFinalize \in BOOLEAN

VARIABLES phase, carrier, cleanupPending, cleanupRuns, loan,
          closeCalls, staleCallbacks, drainFailed, shutdownResult,
          doneResult, rejectedData, physicalDone

vars == <<phase, carrier, cleanupPending, cleanupRuns, loan,
          closeCalls, staleCallbacks, drainFailed, shutdownResult,
          doneResult, rejectedData, physicalDone>>

Phases == {"Running", "StopRequested", "CleanupRunning",
           "CleanupWaiting", "Stopped", "FailedDrain", "Terminated"}
Outcomes == {"Pending", "Succeeded", "Failed"}

Init ==
  /\ phase = "Running"
  /\ carrier = 1
  /\ cleanupPending = 1
  /\ cleanupRuns = 0
  /\ loan = 1
  /\ closeCalls = 0
  /\ staleCallbacks = 0
  /\ drainFailed = FALSE
  /\ shutdownResult = "Pending"
  /\ doneResult = "Pending"
  /\ rejectedData = 0
  /\ physicalDone = FALSE

RequestStop ==
  /\ phase = "Running"
  /\ phase' = "StopRequested"
  /\ UNCHANGED <<carrier, cleanupPending, cleanupRuns, loan,
                  closeCalls, staleCallbacks, drainFailed, shutdownResult,
                  doneResult, rejectedData, physicalDone>>

HostClose ==
  /\ closeCalls < MaxClose
  /\ closeCalls' = closeCalls + 1
  /\ UNCHANGED <<phase, carrier, cleanupPending, cleanupRuns, loan,
                  staleCallbacks, drainFailed, shutdownResult,
                  doneResult, rejectedData, physicalDone>>

ExitOriginalTurn ==
  /\ phase = "StopRequested"
  /\ carrier = 1
  /\ carrier' = 0
  /\ UNCHANGED <<phase, cleanupPending, cleanupRuns, loan,
                  closeCalls, staleCallbacks, drainFailed, shutdownResult,
                  doneResult, rejectedData, physicalDone>>

EnterCleanup ==
  /\ phase = "StopRequested"
  /\ carrier = 0
  /\ cleanupPending = 1
  /\ cleanupRuns = 0
  /\ phase' = "CleanupRunning"
  /\ carrier' = 1
  /\ cleanupRuns' = 1
  /\ UNCHANGED <<cleanupPending, loan, closeCalls, staleCallbacks,
                  drainFailed, shutdownResult, doneResult,
                  rejectedData, physicalDone>>

SuspendCleanup ==
  /\ phase = "CleanupRunning"
  /\ carrier = 1
  /\ cleanupPending = 1
  /\ phase' = "CleanupWaiting"
  /\ carrier' = 0
  /\ UNCHANGED <<cleanupPending, cleanupRuns, loan, closeCalls,
                  staleCallbacks, drainFailed, shutdownResult,
                  doneResult, rejectedData, physicalDone>>

ResumeCleanup ==
  /\ phase = "CleanupWaiting"
  /\ carrier = 0
  /\ ~drainFailed
  /\ phase' = "CleanupRunning"
  /\ carrier' = 1
  /\ UNCHANGED <<cleanupPending, cleanupRuns, loan, closeCalls,
                  staleCallbacks, drainFailed, shutdownResult,
                  doneResult, rejectedData, physicalDone>>

CompleteCleanup ==
  /\ phase = "CleanupRunning"
  /\ carrier = 1
  /\ cleanupPending = 1
  /\ cleanupPending' = 0
  /\ carrier' = 0
  /\ phase' = "Stopped"
  /\ UNCHANGED <<cleanupRuns, loan, closeCalls, staleCallbacks,
                  drainFailed, shutdownResult, doneResult,
                  rejectedData, physicalDone>>

ReleaseNativeLoan ==
  /\ phase # "Running"
  /\ carrier = 0
  /\ loan = 1
  /\ loan' = 0
  /\ UNCHANGED <<phase, carrier, cleanupPending, cleanupRuns,
                  closeCalls, staleCallbacks, drainFailed, shutdownResult,
                  doneResult, rejectedData, physicalDone>>

CleanupDeadline ==
  /\ phase \in {"StopRequested", "CleanupWaiting"}
  /\ cleanupPending = 1
  /\ phase' = "FailedDrain"
  /\ drainFailed' = TRUE
  /\ shutdownResult' = "Failed"
  (* A failed shutdown observer is NOT a physical-done ticket. *)
  /\ UNCHANGED <<carrier, cleanupPending, cleanupRuns, loan,
                  closeCalls, staleCallbacks, doneResult,
                  rejectedData, physicalDone>>

LateFutureCompletion ==
  /\ phase # "Running"
  /\ staleCallbacks = 0
  /\ staleCallbacks' = 1
  (* The generation fence discards the callback without replaying cleanup. *)
  /\ UNCHANGED <<phase, carrier, cleanupPending, cleanupRuns, loan,
                  closeCalls, drainFailed, shutdownResult, doneResult,
                  rejectedData, physicalDone>>

RejectPostStopData ==
  /\ phase # "Running"
  /\ rejectedData < 2
  /\ rejectedData' = rejectedData + 1
  /\ UNCHANGED <<phase, carrier, cleanupPending, cleanupRuns, loan,
                  closeCalls, staleCallbacks, drainFailed, shutdownResult,
                  doneResult, physicalDone>>

Finalize(outcome) ==
  /\ outcome \in {"Succeeded", "Failed"}
  /\ phase = "Stopped"
  /\ carrier = 0
  /\ cleanupPending = 0
  /\ loan = 0
  /\ ~drainFailed
  /\ ~physicalDone
  /\ physicalDone' = TRUE
  /\ doneResult' = outcome
  /\ shutdownResult' = outcome
  /\ phase' = "Terminated"
  /\ UNCHANGED <<carrier, cleanupPending, cleanupRuns, loan,
                  closeCalls, staleCallbacks, drainFailed, rejectedData>>

(* Deliberately unsafe transition for a negative-model counterexample. *)
UnsafeFinalize ==
  /\ UnsafeEarlyFinalize
  /\ phase = "StopRequested"
  /\ cleanupPending = 1
  /\ physicalDone' = TRUE
  /\ doneResult' = "Succeeded"
  /\ phase' = "Terminated"
  /\ UNCHANGED <<carrier, cleanupPending, cleanupRuns, loan,
                  closeCalls, staleCallbacks, drainFailed, shutdownResult,
                  rejectedData>>

Next == \/ RequestStop
        \/ HostClose
        \/ ExitOriginalTurn
        \/ EnterCleanup
        \/ SuspendCleanup
        \/ ResumeCleanup
        \/ CompleteCleanup
        \/ ReleaseNativeLoan
        \/ CleanupDeadline
        \/ LateFutureCompletion
        \/ RejectPostStopData
        \/ (\E outcome \in {"Succeeded", "Failed"}: Finalize(outcome))
        \/ UnsafeFinalize

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ phase \in Phases
  /\ carrier \in {0,1}
  /\ cleanupPending \in {0,1}
  /\ cleanupRuns \in 0..1
  /\ loan \in {0,1}
  /\ closeCalls \in 0..MaxClose
  /\ staleCallbacks \in {0,1}
  /\ drainFailed \in BOOLEAN
  /\ shutdownResult \in Outcomes
  /\ doneResult \in Outcomes
  /\ rejectedData \in 0..2
  /\ physicalDone \in BOOLEAN

NoPrematurePhysicalDone ==
  physicalDone => (carrier = 0 /\ cleanupPending = 0 /\ loan = 0)

PhysicalDoneIsExactlyTerminal ==
  (doneResult # "Pending") <=> physicalDone

NoFailedDrainSuccess ==
  drainFailed => ~physicalDone

CleanupAtMostOnce == cleanupRuns <= 1
OriginalTurnGoneBeforeCleanup == (cleanupRuns > 0) => phase # "Running"
NoTerminalBeforeNativeRelease == (doneResult # "Pending") => loan = 0

=============================================================================
