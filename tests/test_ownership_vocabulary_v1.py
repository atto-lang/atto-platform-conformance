"""Vocabulary conformance expectations, NOT proof of compiled guest behavior."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VOCABULARY = ROOT / "contracts" / "ownership-vocabulary-v1.json"
CAPABILITIES = ROOT / "contracts" / "ownership-capabilities-v1.json"
REQUIRED = {
    "borrow!", "take!", "share!", "copy!", "copy!!", "mut", "lt!",
    "freeze!", "weak!", "pin!", "drop!",
}

class VocabularyContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(VOCABULARY.read_text(encoding="utf-8"))
        cls.cases = cls.spec["cases"]
        cls.by_id = {c["id"]: c for c in cls.cases}

    def test_eleven_spellings_are_unique_and_complete(self):
        words = [k["spelling"] for k in self.spec["keywords"]]
        self.assertEqual(set(words), REQUIRED)
        self.assertEqual(len(words), len(REQUIRED))
        self.assertTrue(all(k["semantics"] and k["admission"] for k in self.spec["keywords"]))
        self.assertEqual(self.spec["schema"], "atto.ownership-vocabulary.v1")

    def test_no_backend_is_mislabeled_as_implemented(self):
        self.assertEqual(
            self.spec["status"], "SPEC_AND_REFERENCE_ONLY_NO_PRODUCTION_PARITY"
        )
        self.assertEqual(set(self.spec["guest_backends"]),
                         {"java", "llvm", "net", "forge", "wasm"})
        self.assertTrue(all(v == "NOT_VERIFIED"
                            for v in self.spec["guest_backends"].values()))
        self.assertIn("UNEXECUTED", self.spec["browser_compiler"])
        self.assertIn("UNEXECUTED", self.spec["canonical_rust"])

    def test_unique_cases_and_fail_closed_diagnostics(self):
        self.assertGreaterEqual(len(self.cases), 35)
        self.assertEqual(len(self.cases), len(self.by_id), "reused case identity")
        for c in self.cases:
            self.assertIn(c["feature"], REQUIRED)
            self.assertIn(c["expected"], {"accept", "reject"})
            self.assertEqual(c["expected"] == "reject", "diagnostic" in c)
            if c["expected"] == "reject":
                self.assertTrue(c["diagnostic"])

    def test_independent_graph_copy_and_drop_have_explicit_negative_gates(self):
        self.assertEqual(self.by_id["object_deep_copy_without_graph_lowering"]["diagnostic"],
                         "E_DEEP_COPY_PROOF")
        self.assertEqual(self.by_id["deep_copy_without_witness"]["diagnostic"],
                         "E_DEEP_COPY_PROOF_REQUIRED")
        self.assertEqual(self.by_id["drop_twice"]["diagnostic"],
                         "E_USE_AFTER_MOVE_OR_DROP")
        self.assertEqual(self.by_id["drop_resource_guest_unlowered"]["diagnostic"],
                         "E_DROP_UNSUPPORTED")
        self.assertEqual(self.by_id["scalar_drop"]["expected"], "accept")
        self.assertEqual(self.by_id["deep_copy_preserves_internal_cycle"]["expected"],
                         "accept")

    def test_explicit_named_lifetimes_and_implicit_borrow_are_distinct(self):
        self.assertEqual(self.by_id["named_lt_binder"]["expected"], "accept")
        self.assertEqual(self.by_id["lt_value_expression_forbidden"]["diagnostic"],
                         "E_LIFETIME_CONTEXT")
        for case in ("apostrophe_lifetime_forbidden", "lt_outlives_owner",
                     "lt_dangling_escape", "lt_await_live_loan"):
            self.assertEqual(self.by_id[case]["expected"], "reject")
        self.assertEqual(self.by_id["implicit_shared_borrow"]["expected"], "accept")

    def test_capability_registry_remains_linked_and_fails_closed(self):
        caps = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        self.assertEqual(caps["schema"], "atto.ownership-capabilities.v1")
        self.assertEqual(len(caps["capabilities"]), 3)
        self.assertEqual(caps["status"],
                         "CONTRACT_AND_RESTRICTED_MODEL_ONLY_NOT_BACKEND_PARITY")
        self.assertEqual(
            self.by_id["pin_across_await_not_auto_allowed"]["diagnostic"],
            "E_SUSPEND_WITH_LIVE_LOAN",
        )

    def test_pin_is_not_an_unverified_task_or_actor_transfer_capability(self):
        for case_id in (
            "pinned_mailbox_prepare", "pinned_direct_actor_move",
            "pinned_task_capture_move", "pinned_frozen_publication",
            "pinned_guarded_promotion",
        ):
            case = self.by_id[case_id]
            self.assertEqual(case["feature"], "pin!")
            self.assertEqual(case["expected"], "reject")
            self.assertEqual(case["diagnostic"], "E_PIN_BOUNDARY_TRANSFER")


if __name__ == "__main__":
    unittest.main()
