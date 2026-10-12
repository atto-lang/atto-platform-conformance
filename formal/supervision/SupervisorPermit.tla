---------------------------- MODULE SupervisorPermit ----------------------------
EXTENDS Naturals, TLC

(*
  Finite model of a single logical child's restart capability across
  repeated abort/re-reserve in the SAME supervisor CONTROL turn.
  A permit is a one-shot authority, not merely <<child,generation,turn>>.
  Physical admission and cleanup are trusted-host assertions.
*)
CONSTANTS MaxPermits, MaxGeneration
ASSUME /\ MaxPermits \in Nat \ {0}
       /\ MaxGeneration \in Nat \ {0}

VARIABLES phase, generation, issued, activePermit, committedPermit,
          replacement, readyGeneration, closed

vars == <<phase, generation, issued, activePermit, committedPermit,
          replacement, readyGeneration, closed>>

Init ==
  /\ phase = "Finalized"
  /\ generation = 1
  /\ issued = 0
  /\ activePermit = 0
  /\ committedPermit = 0
  /\ replacement = "None"
  /\ readyGeneration = 0
  /\ closed = FALSE

Reserve ==
  /\ phase = "Finalized"
  /\ ~closed
  /\ issued < MaxPermits
  /\ generation < MaxGeneration
  /\ phase' = "Reserved"
  /\ issued' = issued + 1
  /\ activePermit' = issued + 1
  /\ readyGeneration' = 0
  /\ UNCHANGED <<generation, committedPermit, replacement, closed>>

Spawn(p) ==
  /\ phase = "Reserved"
  /\ ~closed
  /\ p = activePermit
  /\ p > 0
  /\ replacement = "None"
  /\ replacement' = "Spawned"
  /\ UNCHANGED <<phase, generation, issued, activePermit, committedPermit,
                 readyGeneration, closed>>

Admit(p) ==
  /\ phase = "Reserved"
  /\ ~closed
  /\ p = activePermit
  /\ p > 0
  /\ replacement = "Spawned"
  /\ replacement' = "Admitted"
  /\ readyGeneration' = generation + 1
  /\ UNCHANGED <<phase, generation, issued, activePermit, committedPermit, closed>>

Cleanup(p) ==
  /\ phase = "Reserved"
  /\ p = activePermit
  /\ p > 0
  /\ replacement \in {"Spawned", "Admitted"}
  /\ replacement' = "Cleaned"
  /\ UNCHANGED <<phase, generation, issued, activePermit, committedPermit,
                 readyGeneration, closed>>

Abort(p) ==
  /\ phase = "Reserved"
  /\ p = activePermit
  /\ p > 0
  /\ replacement \in {"None", "Cleaned"}
  /\ phase' = "Finalized"
  /\ activePermit' = 0
  /\ replacement' = "None"
  /\ readyGeneration' = 0
  /\ UNCHANGED <<generation, issued, committedPermit, closed>>

Commit(p) ==
  /\ phase = "Reserved"
  /\ ~closed
  /\ p = activePermit
  /\ p > 0
  /\ replacement = "Admitted"
  /\ readyGeneration = generation + 1
  /\ generation < MaxGeneration
  /\ phase' = "Active"
  /\ generation' = generation + 1
  /\ committedPermit' = p
  /\ activePermit' = 0
  /\ replacement' = "None"
  /\ UNCHANGED <<issued, readyGeneration, closed>>

FinalizeNew ==
  /\ phase = "Active"
  /\ phase' = "Finalized"
  /\ UNCHANGED <<generation, issued, activePermit, committedPermit,
                 replacement, readyGeneration, closed>>

Close ==
  /\ ~closed
  /\ closed' = TRUE
  /\ UNCHANGED <<phase, generation, issued, activePermit, committedPermit,
                 replacement, readyGeneration>>

Next ==
  \/ Reserve
  \/ FinalizeNew
  \/ Close
  \/ \E p \in 1..MaxPermits :
        Spawn(p) \/ Admit(p) \/ Cleanup(p) \/ Abort(p) \/ Commit(p)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ phase \in {"Finalized", "Reserved", "Active"}
  /\ generation \in 1..MaxGeneration
  /\ issued \in 0..MaxPermits
  /\ activePermit \in 0..MaxPermits
  /\ committedPermit \in 0..MaxPermits
  /\ replacement \in {"None", "Spawned", "Admitted", "Cleaned"}
  /\ readyGeneration \in 0..MaxGeneration
  /\ closed \in BOOLEAN

PermitCoherence ==
  /\ (phase = "Reserved" => activePermit = issued /\ activePermit > 0)
  /\ (phase # "Reserved" => activePermit = 0)

NoOrphanReplacement ==
  replacement # "None" => phase = "Reserved"

NoUnreadyCommit ==
  phase = "Active" => readyGeneration = generation

NoStalePermitCommit ==
  phase = "Active" => committedPermit = issued /\ committedPermit > 0

(*
  Deliberate bug: a stale permit from a prior aborted reservation is
  incorrectly accepted after a newer permit has completed admission.
  Physical readiness still passes; only one-shot permit identity catches it.
*)
UnsafeCommitOldPermit(p) ==
  /\ phase = "Reserved"
  /\ ~closed
  /\ p > 0
  /\ p < activePermit
  /\ replacement = "Admitted"
  /\ readyGeneration = generation + 1
  /\ generation < MaxGeneration
  /\ phase' = "Active"
  /\ generation' = generation + 1
  /\ committedPermit' = p
  /\ activePermit' = 0
  /\ replacement' = "None"
  /\ UNCHANGED <<issued, readyGeneration, closed>>

MutantNext ==
  Next \/ \E p \in 1..MaxPermits : UnsafeCommitOldPermit(p)

MutantSpec == Init /\ [][MutantNext]_vars

=============================================================================
