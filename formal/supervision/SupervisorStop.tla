-------------------------- MODULE SupervisorStop --------------------------
EXTENDS Naturals, FiniteSets, TLC

(*
  Bounded abstraction of Oreslang's *trusted* supervisor STOP lifecycle.
  This is a safety model, not a proof that arbitrary host callbacks are
  truthful, nor a persistence model. TLC explores all enabled interleavings.
*)
CONSTANTS Children, Turns, MaxGeneration
ASSUME /\ Children # {}
       /\ Turns # {}
       /\ MaxGeneration \in Nat \ {0}

VARIABLES phase, generation, reservedGeneration, receipt, turn,
          starts, verified, succeeded, acknowledgments, observed, closed

vars == <<phase, generation, reservedGeneration, receipt, turn,
          starts, verified, succeeded, acknowledgments, observed, closed>>

Phases == {"Active", "Finalized", "Stopping", "Stopped"}
Receipts == {"None", "Pending", "Applied", "Uncertain", "Ack"}
OpenReceipts == {"Pending", "Applied", "Uncertain"}

Init ==
    /\ phase = [c \in Children |-> "Finalized"]
    /\ generation = [c \in Children |-> 1]
    /\ reservedGeneration = [c \in Children |-> 0]
    /\ receipt = [c \in Children |-> "None"]
    /\ turn = [c \in Children |-> "NoTurn"]
    /\ starts = [c \in Children |-> 0]
    /\ verified = [c \in Children |-> FALSE]
    /\ succeeded = [c \in Children |-> FALSE]
    /\ acknowledgments = [c \in Children |-> 0]
    /\ observed = [c \in Children |-> FALSE]
    /\ closed = FALSE

(* Reservation is the linearization point excluding competing RESTARTs. *)
Reserve(c, t) ==
    /\ ~closed
    /\ phase[c] = "Finalized"
    /\ receipt[c] = "None"
    /\ t \in Turns
    /\ phase' = [phase EXCEPT ![c] = "Stopping"]
    /\ reservedGeneration' = [reservedGeneration EXCEPT ![c] = generation[c]]
    /\ receipt' = [receipt EXCEPT ![c] = "Pending"]
    /\ turn' = [turn EXCEPT ![c] = t]
    /\ UNCHANGED <<generation, starts, verified, succeeded, acknowledgments,
                   observed, closed>>

(* Only one physical host STOP effect may start for one incarnation. *)
StartEffect(c) ==
    /\ ~closed
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Pending"
    /\ starts[c] = 0
    /\ starts' = [starts EXCEPT ![c] = 1]
    /\ UNCHANGED <<phase, generation, reservedGeneration, receipt, turn,
                   verified, succeeded, acknowledgments, observed, closed>>

