"""Source-only schema and evidence gate for AttoLang ownership capabilities.

This is deliberately NOT a backend executor. A checked-in expectation matrix
must not be confused with real compiler/runtime CI or tenant-isolation proof.
"""
import json
import unittest
from pathlib import Path

MANIFEST = Path(__file__).resolve().parents[1] / "contracts" / "ownership-capabilities-v1.json"
ALLOWED = {"source_parser", "browser_compiler", "canonical_verifier", "host_runtime_model"}
CAPABILITIES = {"freeze", "weak", "pin"}
REQUIRED_DIAGNOSTICS = {
    "E_FREEZE_PROOF",
    "E_WEAK_UNSUPPORTED", "E_PIN_UNSUPPORTED",
    "E_DEEP_FREEZE_PROOF_REQUIRED", "E_BORROW_CONFLICT",
    "E_FROZEN_WRITE", "E_FROZEN_BORROW_MUT",
    "E_PIN_ADDRESS_PROOF_REQUIRED", "E_PIN_RELOCATION",
    "E_SUSPEND_WITH_LIVE_LOAN", "E_WEAK_SHARED_REGION_REQUIRED",
    "E_WEAK_GENERATION_PROOF_REQUIRED", "E_WEAK_DEF_REUSED",
    "UnfreezableEdge", "WrongDomain", "Retired", "None",
}


class OwnershipContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(MANIFEST.read_text(encoding="utf-8"))
        cls.cases = cls.contract["cases"]
        cls.by_id = {case["id"]: case for case in cls.cases}

    def test_version_and_evidence_must_not_claim_runtime_parity(self):
        c = self.contract
        self.assertEqual(c["schema"], "atto.ownership-capabilities.v1")
        self.assertEqual(c["status"], "CONTRACT_AND_RESTRICTED_MODEL_ONLY_NOT_BACKEND_PARITY")
        self.assertTrue(c["required_pr_head_binding"])
        self.assertIn("NOT evidence", c["warning"])
        self.assertGreaterEqual(len(c["backend_evidence"]), 5)
        for backend, evidence in c["backend_evidence"].items():
            self.assertEqual(evidence, "NOT_VERIFIED", backend)

    def test_every_case_has_a_unique_identity_and_safety_observation(self):
        self.assertGreaterEqual(len(self.cases), 40)
        self.assertEqual(len(self.by_id), len(self.cases), "duplicate fixture IDs")
        for case in self.cases:
            with self.subTest(case=case["id"]):
                self.assertIn(case["layer"], ALLOWED)
                self.assertIn(case["capability"], CAPABILITIES)
                self.assertIn(case["expected"], {"accept", "reject"})
                self.assertEqual("diagnostic" in case, case["expected"] == "reject")
                if "diagnostic" in case:
                    self.assertTrue(case["diagnostic"], "failure needs a specific diagnostic")
                self.assertEqual(
                    set(case),
                    {"id", "layer", "capability", "expected"}
                    | ({"diagnostic"} if case["expected"] == "reject" else set()),
                )

    def test_new_syntax_does_not_imply_weak_pin_runtime_admission(self):
        for keyword in CAPABILITIES:
            self.assertEqual(self.by_id["parse_" + keyword]["expected"], "accept")
        self.assertEqual(
            self.by_id["weak_no_wasm_lowering"]["diagnostic"], "E_WEAK_UNSUPPORTED"
        )
        self.assertEqual(
            self.by_id["pin_no_wasm_lowering"]["diagnostic"], "E_PIN_UNSUPPORTED"
        )
        self.assertEqual(
            self.by_id["class_freeze_without_witness"]["diagnostic"], "E_FREEZE_PROOF"
        )

    def test_graph_freezing_is_transitive_and_final(self):
        semantics = self.contract["capabilities"]["freeze"]
        self.assertTrue(semantics["consume_owner"])
        self.assertTrue(semantics["deep_graph_required"])
        self.assertTrue(semantics["mutable_alias_survival_forbidden"])
        self.assertTrue(semantics["read_only_after_freeze"])
        self.assertEqual(self.by_id["write_frozen_owner"]["diagnostic"], "E_FROZEN_WRITE")
        self.assertEqual(self.by_id["freeze_after_loan"]["diagnostic"], "E_BORROW_CONFLICT")
        for forbidden in [
            "external_mutable_graph_alias", "interior_mutable_graph_child",
            "foreign_pointer_in_graph", "dynamic_unknown_graph_child",
        ]:
            self.assertEqual(self.by_id[forbidden]["diagnostic"], "UnfreezableEdge")

    def test_weak_never_adds_lifetime_or_cross_tenant_rights(self):
        semantics = self.contract["capabilities"]["weak"]
        self.assertTrue(semantics["requires_shared_owner"])
        self.assertTrue(semantics["does_not_retain_lifetime"])
        self.assertTrue(semantics["domain_authorization_required"])
        self.assertTrue(semantics["generation_fence_required"])
        self.assertEqual(semantics["upgrade_returns"], "Option<Shared<T>>")
        for forbidden in [
            "weak_upgrade_after_retirement",
            "weak_upgrade_wrong_region_permit",
            "stale_weak_new_allocation_same_tenant",
        ]:
            self.assertEqual(self.by_id[forbidden]["diagnostic"], "None")

    def test_pin_does_not_change_suspend_or_thread_affinity_rules(self):
        semantics = self.contract["capabilities"]["pin"]
        self.assertTrue(semantics["stable_pointee_address"])
        self.assertFalse(semantics["thread_affinity"])
        self.assertFalse(semantics["borrow_across_await_automatically_allowed"])
        self.assertEqual(
            self.by_id["pin_borrow_across_suspend"]["diagnostic"],
            "E_SUSPEND_WITH_LIVE_LOAN",
        )
        self.assertEqual(
            self.by_id["pointee_relocation_after_pin"]["diagnostic"],
            "E_PIN_RELOCATION",
        )

    def test_negative_coverage_includes_all_three_rights(self):
        for capability in CAPABILITIES:
            self.assertTrue(any(
                c["capability"] == capability and c["expected"] == "reject"
                for c in self.cases
            ), capability)
        found = {c.get("diagnostic") for c in self.cases}
        # Some diagnostics are language-level, others belong to the Rust
        # runtime model. Their exact spellings are deliberately versioned.
        self.assertTrue(REQUIRED_DIAGNOSTICS <= found)


if __name__ == "__main__":
    unittest.main()
