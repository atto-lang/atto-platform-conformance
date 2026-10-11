------------------------- MODULE SupervisorLifecycle -------------------------
EXTENDS Naturals, FiniteSets, TLC

(*
  Finite trusted-host model, not an implementation proof.
  Atomic actions are the intended lifecycle linearization points.
  A successful external proof is assumed truthful; Oreslang cannot itself
  determine the outcome of an arbitrary nontransactional host effect.
  The identity of a physical actor is the pair <<child, generation[child]>>.
*)
CONSTANTS Children, Supervisors, MaxGeneration, MaxTurns
ASSUME /\ Children # {}
       /\ Supervisors # {}
       /\ MaxGeneration \in Nat \ {0}
       /\ MaxTurns \in Nat \ {0}
       /\ "Nobody" \notin Children

Phases == {"Active", "Finalized", "Restarting", "Stopping", "Stopped"}
Receipts == {"None", "Pending", "Applied", "Uncertain", "Ack"}
Unresolved == {"Pending", "Uncertain"}
Nobody == "Nobody"

VARIABLES owner, phase, generation, cleaned, leaseGeneration,
          receipt, calls, applied, proof, committedGeneration,
          control, closed, nextTurn, turn, replacement, readyGeneration

vars == <<owner, phase, generation, cleaned, leaseGeneration,
          receipt, calls, applied, proof, committedGeneration,
          control, closed, nextTurn, turn, replacement, readyGeneration>>

Init ==
    /\ owner \in [Children -> Supervisors]
    /\ phase = [c \in Children |-> "Active"]
    /\ generation = [c \in Children |-> 1]
    /\ cleaned = [c \in Children |-> FALSE]
    /\ leaseGeneration = [c \in Children |-> 0]
    /\ receipt = [c \in Children |-> "None"]
    /\ calls = [c \in Children |-> 0]
    /\ applied = [c \in Children |-> FALSE]
    /\ proof = [c \in Children |-> FALSE]
    /\ committedGeneration = [c \in Children |-> 0]
    /\ control = [s \in Supervisors |-> Nobody]
    /\ closed = [s \in Supervisors |-> FALSE]
    /\ nextTurn = [s \in Supervisors |-> 0]
    /\ turn = [c \in Children |-> 0]
    /\ replacement = [c \in Children |-> "None"]
    /\ readyGeneration = [c \in Children |-> 0]

(* The actual actor carrier must finish cleanup before finalization. *)
Cleanup(c) ==
    /\ phase[c] = "Active"
    /\ ~cleaned[c]
    /\ cleaned' = [cleaned EXCEPT ![c] = TRUE]
    /\ UNCHANGED <<owner, phase, generation, leaseGeneration, receipt,
                   calls, applied, proof, committedGeneration, control,
                   closed, nextTurn, turn, replacement, readyGeneration>>

Finalize(c) ==
    /\ phase[c] = "Active"
    /\ cleaned[c]
    /\ phase' = [phase EXCEPT ![c] = "Finalized"]
    /\ UNCHANGED <<owner, generation, cleaned, leaseGeneration, receipt,
                   calls, applied, proof, committedGeneration, control,
                   closed, nextTurn, turn, replacement, readyGeneration>>

(* Exactly one logical CONTROL turn per supervisor, even if its worker
   is released by await. Separate supervisors may proceed independently. *)
AcquireControl(c) ==
    /\ phase[c] = "Finalized"
    /\ ~closed[owner[c]]
    /\ control[owner[c]] = Nobody
    /\ nextTurn[owner[c]] < MaxTurns
    /\ control' = [control EXCEPT ![owner[c]] = c]
    /\ nextTurn' = [nextTurn EXCEPT ![owner[c]] = @ + 1]
    /\ turn' = [turn EXCEPT ![c] = nextTurn[owner[c]] + 1]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   receipt, calls, applied, proof, committedGeneration, closed, replacement, readyGeneration>>

(* STOP and RESTART race to mutate the SAME Finalized phase. *)
ReserveStop(c) ==
    /\ phase[c] = "Finalized"
    /\ control[owner[c]] = c
    /\ receipt[c] = "None"
    /\ phase' = [phase EXCEPT ![c] = "Stopping"]
    /\ receipt' = [receipt EXCEPT ![c] = "Pending"]
    /\ leaseGeneration' = [leaseGeneration EXCEPT ![c] = generation[c]]
    /\ UNCHANGED <<owner, generation, cleaned, calls, applied, proof,
                   committedGeneration, control, closed, nextTurn, turn, replacement, readyGeneration>>

