---------------------------- MODULE NativeReleaseWake ----------------------------
EXTENDS Naturals, TLC

(*
  Native arena retirement / last loan release / asynchronous completion wakeup.
  Captures actor-side finalization check and release-side notification only.
  This is a bounded safety abstraction, not Java refinement or fairness proof.
*)
CONSTANT UnsafeDropCallback
ASSUME UnsafeDropCallback \in BOOLEAN

VARIABLES retireStarted, retireComplete, loan, checked,
          callbackPending, done
vars == <<retireStarted, retireComplete, loan, checked,
          callbackPending, done>>

Init ==
  /\ retireStarted = FALSE
  /\ retireComplete = FALSE
  /\ loan = 1
  /\ checked = FALSE
  /\ callbackPending = FALSE
  /\ done = FALSE

BeginRetire ==
  /\ ~retireStarted
  /\ retireStarted' = TRUE
  /\ UNCHANGED <<retireComplete, loan, checked, callbackPending, done>>

FinishRetire ==
  /\ retireStarted
  /\ ~retireComplete
  /\ retireComplete' = TRUE
  /\ UNCHANGED <<retireStarted, loan, checked, callbackPending, done>>

ObserveRetirement ==
  /\ retireComplete
  /\ ~checked
  /\ checked' = TRUE
  /\ done' = (loan = 0)
  /\ UNCHANGED <<retireStarted, retireComplete, loan, callbackPending>>

ReleaseLoan ==
  /\ loan = 1
  /\ loan' = 0
  /\ callbackPending' = retireComplete
  /\ UNCHANGED <<retireStarted, retireComplete, checked, done>>

DeliverWakeup ==
  /\ callbackPending
  /\ retireComplete
  /\ loan = 0
  /\ callbackPending' = FALSE
  /\ done' = TRUE
  /\ UNCHANGED <<retireStarted, retireComplete, loan, checked>>

(* Broken release callback: forget to notify after actor observed pins > 0. *)
UnsafeForgetWakeup ==
  /\ UnsafeDropCallback
  /\ retireComplete
  /\ checked
  /\ ~done
  /\ loan = 1
  /\ loan' = 0
  /\ callbackPending' = FALSE
  /\ UNCHANGED <<retireStarted, retireComplete, checked, done>>

Next == \/ BeginRetire
        \/ FinishRetire
        \/ ObserveRetirement
        \/ ReleaseLoan
        \/ DeliverWakeup
        \/ UnsafeForgetWakeup
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ retireStarted \in BOOLEAN
  /\ retireComplete \in BOOLEAN
  /\ loan \in {0,1}
  /\ checked \in BOOLEAN
  /\ callbackPending \in BOOLEAN
  /\ done \in BOOLEAN

NoPrematureDone == done => (retireComplete /\ loan = 0)
NoLostWakeup ==
  (retireComplete /\ checked /\ loan = 0 /\ ~done)
    => callbackPending

=============================================================================
