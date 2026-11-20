"""Bounded model must pass; deliberately broken models must fail."""
import importlib.util
from pathlib import Path
import sys
import unittest

MODEL = Path(__file__).resolve().parents[1] / "formal" / "actor_control_model.py"
spec = importlib.util.spec_from_file_location("actor_control_model", MODEL)
model = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = model
spec.loader.exec_module(model)

class ActorControlFormalTest(unittest.TestCase):
    def test_safe_model_exhaustive_and_reaches_corner_cases(self):
        result = model.check()
        self.assertIsNone(result.invariant, (result.invariant, result.trace))
        self.assertGreater(result.states, 30)
        self.assertGreater(result.edges, result.states)
        self.assertTrue({"full-data-plus-control", "stale-replay-rejected",
                         "generation-two-stop", "data-commit-with-restart"}
                        <= result.witnesses, result.witnesses)

    def test_priority_violation_detected(self):
        result = model.check("priority")
        self.assertEqual(result.invariant, "ControlPriority")
        self.assertTrue(any("DATA.dispatch" in x for x in result.trace))

    def test_stale_admission_detected(self):
        result = model.check("stale-admission")
        self.assertEqual(result.invariant, "QueueIncarnation")
        self.assertIn("SUPERVISOR.restart(g2)", result.trace)

    def test_cancelled_reply_resurrection_detected(self):
        result = model.check("cancelled-resurrection")
        self.assertEqual(result.invariant, "NoResurrection")
        self.assertIn("SUPERVISOR.restart(g2)", result.trace)

    def test_lost_message_detected(self):
        result = model.check("lost-message")
        self.assertEqual(result.invariant, "DataConservation")

    def test_duplicate_reply_detected(self):
        result = model.check("duplicate-settlement")
        self.assertEqual(result.invariant, "AtMostOnce")

if __name__ == "__main__":
    unittest.main()