ReserveRestart(c) ==
    /\ phase[c] = "Finalized"
    /\ control[owner[c]] = c
    /\ receipt[c] = "None"
    /\ generation[c] < MaxGeneration
    /\ phase' = [phase EXCEPT ![c] = "Restarting"]
    /\ leaseGeneration' = [leaseGeneration EXCEPT ![c] = generation[c]]
    /\ UNCHANGED <<owner, generation, cleaned, receipt, calls, applied,
                   proof, committedGeneration, control, closed, nextTurn, turn, replacement, readyGeneration>>

(* Trusted host cleanup is required if the replacement was actually spawned.
   Shutdown does not silently erase a live replacement or its reservation. *)
SpawnReplacement(c) ==
    /\ phase[c] = "Restarting"
    /\ control[owner[c]] = c
    /\ ~closed[owner[c]]
    /\ replacement[c] = "None"
    /\ replacement' = [replacement EXCEPT ![c] = "Spawned"]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   receipt, calls, applied, proof, committedGeneration,
                   control, closed, nextTurn, turn, readyGeneration>>

AdmitReplacement(c) ==
    /\ phase[c] = "Restarting"
    /\ control[owner[c]] = c
    /\ ~closed[owner[c]]
    /\ replacement[c] = "Spawned"
    /\ replacement' = [replacement EXCEPT ![c] = "Admitted"]
    /\ readyGeneration' = [readyGeneration EXCEPT ![c] = generation[c] + 1]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   receipt, calls, applied, proof, committedGeneration,
                   control, closed, nextTurn, turn>>

(* After a failed admission or close, physical cleanup runs before abort. *)
CleanupReplacement(c) ==
    /\ phase[c] = "Restarting"
    /\ replacement[c] \in {"Spawned", "Admitted"}
    /\ replacement' = [replacement EXCEPT ![c] = "Cleaned"]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   receipt, calls, applied, proof, committedGeneration,
                   control, closed, nextTurn, turn, readyGeneration>>

AbortRestart(c) ==
    /\ phase[c] = "Restarting"
    /\ leaseGeneration[c] = generation[c]
    /\ replacement[c] \in {"None", "Cleaned"}
    /\ phase' = [phase EXCEPT ![c] = "Finalized"]
    /\ leaseGeneration' = [leaseGeneration EXCEPT ![c] = 0]
    /\ replacement' = [replacement EXCEPT ![c] = "None"]
    /\ UNCHANGED <<owner, generation, cleaned, receipt, calls, applied,
                   proof, committedGeneration, control, closed, nextTurn, turn, readyGeneration>>

