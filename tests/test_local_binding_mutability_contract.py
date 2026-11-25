import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts/local-binding-mutability-v1.json"

class BindingMutabilityContract(unittest.TestCase):
    def test_schema_four_quadrants_and_evidence(self):
        data = json.loads(CONTRACT.read_text())
        self.assertEqual(data["schema"], "atto.local-binding-mutability.v1")
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["semantics"]["rebinding"], {"val": False, "val mut": False, "let": True, "let mut": True})
        self.assertEqual(data["semantics"]["referent_write"], {"val": False, "val mut": True, "let": False, "let mut": True})
        self.assertEqual(set(data["backend_status"]), {"rs-browser", "java", "llvm", "net", "wasm-independent", "forge"})
        self.assertEqual(data["backend_status"]["rs-browser"], "FOCUSED_VERIFIED")
        self.assertTrue(all(value == "NOT_VERIFIED" for key, value in data["backend_status"].items() if key != "rs-browser"))

    def test_fixture_headers_and_unique_case_ids(self):
        data = json.loads(CONTRACT.read_text())
        cases = data["required_cases"]
        self.assertGreaterEqual(len(cases), 10)
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        self.assertEqual(len({case["path"] for case in cases}), len(cases))
        for case in cases:
            path = ROOT / case["path"]
            self.assertTrue(path.is_file(), case["path"])
            self.assertEqual(path.suffix, ".atto")
            source = path.read_text()
            self.assertIn("pub fnc main()", source)
            self.assertLess(len(source), 20_000)
            if case["kind"] == "pass":
                self.assertIn("// expect-exit: " + str(case["expected_exit"]), source)
                self.assertNotIn("expected_error", case)
            else:
                self.assertEqual(case["kind"], "fail")
                self.assertIn("// expect-error: " + case["expected_error"], source)
                self.assertNotIn("expected_exit", case)

if __name__ == "__main__":
    unittest.main()
