"""Host-only value-class registry audit; NOT compiler, Wasm, or AOT proof."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "contracts" / "value-classes-v1.json"

class ValueClassContractAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(REGISTRY.read_text(encoding="utf-8"))

    def test_frozen_schema_and_explicit_unexecuted_status(self):
        self.assertEqual(self.data["schema"], "atto.value-classes.v1")
        self.assertEqual(self.data["version"], 1)
        self.assertEqual(self.data["status"], "PROPOSED_NOT_EXECUTED")
        self.assertIn("No row is passed without", self.data["evidence_rule"])

    def test_all_fixtures_present_and_unique(self):
        cases = self.data["required_cases"]
        self.assertEqual(len(cases), 19)
        self.assertEqual(len({c["id"] for c in cases}), len(cases))
        self.assertEqual(sum(c["kind"] == "pass" for c in cases), 5)
        self.assertEqual(sum(c["kind"] == "fail" for c in cases), 14)
        for case in cases:
            with self.subTest(case=case["id"]):
                path = (ROOT / case["path"]).resolve()
                self.assertTrue(path.is_relative_to(ROOT))
                self.assertTrue(path.is_file(), case["path"])
                source = path.read_text(encoding="utf-8")
                self.assertTrue(source.endswith("\n"), case["path"])
                self.assertIn("define value class ", source)
                self.assertIn("pub fnc main(): int", source)
                self.assertGreater(len(source), 80)
                if case["kind"] == "pass":
                    self.assertEqual(case["expected_exit"], 42)
                    self.assertNotIn("expected_error", case)
                else:
                    self.assertIn("expected_error", case)
                    self.assertTrue(case["expected_error"].startswith("E_"))
                    self.assertNotIn("expected_exit", case)

    def test_every_backend_remains_not_executed_until_verified(self):
        expected = {
            "rs-browser", "java", "llvm", "net", "wasm-independent", "forge"
        }
        for case in self.data["required_cases"]:
            with self.subTest(case=case["id"]):
                self.assertEqual(set(case["backend_status"]), expected)
                self.assertEqual(set(case["backend_status"].values()), {"NOT_EXECUTED"})

    def test_both_equality_spellings_and_copy_are_covered(self):
        corpus = "\n".join(
            (ROOT / c["path"]).read_text(encoding="utf-8")
            for c in self.data["required_cases"] if c["kind"] == "pass"
        )
        self.assertIn("a eq b", corpus)
        self.assertIn("a neq b", corpus)
        self.assertIn("b eq a", corpus)
        self.assertNotIn("a == b", corpus)
        self.assertNotIn("a != b", corpus)
        for name, spelling in [("identity-operator", "a == b"), ("identity-inequality", "a != b")]:
            case = next(c for c in self.data["required_cases"] if c["id"] == name)
            self.assertEqual(case["expected_error"], "E_VALUE_IDENTITY")
            self.assertIn(spelling, (ROOT / case["path"]).read_text(encoding="utf-8"))
        self.assertIn("copy! a", corpus)
        self.assertIn("let Point a", corpus)
        self.assertIn("pub final Point", corpus)

    def test_negative_safety_categories(self):
        codes = {c["expected_error"] for c in self.data["required_cases"]
                 if c["kind"] == "fail"}
        self.assertTrue({
            "E_VALUE_MUTABLE", "E_VALUE_IDENTITY", "E_VALUE_FIELD",
            "E_VALUE_CONSTRUCTOR", "E_TYPE"
        }.issubset(codes))

if __name__ == "__main__":
    unittest.main()