(* The host's own successful response, on the owning CONTROL turn. *)
HostSuccess(c) ==
    /\ ~closed
    /\ phase[c] = "Stopping"
    /\ receipt[c] \in {"Pending", "Applied"}
    /\ starts[c] = 1
    /\ phase' = [phase EXCEPT ![c] = "Stopped"]
    /\ receipt' = [receipt EXCEPT ![c] = "Ack"]
    /\ succeeded' = [succeeded EXCEPT ![c] = TRUE]
    /\ acknowledgments' = [acknowledgments EXCEPT ![c] = 1]
    /\ observed' = [observed EXCEPT ![c] = TRUE]
    /\ UNCHANGED <<generation, reservedGeneration, turn, starts,
                   verified, closed>>

HostFailure(c) ==
    /\ ~closed
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Pending"
    /\ starts[c] = 1
    /\ receipt' = [receipt EXCEPT ![c] = "Uncertain"]
    /\ UNCHANGED <<phase, generation, reservedGeneration, turn, starts,
                   verified, succeeded, acknowledgments, observed, closed>>

MarkApplied(c) ==
    /\ ~closed
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Pending"
    /\ starts[c] = 1
    /\ receipt' = [receipt EXCEPT ![c] = "Applied"]
    /\ UNCHANGED <<phase, generation, reservedGeneration, turn, starts,
                   verified, succeeded, acknowledgments, observed, closed>>

(* An independently corroborated host effect, not a second STOP call. *)
VerifyEvidence(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] \in OpenReceipts
    /\ starts[c] = 1
    /\ ~verified[c]
    /\ verified' = [verified EXCEPT ![c] = TRUE]
    /\ UNCHANGED <<phase, generation, reservedGeneration, receipt, turn,
                   starts, succeeded, acknowledgments, observed, closed>>

Reconcile(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] \in OpenReceipts
    /\ starts[c] = 1
    /\ verified[c]
    /\ phase' = [phase EXCEPT ![c] = "Stopped"]
    /\ receipt' = [receipt EXCEPT ![c] = "Ack"]
    /\ acknowledgments' = [acknowledgments EXCEPT ![c] = 1]
    /\ UNCHANGED <<generation, reservedGeneration, turn, starts, verified,
                   succeeded, observed, closed>>

(* Original successful Future arrives after independent reconciliation.
   It records observation, never initiates the host effect or ACKs twice. *)
LateHostSuccess(c) ==
    /\ ~closed
    /\ phase[c] = "Stopped"
    /\ receipt[c] = "Ack"
    /\ starts[c] = 1
    /\ ~observed[c]
    /\ observed' = [observed EXCEPT ![c] = TRUE]
    /\ succeeded' = [succeeded EXCEPT ![c] = TRUE]
    /\ UNCHANGED <<phase, generation, reservedGeneration, receipt, turn,
                   starts, verified, acknowledgments, closed>>

(* STOPPING survives process/CONTROL closure; reconciliation is still allowed. *)
Close ==
    /\ ~closed
    /\ closed' = TRUE
    /\ UNCHANGED <<phase, generation, reservedGeneration, receipt, turn,
                   starts, verified, succeeded, acknowledgments, observed>>

(* Restart is possible only BEFORE STOP reservation, not during uncertainty. *)
Restart(c) ==
    /\ ~closed
    /\ phase[c] = "Finalized"
    /\ receipt[c] = "None"
    /\ generation[c] < MaxGeneration
    /\ phase' = [phase EXCEPT ![c] = "Active"]
    /\ generation' = [generation EXCEPT ![c] = @ + 1]
    /\ reservedGeneration' = [reservedGeneration EXCEPT ![c] = 0]
    /\ turn' = [turn EXCEPT ![c] = "NoTurn"]
    /\ starts' = [starts EXCEPT ![c] = 0]
    /\ verified' = [verified EXCEPT ![c] = FALSE]
    /\ succeeded' = [succeeded EXCEPT ![c] = FALSE]
    /\ acknowledgments' = [acknowledgments EXCEPT ![c] = 0]
    /\ observed' = [observed EXCEPT ![c] = FALSE]
    /\ UNCHANGED <<receipt, closed>>

NewFailure(c) ==
    /\ phase[c] = "Active"
    /\ phase' = [phase EXCEPT ![c] = "Finalized"]
    /\ UNCHANGED <<generation, reservedGeneration, receipt, turn, starts,
                   verified, succeeded, acknowledgments, observed, closed>>

Next ==
    \/ Close
    \/ \E c \in Children : StartEffect(c) \/ HostSuccess(c) \/ HostFailure(c)
                              \/ MarkApplied(c) \/ VerifyEvidence(c)
                              \/ Reconcile(c) \/ LateHostSuccess(c)
                              \/ Restart(c) \/ NewFailure(c)
    \/ \E c \in Children, t \in Turns : Reserve(c, t)

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ phase \in [Children -> Phases]
    /\ generation \in [Children -> 1..MaxGeneration]
    /\ reservedGeneration \in [Children -> 0..MaxGeneration]
    /\ receipt \in [Children -> Receipts]
    /\ turn \in [Children -> (Turns \cup {"NoTurn"})]
    /\ starts \in [Children -> Nat]
    /\ verified \in [Children -> BOOLEAN]
    /\ succeeded \in [Children -> BOOLEAN]
    /\ acknowledgments \in [Children -> Nat]
    /\ observed \in [Children -> BOOLEAN]
    /\ closed \in BOOLEAN

NoDoubleEffect == \A c \in Children : starts[c] <= 1
NoDoubleAck == \A c \in Children : acknowledgments[c] <= 1
NoStaleIncarnation ==
    \A c \in Children :
      receipt[c] # "None" => reservedGeneration[c] = generation[c]
NoRestartUnderStop ==
    \A c \in Children :
      receipt[c] \in OpenReceipts => phase[c] = "Stopping"
NoInvalidAck ==
    \A c \in Children :
      receipt[c] = "Ack" =>
        /\ phase[c] = "Stopped"
        /\ starts[c] = 1
        /\ (verified[c] \/ succeeded[c])
        /\ acknowledgments[c] = 1
NoUnownedTicket ==
    \A c \in Children :
      (receipt[c] = "None" => turn[c] = "NoTurn")
      /\ (receipt[c] # "None" => turn[c] \in Turns)

(* Mutation test: a second host effect before the first settles MUST
   produce a TLC counterexample for NoDoubleEffect. *)
UnsafeReplay(c) ==
    /\ ~closed
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Pending"
    /\ starts[c] = 1
    /\ starts' = [starts EXCEPT ![c] = 2]
    /\ UNCHANGED <<phase, generation, reservedGeneration, receipt, turn,
                   verified, succeeded, acknowledgments, observed, closed>>

MutantNext == Next \/ \E c \in Children : UnsafeReplay(c)
MutantSpec == Init /\ [][MutantNext]_vars

(* Fault injection: allowing RESTART while a STOP receipt is unresolved
   must violate NoRestartUnderStop. *)
UnsafeRestart(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] \in OpenReceipts
    /\ phase' = [phase EXCEPT ![c] = "Active"]
    /\ UNCHANGED <<generation, reservedGeneration, receipt, turn,
                   starts, verified, succeeded, acknowledgments, observed, closed>>
MutantRestartNext == Next \/ \E c \in Children : UnsafeRestart(c)
MutantRestartSpec == Init /\ [][MutantRestartNext]_vars

(* Fault injection: acknowledging an uninitiated host effect must
   violate NoInvalidAck. *)
UnsafeAck(c) ==
    /\ phase[c] = "Stopping"
    /\ receipt[c] = "Pending"
    /\ starts[c] = 0
    /\ phase' = [phase EXCEPT ![c] = "Stopped"]
    /\ receipt' = [receipt EXCEPT ![c] = "Ack"]
    /\ acknowledgments' = [acknowledgments EXCEPT ![c] = 1]
    /\ UNCHANGED <<generation, reservedGeneration, turn, starts,
                   verified, succeeded, observed, closed>>
MutantAckNext == Next \/ \E c \in Children : UnsafeAck(c)
MutantAckSpec == Init /\ [][MutantAckNext]_vars

=============================================================================
