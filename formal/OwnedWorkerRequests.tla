--------------------- MODULE OwnedWorkerRequests ---------------------
EXTENDS Naturals, FiniteSets, TLC

(*
  Bounded reference model of host-owned actor Worker request admission.
  It is a specification of the intended protocol, not a mechanical proof
  that JavaScript implements its transitions. The model includes two
  request tickets and two physical Worker incarnations.
*)
CONSTANT Unsafe
ASSUME Unsafe \in BOOLEAN

Tickets == {"t1", "t2"}
Generations == {"g1", "g2"}
Stages == {"idle", "reserved", "sent", "verifying", "completed", "rejected"}
Pending == {"reserved", "sent", "verifying"}

VARIABLES generation, phase, stage, owner, published, completedBy, completions, staleDrops
vars == <<generation, phase, stage, owner, published, completedBy, completions, staleDrops>>

Init ==
  /\ generation = "g1"
  /\ phase = "ready"
  /\ stage = [t \in Tickets |-> "idle"]
  /\ owner = [t \in Tickets |-> "none"]
  /\ published = [t \in Tickets |-> FALSE]
  /\ completedBy = [t \in Tickets |-> "none"]
  /\ completions = [t \in Tickets |-> 0]
  /\ staleDrops = 0

Reserve(t) ==
  /\ phase = "ready"
  /\ stage[t] = "idle"
  /\ stage' = [stage EXCEPT ![t] = "reserved"]
  /\ owner' = [owner EXCEPT ![t] = generation]
  /\ UNCHANGED <<generation, phase, published, completedBy, completions, staleDrops>>

Publish(t) ==
  /\ phase = "ready"
  /\ stage[t] = "reserved"
  /\ owner[t] = generation
  /\ stage' = [stage EXCEPT ![t] = "sent"]
  /\ published' = [published EXCEPT ![t] = TRUE]
  /\ UNCHANGED <<generation, phase, owner, completedBy, completions, staleDrops>>

BeginVerify(t) ==
  /\ phase = "ready"
  /\ stage[t] = "sent"
  /\ owner[t] = generation
  /\ stage' = [stage EXCEPT ![t] = "verifying"]
  /\ UNCHANGED <<generation, phase, owner, published, completedBy, completions, staleDrops>>

Complete(t) ==
  /\ phase = "ready"
  /\ stage[t] = "verifying"
  /\ owner[t] = generation
  /\ stage' = [stage EXCEPT ![t] = "completed"]
  /\ completedBy' = [completedBy EXCEPT ![t] = generation]
  /\ completions' = [completions EXCEPT ![t] = @ + 1]
  /\ UNCHANGED <<generation, phase, owner, published, staleDrops>>

Reject(t) ==
  /\ phase = "ready"
  /\ stage[t] \in Pending
  /\ owner[t] = generation
  /\ stage' = [stage EXCEPT ![t] = "rejected"]
  /\ UNCHANGED <<generation, phase, owner, published, completedBy, completions, staleDrops>>

TimeoutOrClose ==
  /\ phase = "ready"
  /\ phase' = "closed"
  /\ stage' = [t \in Tickets |-> IF stage[t] \in Pending THEN "rejected" ELSE stage[t]]
  /\ UNCHANGED <<generation, owner, published, completedBy, completions, staleDrops>>

Restart ==
  /\ phase = "closed"
  /\ generation = "g1"
  /\ generation' = "g2"
  /\ phase' = "ready"
  /\ UNCHANGED <<stage, owner, published, completedBy, completions, staleDrops>>

DropStaleReply(t) ==
  /\ phase = "ready"
  /\ generation = "g2"
  /\ owner[t] = "g1"
  /\ staleDrops < 2
  /\ staleDrops' = staleDrops + 1
  /\ UNCHANGED <<generation, phase, stage, owner, published, completedBy, completions>>

(* Mutation: a guessed reply satisfies a reserved, unpublished request. *)
UnsafePrePublicationComplete(t) ==
  /\ Unsafe
  /\ phase = "ready"
  /\ stage[t] = "reserved"
  /\ stage' = [stage EXCEPT ![t] = "completed"]
  /\ completedBy' = [completedBy EXCEPT ![t] = generation]
  /\ completions' = [completions EXCEPT ![t] = @ + 1]
  /\ UNCHANGED <<generation, phase, owner, published, staleDrops>>

Next ==
  \/ \E t \in Tickets : Reserve(t)
  \/ \E t \in Tickets : Publish(t)
  \/ \E t \in Tickets : BeginVerify(t)
  \/ \E t \in Tickets : Complete(t)
  \/ \E t \in Tickets : Reject(t)
  \/ TimeoutOrClose
  \/ Restart
  \/ \E t \in Tickets : DropStaleReply(t)
  \/ \E t \in Tickets : UnsafePrePublicationComplete(t)

TypeOK ==
  /\ generation \in Generations
  /\ phase \in {"ready", "closed"}
  /\ stage \in [Tickets -> Stages]
  /\ owner \in [Tickets -> (Generations \cup {"none"})]
  /\ published \in [Tickets -> BOOLEAN]
  /\ completedBy \in [Tickets -> (Generations \cup {"none"})]
  /\ completions \in [Tickets -> 0..1]
  /\ staleDrops \in 0..2

CompletionRequiresPublication ==
  \A t \in Tickets : (stage[t] = "completed") => published[t]
AtMostOnce ==
  \A t \in Tickets : completions[t] <= 1
CompletionBoundToIncarnation ==
  \A t \in Tickets : (stage[t] = "completed") =>
      (completedBy[t] = owner[t] /\ owner[t] \in Generations)
TerminalClearsPending ==
  (phase = "closed") => (\A t \in Tickets : stage[t] \notin Pending)
NoCrossGenerationPending ==
  \A t \in Tickets : (stage[t] \in Pending) => owner[t] = generation
RejectedNeverCompletes ==
  \A t \in Tickets : (stage[t] = "rejected") => completions[t] = 0

Spec == Init /\ [][Next]_vars
=============================================================================
