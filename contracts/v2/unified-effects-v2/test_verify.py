"""Adversarial source-free tests for unified effect inference v2."""
import copy
import unittest
from verify import load, verify, assess, InvalidContract


class UnifiedEffectsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = load()

    def test_contract_matrix(self):
        self.assertEqual(verify(self.contract), 31)

    def test_effects_are_not_permissions_or_backend_proof(self):
        self.assertEqual(set(self.contract["backends"].values()), {"NOT_EXECUTED"})
        self.assertEqual(self.contract["status"], "SOURCE_FREE_MODEL_NOT_GUEST_EXECUTION")
        self.assertNotIn("permissions", self.contract["rules"])

    def test_transitive_allocation_fail_closed(self):
        case = copy.deepcopy(next(x for x in self.contract["cases"] if x["name"] == "transitive_bound_accept"))
        self.assertEqual(assess(self.contract, case), ("accept", None))
        case["functions"][0]["bound"] = []
        self.assertEqual(assess(self.contract, case), ("reject", "E_EFFECT_BOUND"))

    def test_unsealed_dispatch_is_unknown_even_for_pure_targets(self):
        case = copy.deepcopy(next(x for x in self.contract["cases"] if x["name"] == "unsealed_dynamic_dispatch_fail_closed"))
        self.assertEqual(assess(self.contract, case), ("reject", "E_EFFECT_UNKNOWN"))
        case["functions"][0]["calls"][0]["sealed"] = True
        self.assertEqual(assess(self.contract, case), ("accept", None))

    def test_indirect_suspend_in_critical(self):
        case = next(x for x in self.contract["cases"] if x["name"] == "critical_write_cannot_suspend_indirect")
        self.assertEqual(assess(self.contract, case), ("reject", "E_EFFECT_CRITICAL_SUSPEND"))

    def test_ambient_clock_is_not_hidden_by_io_bound(self):
        case = copy.deepcopy(next(x for x in self.contract["cases"] if x["name"] == "deterministic_clock_reject"))
        case["functions"][0]["bound"] = ["io", "nondet"]
        self.assertEqual(assess(self.contract, case), ("reject", "E_NONDETERMINISTIC"))

    def test_unrecognized_operation_rejected(self):
        case = copy.deepcopy(next(x for x in self.contract["cases"] if x["name"] == "infer_pure_scalar"))
        case["functions"][0]["ops"] = ["pretend_primitive_without_summary"]
        self.assertEqual(assess(self.contract, case), ("reject", "E_EFFECT_UNKNOWN"))

    def test_recursion_cost_remains_unproven(self):
        case = next(x for x in self.contract["cases"] if x["name"] == "hard_rt_unproven_recursion_reject")
        self.assertEqual(assess(self.contract, case), ("reject", "E_HARD_RT_UNBOUNDED"))

    def test_no_change_to_expected_acceptance(self):
        data = copy.deepcopy(self.contract)
        data["cases"][0]["expected"] = "reject"
        data["cases"][0]["diagnostic"] = "E_EFFECT_UNKNOWN"
        with self.assertRaises(InvalidContract):
            verify(data)

    def test_cannot_forge_backend_success(self):
        data = copy.deepcopy(self.contract)
        data["backends"]["llvm"] = "PASS"
        with self.assertRaises(InvalidContract):
            verify(data)

    def test_duplicate_case_rejected(self):
        data = copy.deepcopy(self.contract)
        data["cases"][1]["name"] = data["cases"][0]["name"]
        with self.assertRaises(InvalidContract):
            verify(data)

    def test_unknown_effect_label_rejected(self):
        data = copy.deepcopy(self.contract)
        data["operations"]["compute"] = ["not_an_effect"]
        with self.assertRaises(InvalidContract):
            verify(data)


if __name__ == "__main__":
    unittest.main()