(* Model assumption: a real new actor has already been admitted/readied.
   This transition represents the registry's atomic identity replacement. *)
CommitRestart(c) ==
    /\ phase[c] = "Restarting"
    /\ leaseGeneration[c] = generation[c]
    /\ generation[c] < MaxGeneration
    /\ replacement[c] = "Admitted"
    /\ readyGeneration[c] = generation[c] + 1
    /\ ~closed[owner[c]]
    /\ control[owner[c]] = c
    /\ phase' = [phase EXCEPT ![c] = "Active"]
    /\ generation' = [generation EXCEPT ![c] = @ + 1]
    /\ cleaned' = [cleaned EXCEPT ![c] = FALSE]
    /\ leaseGeneration' = [leaseGeneration EXCEPT ![c] = 0]
    /\ replacement' = [replacement EXCEPT ![c] = "None"]
    /\ calls' = [calls EXCEPT ![c] = 0]
    /\ applied' = [applied EXCEPT ![c] = FALSE]
    /\ proof' = [proof EXCEPT ![c] = FALSE]
    /\ turn' = [turn EXCEPT ![c] = 0]
    /\ control' = [control EXCEPT ![owner[c]] = Nobody]
    /\ UNCHANGED <<owner, receipt, committedGeneration, closed, nextTurn, readyGeneration>>

StartHostEffect(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Pending"
    /\ control[owner[c]] = c
    /\ ~closed[owner[c]]
    /\ calls[c] = 0
    /\ calls' = [calls EXCEPT ![c] = 1]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   receipt, applied, proof, committedGeneration, control,
                   closed, nextTurn, turn, replacement, readyGeneration>>

HostSuccess(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Pending"
    /\ calls[c] = 1
    /\ control[owner[c]] = c
    /\ ~closed[owner[c]]
    /\ receipt' = [receipt EXCEPT ![c] = "Applied"]
    /\ applied' = [applied EXCEPT ![c] = TRUE]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   calls, proof, committedGeneration, control, closed,
                   nextTurn, turn, replacement, readyGeneration>>

(* Either possible physical outcome may accompany a failed callback.
   The runtime does not infer which occurred from the thrown exception. *)
HostUnknown(c, didApply) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Pending"
    /\ calls[c] = 1
    /\ didApply \in BOOLEAN
    /\ receipt' = [receipt EXCEPT ![c] = "Uncertain"]
    /\ applied' = [applied EXCEPT ![c] = didApply]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   calls, proof, committedGeneration, control, closed,
                   nextTurn, turn, replacement, readyGeneration>>

CommitAcknowledgedStop(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Applied"
    /\ applied[c]
    /\ control[owner[c]] = c
    /\ ~closed[owner[c]]
    /\ phase' = [phase EXCEPT ![c] = "Stopped"]
    /\ receipt' = [receipt EXCEPT ![c] = "Ack"]
    /\ committedGeneration' = [committedGeneration EXCEPT ![c] = generation[c]]
    /\ control' = [control EXCEPT ![owner[c]] = Nobody]
    /\ UNCHANGED <<owner, generation, cleaned, leaseGeneration, calls,
                   applied, proof, closed, nextTurn, turn, replacement, readyGeneration>>

(* Independent read-only proof, never a second invocation of STOP.
   Its truthfulness is an explicit environmental assumption. *)
VerifyHostEffect(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] \in Unresolved
    /\ applied[c]
    /\ calls[c] = 1
    /\ ~proof[c]
    /\ proof' = [proof EXCEPT ![c] = TRUE]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   receipt, calls, applied, committedGeneration, control,
                   closed, nextTurn, turn, replacement, readyGeneration>>

Reconcile(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] \in Unresolved
    /\ proof[c]
    /\ applied[c]
    /\ leaseGeneration[c] = generation[c]
    /\ phase' = [phase EXCEPT ![c] = "Stopped"]
    /\ receipt' = [receipt EXCEPT ![c] = "Ack"]
    /\ committedGeneration' = [committedGeneration EXCEPT ![c] = generation[c]]
    /\ control' = IF control[owner[c]] = c
                  THEN [control EXCEPT ![owner[c]] = Nobody]
                  ELSE control
    /\ UNCHANGED <<owner, generation, cleaned, leaseGeneration, calls,
                   applied, proof, closed, nextTurn, turn, replacement, readyGeneration>>

(* Close never rolls back STOPPING, even if no host receipt has arrived. *)
CloseSupervisor(s) ==
    /\ ~closed[s]
    /\ closed' = [closed EXCEPT ![s] = TRUE]
    /\ control' = [control EXCEPT ![s] = Nobody]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   receipt, calls, applied, proof, committedGeneration,
                   nextTurn, turn, replacement, readyGeneration>>

Next ==
    \/ \E c \in Children :
         Cleanup(c) \/ Finalize(c) \/ AcquireControl(c)
         \/ ReserveStop(c) \/ ReserveRestart(c)
         \/ SpawnReplacement(c) \/ AdmitReplacement(c)
         \/ CleanupReplacement(c) \/ AbortRestart(c)
         \/ CommitRestart(c)
         \/ StartHostEffect(c) \/ HostSuccess(c)
         \/ HostUnknown(c, TRUE) \/ HostUnknown(c, FALSE)
         \/ CommitAcknowledgedStop(c) \/ VerifyHostEffect(c)
         \/ Reconcile(c)
    \/ \E s \in Supervisors : CloseSupervisor(s)

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ owner \in [Children -> Supervisors]
    /\ phase \in [Children -> Phases]
    /\ generation \in [Children -> 1..MaxGeneration]
    /\ cleaned \in [Children -> BOOLEAN]
    /\ leaseGeneration \in [Children -> 0..MaxGeneration]
    /\ receipt \in [Children -> Receipts]
    /\ calls \in [Children -> 0..1]
    /\ applied \in [Children -> BOOLEAN]
    /\ proof \in [Children -> BOOLEAN]
    /\ committedGeneration \in [Children -> 0..MaxGeneration]
    /\ control \in [Supervisors -> (Children \cup {Nobody})]
    /\ closed \in [Supervisors -> BOOLEAN]
    /\ nextTurn \in [Supervisors -> 0..MaxTurns]
    /\ turn \in [Children -> 0..MaxTurns]
    /\ replacement \in [Children -> {"None", "Spawned", "Admitted", "Cleaned"}]
    /\ readyGeneration \in [Children -> 0..MaxGeneration]

SerialControl ==
    \A s \in Supervisors :
        control[s] = Nobody
        \/ (control[s] \in Children /\ owner[control[s]] = s /\ ~closed[s])

NoStopRestartOverlap ==
    \A c \in Children :
        (receipt[c] \in (Unresolved \cup {"Applied", "Ack"})
         => phase[c] \notin {"Active", "Finalized", "Restarting"})

(* Close may leave a RESTART reservation quarantined; it must never
   publish a new incarnation after CONTROL has been closed. *)
RestartOwnedWhileOpen ==
    \A c \in Children :
        (phase[c] = "Restarting" /\ ~closed[owner[c]])
        => control[owner[c]] = c

NoDuplicateEffects == \A c \in Children : calls[c] <= 1

(* Any physical replacement still alive or admitted is fenced by RESTARTING.
   After commit or abort, no replacement remains outside the logical actor. *)
NoOrphanReplacement ==
    \A c \in Children :
        replacement[c] # "None" => phase[c] = "Restarting"

NoUnreadyActiveIncarnation ==
    \A c \in Children :
        (phase[c] = "Active" /\ generation[c] > 1)
        => readyGeneration[c] = generation[c]

CleanupBeforeSupervisor ==
    \A c \in Children : phase[c] # "Active" => cleaned[c]

NoStaleIncarnationCommit ==
    \A c \in Children :
        (phase[c] \in {"Restarting", "Stopping", "Stopped"}
          => leaseGeneration[c] = generation[c])

NoUnverifiedStop ==
    \A c \in Children :
        receipt[c] = "Ack" =>
            /\ phase[c] = "Stopped"
            /\ applied[c]
            /\ calls[c] = 1
            /\ committedGeneration[c] = generation[c]

ReceiptCoherence ==
    \A c \in Children :
        /\ (phase[c] = "Stopping" => receipt[c] \in {"Pending", "Uncertain", "Applied"})
        /\ (phase[c] = "Stopped" => receipt[c] = "Ack")
        /\ (phase[c] \in {"Active", "Finalized", "Restarting"} => receipt[c] = "None")
        /\ (receipt[c] = "Uncertain" => ~proof[c] \/ applied[c])
        /\ (proof[c] => applied[c])

ClosedDoesNotOwnControl ==
    \A s \in Supervisors : closed[s] => control[s] = Nobody

(* A second mutation simulates a host abort of a still-live replacement,
   without cleaning the physical incarnation. It MUST falsify the
   replacement ownership invariant. *)
UnsafeAbortWithLiveReplacement(c) ==
    /\ phase[c] = "Restarting"
    /\ replacement[c] \in {"Spawned", "Admitted"}
    /\ phase' = [phase EXCEPT ![c] = "Finalized"]
    /\ leaseGeneration' = [leaseGeneration EXCEPT ![c] = 0]
    /\ UNCHANGED <<owner, generation, cleaned, receipt, calls, applied,
                   proof, committedGeneration, control, closed,
                   nextTurn, turn, replacement, readyGeneration>>

UnsafeAbortNext == Next \/ \E c \in Children : UnsafeAbortWithLiveReplacement(c)
UnsafeAbortSpec == Init /\ [][UnsafeAbortNext]_vars

(* A mutation commits RESTART without admitting the next incarnation. *)
UnsafeCommitWithoutAdmission(c) ==
    /\ phase[c] = "Restarting"
    /\ replacement[c] \in {"None", "Spawned"}
    /\ generation[c] < MaxGeneration
    /\ control[owner[c]] = c
    /\ ~closed[owner[c]]
    /\ phase' = [phase EXCEPT ![c] = "Active"]
    /\ generation' = [generation EXCEPT ![c] = @ + 1]
    /\ cleaned' = [cleaned EXCEPT ![c] = FALSE]
    /\ leaseGeneration' = [leaseGeneration EXCEPT ![c] = 0]
    /\ replacement' = [replacement EXCEPT ![c] = "None"]
    /\ turn' = [turn EXCEPT ![c] = 0]
    /\ control' = [control EXCEPT ![owner[c]] = Nobody]
    /\ UNCHANGED <<owner, receipt, calls, applied, proof,
                   committedGeneration, closed, nextTurn, readyGeneration>>

UnsafeCommitNext == Next \/ \E c \in Children : UnsafeCommitWithoutAdmission(c)
UnsafeCommitSpec == Init /\ [][UnsafeCommitNext]_vars

(* A deliberate mutation must falsify NoDuplicateEffects. *)
UnsafeReplay(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Pending"
    /\ calls[c] = 1
    /\ calls' = [calls EXCEPT ![c] = 2]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   receipt, applied, proof, committedGeneration,
                   control, closed, nextTurn, turn, replacement, readyGeneration>>

MutantNext == Next \/ \E c \in Children : UnsafeReplay(c)
MutantSpec == Init /\ [][MutantNext]_vars

=============================================================================
