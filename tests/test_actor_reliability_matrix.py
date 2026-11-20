#!/usr/bin/env python3
import json, pathlib, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
D=json.loads((ROOT/"contracts/actor-reliability-v1.json").read_text())
class ActorReliabilityMatrix(unittest.TestCase):
    def test_no_false_backend_certification(self):
        self.assertEqual(D["backends"]["java"],"foundation-in-progress")
        self.assertEqual(D["backends"]["llvm"],"not-certified")
        p=D["promotion"]
        self.assertIs(p["hostUnitTestsAloneSufficient"],False)
        self.assertIs(p["guestSourceExecutionRequired"],True)
        self.assertIs(p["exactHeadRequired"],True)
        self.assertIs(p["zeroStepActionRunCountsAsEvidence"],False)
        self.assertIs(p["crossBackendParityRequiresBothExecuted"],True)
    def test_scenario_ids_unique_and_bounded_failure_cases_present(self):
        ids=[s["id"] for s in D["scenarios"]]
        self.assertEqual(len(ids),len(set(ids)))
        required={"bounded-mailbox-saturation","control-during-data-overload",
                  "reply-timeout-cancel-race","crash-loop","scheduler-fairness",
                  "bounded-observability","shutdown-race",
                  "deterministic-fault-injection","hundred-client-linearizability"}
        self.assertTrue(required <= set(ids))
    def test_every_scenario_has_explicit_obligations(self):
        for s in D["scenarios"]:
            self.assertTrue(s["requires"],s["id"])
            self.assertEqual(len(s["requires"]),len(set(s["requires"])))
if __name__=="__main__": unittest.main()
