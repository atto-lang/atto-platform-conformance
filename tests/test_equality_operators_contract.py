"""Portable equality contract registry integrity — host model, NOT guest execution."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts/equality-operators-v1.json"

class EqualityContract(unittest.TestCase):
    def test_schema_semantics_and_scope(self):
        doc = json.loads(CONTRACT.read_text())
        self.assertEqual(doc["schema"], "atto.equality-operators.v1")
        self.assertEqual(doc["version"], 1)
        self.assertEqual(doc["semantics"]["value_operators"], ["eq", "neq"])
        self.assertEqual(doc["semantics"]["identity_operators"], ["==", "!="])
        self.assertEqual(doc["semantics"]["primitive_identity"], "COMPILE_TIME_ERROR")
        self.assertEqual(set(doc["backend_status"]), {"rs-browser", "java", "llvm", "net", "wasm-independent", "forge", "cranelift", "js", "hdl"})
        self.assertTrue(all(status != "VERIFIED" for status in doc["backend_status"].values()))

    def test_fixtures_exist_and_have_expected_headers(self):
        doc = json.loads(CONTRACT.read_text())
        cases = doc["required_cases"]
        self.assertGreaterEqual(len(cases), 10)
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        self.assertEqual(len({case["path"] for case in cases}), len(cases))
        for case in cases:
            path = ROOT / case["path"]
            self.assertTrue(path.is_file(), case["path"])
            source = path.read_text()
            self.assertIn("pub fnc main(): int", source)
            self.assertLess(len(source), 20_000)
            if case["kind"] == "pass":
                self.assertIn("// expect-exit: " + str(case["expected_exit"]), source)
                self.assertNotIn("expected_error", case)
            else:
                self.assertEqual(case["kind"], "fail")
                self.assertIn("// expect-error: " + case["expected_error"], source)
                self.assertNotIn("expected_exit", case)

    def test_value_vs_identity_stay_distinct(self):
        doc = json.loads(CONTRACT.read_text())
        cases = {c["id"]: c for c in doc["required_cases"]}
        self.assertIn(" eq ", (ROOT / cases["int_value_equal"]["path"]).read_text())
        self.assertIn(" neq ", (ROOT / cases["int_value_unequal"]["path"]).read_text())
        self.assertIn(" == ", (ROOT / cases["class_identity"]["path"]).read_text())
        self.assertIn(" != ", (ROOT / cases["class_identity"]["path"]).read_text())
        for name in ["primitive_identity_equal", "primitive_identity_unequal", "bool_identity_equal"]:
            self.assertEqual(cases[name]["expected_error"], "E_IDENTITY_TYPE")

if __name__ == "__main__":
    unittest.main()
