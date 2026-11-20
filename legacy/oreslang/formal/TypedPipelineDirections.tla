---------------- MODULE TypedPipelineDirections ----------------
EXTENDS Naturals, TLC

(* Proposal-level bounded 3-stage direction/epoch model. This specifies
   language-intended sequencing; it is NOT executable compiler parity. *)
CONSTANT Unsafe
ASSUME Unsafe \in BOOLEAN

VARIABLES phase, epoch, forwardHops, backwardHops, replyEpoch,
          done, doneEpoch, staleDrops
vars == <<phase, epoch, forwardHops, backwardHops, replyEpoch,
          done, doneEpoch, staleDrops>>

Init ==
  /\ phase = "ready"
  /\ epoch = 1
  /\ forwardHops = 0
  /\ backwardHops = 0
  /\ replyEpoch = 0
  /\ done = FALSE
  /\ doneEpoch = 0
  /\ staleDrops = 0

Forward ==
  /\ phase = "ready"
  /\ forwardHops < 2
  /\ backwardHops = 0
  /\ forwardHops' = forwardHops + 1
  /\ UNCHANGED <<phase, epoch, backwardHops, replyEpoch, done, doneEpoch, staleDrops>>

Backward ==
  /\ phase = "ready"
  /\ forwardHops = 2
  /\ backwardHops < 2
  /\ ~done
  /\ backwardHops' = backwardHops + 1
  /\ replyEpoch' = epoch
  /\ UNCHANGED <<phase, epoch, forwardHops, done, doneEpoch, staleDrops>>

Complete ==
  /\ phase = "ready"
  /\ forwardHops = 2
  /\ backwardHops = 2
  /\ ~done
  /\ replyEpoch = epoch
  /\ done' = TRUE
  /\ doneEpoch' = epoch
  /\ UNCHANGED <<phase, epoch, forwardHops, backwardHops, replyEpoch, staleDrops>>

Stop ==
  /\ phase = "ready"
  /\ phase' = "stopped"
  /\ UNCHANGED <<epoch, forwardHops, backwardHops, replyEpoch, done, doneEpoch, staleDrops>>

Restart ==
  /\ phase = "stopped"
  /\ epoch = 1
  /\ phase' = "ready"
  /\ epoch' = 2
  /\ forwardHops' = 0
  /\ backwardHops' = 0
  /\ replyEpoch' = 0
  /\ done' = FALSE
  /\ doneEpoch' = 0
  /\ UNCHANGED staleDrops

DropStale ==
  /\ epoch = 2
  /\ staleDrops < 1
  /\ staleDrops' = staleDrops + 1
  /\ UNCHANGED <<phase, epoch, forwardHops, backwardHops, replyEpoch, done, doneEpoch>>

(* Intentionally incorrect: upstream result can be accepted before reaching sink. *)
UnsafeEarlyBackward ==
  /\ Unsafe
  /\ phase = "ready"
  /\ forwardHops < 2
  /\ backwardHops = 0
  /\ backwardHops' = 1
  /\ replyEpoch' = epoch
  /\ UNCHANGED <<phase, epoch, forwardHops, done, doneEpoch, staleDrops>>

Next ==
  \/ Forward
  \/ Backward
  \/ Complete
  \/ Stop
  \/ Restart
  \/ DropStale
  \/ UnsafeEarlyBackward

TypeOK ==
  /\ phase \in {"ready", "stopped"}
  /\ epoch \in {1,2}
  /\ forwardHops \in 0..2
  /\ backwardHops \in 0..2
  /\ replyEpoch \in 0..2
  /\ done \in BOOLEAN
  /\ doneEpoch \in 0..2
  /\ staleDrops \in 0..1

ReverseRequiresFullForwardPath ==
  backwardHops > 0 => forwardHops = 2
ReverseHasCurrentEpoch ==
  backwardHops > 0 => replyEpoch = epoch
CompletionRequiresFullRoundTrip ==
  done => (forwardHops = 2 /\ backwardHops = 2 /\ doneEpoch = epoch)
NoWorkAfterStop ==
  phase = "stopped" => ~(ENABLED Forward \/ ENABLED Backward \/ ENABLED Complete)

Spec == Init /\ [][Next]_vars
===============================================================
