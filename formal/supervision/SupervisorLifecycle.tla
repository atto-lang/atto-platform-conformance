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

Phases == {"Active", "Finalized", "Restarting", "Stopping", "Stopped"}
Receipts == {"None", "Pending", "Applied", "Uncertain", "Ack"}
Unresolved == {"Pending", "Uncertain"}
Nobody == "Nobody"

VARIABLES owner, phase, generation, cleaned, leaseGeneration,
          receipt, calls, applied, proof, committedGeneration,
          control, closed, nextTurn, turn

vars == <<owner, phase, generation, cleaned, leaseGeneration,
          receipt, calls, applied, proof, committedGeneration,
          control, closed, nextTurn, turn>>

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

(* The actual actor carrier must finish cleanup before finalization. *)
Cleanup(c) ==
    /\ phase[c] = "Active"
    /\ ~cleaned[c]
    /\ cleaned' = [cleaned EXCEPT ![c] = TRUE]
    /\ UNCHANGED <<owner, phase, generation, leaseGeneration, receipt,
                   calls, applied, proof, committedGeneration, control,
                   closed, nextTurn, turn>>

Finalize(c) ==
    /\ phase[c] = "Active"
    /\ cleaned[c]
    /\ phase' = [phase EXCEPT ![c] = "Finalized"]
    /\ UNCHANGED <<owner, generation, cleaned, leaseGeneration, receipt,
                   calls, applied, proof, committedGeneration, control,
                   closed, nextTurn, turn>>

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
                   receipt, calls, applied, proof, committedGeneration, closed>>

(* STOP and RESTART race to mutate the SAME Finalized phase. *)
ReserveStop(c) ==
    /\ phase[c] = "Finalized"
    /\ control[owner[c]] = c
    /\ receipt[c] = "None"
    /\ phase' = [phase EXCEPT ![c] = "Stopping"]
    /\ receipt' = [receipt EXCEPT ![c] = "Pending"]
    /\ leaseGeneration' = [leaseGeneration EXCEPT ![c] = generation[c]]
    /\ UNCHANGED <<owner, generation, cleaned, calls, applied, proof,
                   committedGeneration, control, closed, nextTurn, turn>>

ReserveRestart(c) ==
    /\ phase[c] = "Finalized"
    /\ control[owner[c]] = c
    /\ receipt[c] = "None"
    /\ phase' = [phase EXCEPT ![c] = "Restarting"]
    /\ leaseGeneration' = [leaseGeneration EXCEPT ![c] = generation[c]]
    /\ UNCHANGED <<owner, generation, cleaned, receipt, calls, applied,
                   proof, committedGeneration, control, closed, nextTurn, turn>>

AbortRestart(c) ==
    /\ phase[c] = "Restarting"
    /\ leaseGeneration[c] = generation[c]
    /\ phase' = [phase EXCEPT ![c] = "Finalized"]
    /\ leaseGeneration' = [leaseGeneration EXCEPT ![c] = 0]
    /\ UNCHANGED <<owner, generation, cleaned, receipt, calls, applied,
                   proof, committedGeneration, control, closed, nextTurn, turn>>

(* Model assumption: a real new actor has already been admitted/readied.
   This transition represents the registry's atomic identity replacement. *)
CommitRestart(c) ==
    /\ phase[c] = "Restarting"
    /\ leaseGeneration[c] = generation[c]
    /\ generation[c] < MaxGeneration
    /\ ~closed[owner[c]]
    /\ control[owner[c]] = c
    /\ phase' = [phase EXCEPT ![c] = "Active"]
    /\ generation' = [generation EXCEPT ![c] = @ + 1]
    /\ cleaned' = [cleaned EXCEPT ![c] = FALSE]
    /\ leaseGeneration' = [leaseGeneration EXCEPT ![c] = 0]
    /\ calls' = [calls EXCEPT ![c] = 0]
    /\ applied' = [applied EXCEPT ![c] = FALSE]
    /\ proof' = [proof EXCEPT ![c] = FALSE]
    /\ turn' = [turn EXCEPT ![c] = 0]
    /\ control' = [control EXCEPT ![owner[c]] = Nobody]
    /\ UNCHANGED <<owner, receipt, committedGeneration, closed, nextTurn>>

StartHostEffect(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Pending"
    /\ control[owner[c]] = c
    /\ ~closed[owner[c]]
    /\ calls[c] = 0
    /\ calls' = [calls EXCEPT ![c] = 1]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   receipt, applied, proof, committedGeneration, control,
                   closed, nextTurn, turn>>

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
                   nextTurn, turn>>

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
                   nextTurn, turn>>

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
                   applied, proof, closed, nextTurn, turn>>

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
                   closed, nextTurn, turn>>

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
                   applied, proof, closed, nextTurn, turn>>

(* Close never rolls back STOPPING, even if no host receipt has arrived. *)
CloseSupervisor(s) ==
    /\ ~closed[s]
    /\ closed' = [closed EXCEPT ![s] = TRUE]
    /\ control' = [control EXCEPT ![s] = Nobody]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   receipt, calls, applied, proof, committedGeneration,
                   nextTurn, turn>>

Next ==
    \/ \E c \in Children :
         Cleanup(c) \/ Finalize(c) \/ AcquireControl(c)
         \/ ReserveStop(c) \/ ReserveRestart(c)
         \/ AbortRestart(c) \/ CommitRestart(c)
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

(* A deliberate mutation must falsify NoDuplicateEffects. *)
UnsafeReplay(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Pending"
    /\ calls[c] = 1
    /\ calls' = [calls EXCEPT ![c] = 2]
    /\ UNCHANGED <<owner, phase, generation, cleaned, leaseGeneration,
                   receipt, applied, proof, committedGeneration,
                   control, closed, nextTurn, turn>>

MutantNext == Next \/ \E c \in Children : UnsafeReplay(c)
MutantSpec == Init /\ [][MutantNext]_vars

=============================================================================
