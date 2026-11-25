import hashlib
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts/local-const-evaluation-v1.json"

class LocalConstEvaluationContract(unittest.TestCase):
    def test_schema_and_fixtures(self):
        data = json.loads(CONTRACT.read_text())
        self.assertEqual(data["schema"], "atto.local-const-evaluation.v1")
        self.assertEqual(data["version"], 1)
        self.assertEqual(len(data["required_cases"]), 9)
        self.assertEqual(set(data["backend_status"]), {"rs-browser", "java", "llvm", "net", "wasm-independent", "forge"})
        self.assertEqual(len({x["id"] for x in data["required_cases"]}), 9)
        for case in data["required_cases"]:
            p = ROOT / case["path"]
            self.assertTrue(p.is_file(), p)
            payload = p.read_bytes()
            sha = hashlib.sha1(f"blob {len(payload)}\0".encode() + payload).hexdigest()
            self.assertEqual(sha, case["source_blob_sha"], p)
            self.assertEqual(p.suffix, ".atto")
            if case["kind"] == "pass":
                self.assertIn(f"// expect-exit: {case['expected_exit']}".encode(), payload)
            else:
                self.assertEqual(case["kind"], "fail")
                self.assertIn(f"// expect-error: {case['expected_error']}".encode(), payload)
        for backend in ("java", "llvm", "net", "wasm-independent", "forge"):
            self.assertEqual(data["backend_status"][backend], "NOT_VERIFIED")

if __name__ == "__main__":
    unittest.main()
