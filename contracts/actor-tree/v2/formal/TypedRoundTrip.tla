--------------------------- MODULE TypedRoundTrip ---------------------------
EXTENDS Naturals, TLC
(*
  Four-hop A -> B -> C -> B -> A signed-i64 protocol abstraction.
  The current actor incarnation and schema hash must be unchanged at every
  hop; each observable hop commits exactly one host delivery. STOP fences
  remaining hops and stale callbacks cannot create new deliveries.
  Bounded safety model only: not Java/LLVM runtime refinement.
*)
CONSTANTS UnsafeSchemaSwap, UnsafeIncarnationReuse, UnsafeDuplicateDelivery,
          UnsafePostStopDelivery
ASSUME UnsafeSchemaSwap \in BOOLEAN /\ UnsafeIncarnationReuse \in BOOLEAN
    /\ UnsafeDuplicateDelivery \in BOOLEAN
    /\ UnsafePostStopDelivery \in BOOLEAN
VARIABLES hop, stopped, schemaValid, incarnationValid, deliveryCount, staleSeen,
          postStopDelivered
vars == <<hop, stopped, schemaValid, incarnationValid, deliveryCount, staleSeen,
          postStopDelivered>>
Init ==
    /\ hop = 0 /\ stopped = FALSE
    /\ schemaValid = TRUE /\ incarnationValid = TRUE
    /\ deliveryCount = 0 /\ staleSeen = FALSE /\ postStopDelivered = FALSE
DeliverNext ==
    /\ ~stopped /\ hop < 4 /\ schemaValid /\ incarnationValid
    /\ hop' = hop + 1 /\ deliveryCount' = deliveryCount + 1
    /\ UNCHANGED <<stopped, schemaValid, incarnationValid, staleSeen,
                  postStopDelivered>>
RequestStop ==
    /\ ~stopped /\ stopped' = TRUE
    /\ UNCHANGED <<hop, schemaValid, incarnationValid, deliveryCount, staleSeen,
                  postStopDelivered>>
RejectStaleCallback ==
    /\ stopped /\ ~staleSeen /\ staleSeen' = TRUE
    /\ UNCHANGED <<hop, stopped, schemaValid, incarnationValid, deliveryCount,
                  postStopDelivered>>
UnsafeSwapSchema ==
    /\ UnsafeSchemaSwap /\ ~stopped /\ hop = 1
    /\ schemaValid' = FALSE /\ hop' = 2
    /\ deliveryCount' = deliveryCount + 1
    /\ UNCHANGED <<stopped, incarnationValid, staleSeen, postStopDelivered>>
UnsafeReuseIncarnation ==
    /\ UnsafeIncarnationReuse /\ ~stopped /\ hop = 2
    /\ incarnationValid' = FALSE /\ hop' = 3
    /\ deliveryCount' = deliveryCount + 1
    /\ UNCHANGED <<stopped, schemaValid, staleSeen, postStopDelivered>>
UnsafeReplayDelivery ==
    /\ UnsafeDuplicateDelivery /\ hop = 4 /\ deliveryCount = 4
    /\ deliveryCount' = 5
    /\ UNCHANGED <<hop, stopped, schemaValid, incarnationValid, staleSeen,
                  postStopDelivered>>
UnsafeDeliverAfterStop ==
    /\ UnsafePostStopDelivery /\ stopped /\ hop < 4
    /\ hop' = hop + 1 /\ deliveryCount' = deliveryCount + 1
    /\ postStopDelivered' = TRUE
    /\ UNCHANGED <<stopped, schemaValid, incarnationValid, staleSeen>>
Next == \/ DeliverNext \/ RequestStop \/ RejectStaleCallback
        \/ UnsafeSwapSchema \/ UnsafeReuseIncarnation \/ UnsafeReplayDelivery
        \/ UnsafeDeliverAfterStop
Spec == Init /\ [][Next]_vars
TypeOK ==
    /\ hop \in 0..4 /\ deliveryCount \in 0..5
    /\ stopped \in BOOLEAN /\ schemaValid \in BOOLEAN
    /\ incarnationValid \in BOOLEAN /\ staleSeen \in BOOLEAN
    /\ postStopDelivered \in BOOLEAN
NoSchemaSubstitution == schemaValid
NoABAIncarnationReuse == incarnationValid
ExactlyOnceDelivery == deliveryCount = hop
NoPostStopDelivery == ~postStopDelivered
=============================================================================
