-------------------- MODULE MergeQualificationV1 --------------------
EXTENDS Naturals
CONSTANTS HeadA, HeadB
ASSUME HeadA # HeadB

\* Source-free, bounded security-policy model. A TLC result on this model
\* does not authenticate GitHub evidence or prove compiler guest execution.
VARIABLES head, approvedHead, reviewState, ciHead, ciSteps,
          ciGood, protectedMain, noBypass, merged

vars == <<head, approvedHead, reviewState, ciHead, ciSteps,
          ciGood, protectedMain, noBypass, merged>>

Init ==
  /\ head = HeadA
  /\ approvedHead = "none"
  /\ reviewState = "NONE"
  /\ ciHead = "none"
  /\ ciSteps = 0
  /\ ciGood = FALSE
  /\ protectedMain = FALSE
  /\ noBypass = FALSE
  /\ merged = FALSE

CurrentApproval ==
  /\ reviewState = "APPROVED"
  /\ approvedHead = head

ExecutedExactHeadCI ==
  /\ ciHead = head
  /\ ciSteps > 0
  /\ ciGood

EnforcedGovernance == protectedMain /\ noBypass

CanMerge ==
  /\ CurrentApproval
  /\ ExecutedExactHeadCI
  /\ EnforcedGovernance

AdvanceHead ==
  /\ ~merged
  /\ head' = IF head = HeadA THEN HeadB ELSE HeadA
  /\ UNCHANGED <<approvedHead, reviewState, ciHead, ciSteps,
                 ciGood, protectedMain, noBypass, merged>>

ApproveCurrent ==
  /\ ~merged
  /\ approvedHead' = head
  /\ reviewState' = "APPROVED"
  /\ UNCHANGED <<head, ciHead, ciSteps, ciGood,
                 protectedMain, noBypass, merged>>

RequestChanges ==
  /\ ~merged
  /\ reviewState' = "CHANGES_REQUESTED"
  /\ UNCHANGED <<head, approvedHead, ciHead, ciSteps,
                 ciGood, protectedMain, noBypass, merged>>

DismissReview ==
  /\ ~merged
  /\ reviewState' = "DISMISSED"
  /\ UNCHANGED <<head, approvedHead, ciHead, ciSteps,
                 ciGood, protectedMain, noBypass, merged>>

SuccessfulExecutedRun ==
  /\ ~merged
  /\ ciHead' = head
  /\ ciSteps' = 2
  /\ ciGood' = TRUE
  /\ UNCHANGED <<head, approvedHead, reviewState,
                 protectedMain, noBypass, merged>>

RunnerAdmissionFailure ==
  /\ ~merged
  /\ ciHead' = head
  /\ ciSteps' = 0
  /\ ciGood' = FALSE
  /\ UNCHANGED <<head, approvedHead, reviewState,
                 protectedMain, noBypass, merged>>

\* Mutant: a forged success label with zero steps must NEVER enable merge.
ForgedZeroStepSuccess ==
  /\ ~merged
  /\ ciHead' = head
  /\ ciSteps' = 0
  /\ ciGood' = TRUE
  /\ UNCHANGED <<head, approvedHead, reviewState,
                 protectedMain, noBypass, merged>>

EnableProtection ==
  /\ ~merged
  /\ protectedMain' = TRUE
  /\ noBypass' = TRUE
  /\ UNCHANGED <<head, approvedHead, reviewState, ciHead,
                 ciSteps, ciGood, merged>>

DisableProtection ==
  /\ ~merged
  /\ protectedMain' = FALSE
  /\ noBypass' = FALSE
  /\ UNCHANGED <<head, approvedHead, reviewState, ciHead,
                 ciSteps, ciGood, merged>>

Merge ==
  /\ ~merged
  /\ CanMerge
  /\ merged' = TRUE
  /\ UNCHANGED <<head, approvedHead, reviewState, ciHead,
                 ciSteps, ciGood, protectedMain, noBypass>>

Next ==
  \/ AdvanceHead
  \/ ApproveCurrent
  \/ RequestChanges
  \/ DismissReview
  \/ SuccessfulExecutedRun
  \/ RunnerAdmissionFailure
  \/ ForgedZeroStepSuccess
  \/ EnableProtection
  \/ DisableProtection
  \/ Merge

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ head \in {HeadA, HeadB}
  /\ approvedHead \in {HeadA, HeadB, "none"}
  /\ reviewState \in {"NONE", "APPROVED", "CHANGES_REQUESTED", "DISMISSED"}
  /\ ciHead \in {HeadA, HeadB, "none"}
  /\ ciSteps \in Nat
  /\ ciGood \in BOOLEAN
  /\ protectedMain \in BOOLEAN
  /\ noBypass \in BOOLEAN
  /\ merged \in BOOLEAN

NoMergeWithoutCurrentReview == merged => CurrentApproval
NoMergeWithUnexecutedOrStaleCI == merged => ExecutedExactHeadCI
NoMergeWithoutProtection == merged => EnforcedGovernance
NoUnsafeMerge == merged => CanMerge

=============================================================================
