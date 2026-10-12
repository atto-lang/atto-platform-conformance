---------------- MODULE TypedPipelineTickets ----------------
EXTENDS Naturals, TLC

(*
  Bounded *proposal* model of two request correlation tickets and two actor
  incarnations. Ticket IDs can be reused after restart. A late reply from epoch
  one must not complete a fresh epoch-two ticket, even if IDs happen to match.
  No implementation refinement, fairness or physical isolation is claimed.
*)
CONSTANT Unsafe
ASSUME Unsafe \in BOOLEAN
Tickets == {"t1", "t2"}
Epochs == {0, 1, 2}
VARIABLES phase, epoch, owner, published, forward, backward,
          completed, completionEpoch, oldOwned, staleDrops
vars == <<phase, epoch, owner, published, forward, backward,
          completed, completionEpoch, oldOwned, staleDrops>>
Init ==
  /\ phase = "ready"
  /\ epoch = 1
  /\ owner = [t \in Tickets |-> 0]
  /\ published = [t \in Tickets |-> FALSE]
  /\ forward = [t \in Tickets |-> 0]
  /\ backward = [t \in Tickets |-> 0]
  /\ completed = [t \in Tickets |-> FALSE]
  /\ completionEpoch = [t \in Tickets |-> 0]
  /\ oldOwned = [t \in Tickets |-> FALSE]
  /\ staleDrops = 0

Reserve(t) ==
  /\ phase = "ready"
  /\ owner[t] = 0
  /\ owner' = [owner EXCEPT ![t] = epoch]
  /\ UNCHANGED <<phase,epoch,published,forward,backward,
                 completed,completionEpoch,oldOwned,staleDrops>>
Publish(t) ==
  /\ phase = "ready"
  /\ owner[t] = epoch
  /\ ~published[t]
  /\ published' = [published EXCEPT ![t] = TRUE]
  /\ UNCHANGED <<phase,epoch,owner,forward,backward,
                 completed,completionEpoch,oldOwned,staleDrops>>
Forward(t) ==
  /\ phase = "ready"
  /\ owner[t] = epoch
  /\ published[t]
  /\ forward[t] < 2
  /\ backward[t] = 0
  /\ forward' = [forward EXCEPT ![t] = @ + 1]
  /\ UNCHANGED <<phase,epoch,owner,published,backward,
                 completed,completionEpoch,oldOwned,staleDrops>>
Backward(t) ==
  /\ phase = "ready"
  /\ owner[t] = epoch
  /\ published[t]
  /\ forward[t] = 2
  /\ backward[t] < 2
  /\ ~completed[t]
  /\ backward' = [backward EXCEPT ![t] = @ + 1]
  /\ UNCHANGED <<phase,epoch,owner,published,forward,
                 completed,completionEpoch,oldOwned,staleDrops>>
Complete(t) ==
  /\ phase = "ready"
  /\ owner[t] = epoch
  /\ published[t]
  /\ forward[t] = 2
  /\ backward[t] = 2
  /\ ~completed[t]
  /\ completed' = [completed EXCEPT ![t] = TRUE]
  /\ completionEpoch' = [completionEpoch EXCEPT ![t] = epoch]
  /\ UNCHANGED <<phase,epoch,owner,published,forward,backward,
                 oldOwned,staleDrops>>
Stop ==
  /\ phase = "ready"
  /\ phase' = "stopped"
  /\ UNCHANGED <<epoch,owner,published,forward,backward,
                 completed,completionEpoch,oldOwned,staleDrops>>
Restart ==
  /\ phase = "stopped"
  /\ epoch = 1
  /\ epoch' = 2
  /\ phase' = "ready"
  /\ oldOwned' = [t \in Tickets |-> owner[t] = 1]
  /\ owner' = [t \in Tickets |-> 0]
  /\ published' = [t \in Tickets |-> FALSE]
  /\ forward' = [t \in Tickets |-> 0]
  /\ backward' = [t \in Tickets |-> 0]
  /\ completed' = [t \in Tickets |-> FALSE]
  /\ completionEpoch' = [t \in Tickets |-> 0]
  /\ UNCHANGED staleDrops
DropStale(t) ==
  /\ phase = "ready"
  /\ epoch = 2
  /\ oldOwned[t]
  /\ staleDrops < 2
  /\ staleDrops' = staleDrops + 1
  /\ UNCHANGED <<phase,epoch,owner,published,forward,backward,
                 completed,completionEpoch,oldOwned>>

(* Mutation: a late epoch-one reply completes a new epoch-two ticket
   merely because it reused the same correlation ID. *)
UnsafeStaleComplete(t) ==
  /\ Unsafe
  /\ phase = "ready"
  /\ epoch = 2
  /\ oldOwned[t]
  /\ owner[t] = 2
  /\ published[t]
  /\ forward[t] = 2
  /\ backward[t] = 2
  /\ ~completed[t]
  /\ completed' = [completed EXCEPT ![t] = TRUE]
  /\ completionEpoch' = [completionEpoch EXCEPT ![t] = 1]
  /\ UNCHANGED <<phase,epoch,owner,published,forward,backward,
                 oldOwned,staleDrops>>
Next ==
  \/ \E t \in Tickets : Reserve(t)
  \/ \E t \in Tickets : Publish(t)
  \/ \E t \in Tickets : Forward(t)
  \/ \E t \in Tickets : Backward(t)
  \/ \E t \in Tickets : Complete(t)
  \/ Stop
  \/ Restart
  \/ \E t \in Tickets : DropStale(t)
  \/ \E t \in Tickets : UnsafeStaleComplete(t)

TypeOK ==
  /\ phase \in {"ready","stopped"}
  /\ epoch \in {1,2}
  /\ owner \in [Tickets -> Epochs]
  /\ published \in [Tickets -> BOOLEAN]
  /\ forward \in [Tickets -> 0..2]
  /\ backward \in [Tickets -> 0..2]
  /\ completed \in [Tickets -> BOOLEAN]
  /\ completionEpoch \in [Tickets -> Epochs]
  /\ oldOwned \in [Tickets -> BOOLEAN]
  /\ staleDrops \in 0..2
OnlyPublishedMoves ==
  \A t \in Tickets : (forward[t] > 0 \/ backward[t] > 0) => published[t]
ReverseRequiresTwoForwards ==
  \A t \in Tickets : backward[t] > 0 => forward[t] = 2
CompletionRequiresTwoWayDelivery ==
  \A t \in Tickets : completed[t] =>
    (published[t] /\ forward[t] = 2 /\ backward[t] = 2)
CompletionBoundToCurrentEpoch ==
  \A t \in Tickets : completed[t] =>
    (owner[t] = epoch /\ completionEpoch[t] = owner[t])
NoWorkAfterStop ==
  phase = "stopped" =>
    ~(\E t \in Tickets : ENABLED Forward(t) \/ ENABLED Backward(t) \/ ENABLED Complete(t))
Spec == Init /\ [][Next]_vars
================================================================
