import copy
import json
import tempfile
import unittest
from pathlib import Path
from verify import CONTRACT, ROOT, evaluate, git_blob_sha, verify

class ContractTests(unittest.TestCase):
    def setUp(self):
        self.base = json.loads(CONTRACT.read_text())

    def test_candidates_have_no_fake_backend_passes(self):
        self.assertEqual(verify(self.base), 4)

    def test_nll_positive_requires_last_use_before_move(self):
        last = self.base["cases"][-1]
        self.assertEqual(evaluate(last["trace"]), "accept")
        altered = copy.deepcopy(last["trace"])
        altered.append({"op": "use", "loan": "view"})
        self.assertEqual(evaluate(altered), "move_while_borrowed")

    def test_unpinned_await_rejects_but_dead_loan_does_not(self):
        trace = self.base["cases"][2]["trace"]
        self.assertEqual(evaluate(trace), "borrow_across_suspension")
        self.assertEqual(evaluate([trace[0], trace[2], trace[1]]), "accept")

    def test_mutation_of_fixture_blob_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            for case in self.base["cases"]:
                p = dest / case["path"]
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes((ROOT / case["path"]).read_bytes())
            p = dest / self.base["cases"][0]["path"]
            p.write_bytes(p.read_bytes() + b"// mutation\n")
            with self.assertRaises(AssertionError):
                verify(self.base, dest)

    def test_generic_parse_failure_cannot_fake_target_diagnostic(self):
        self.base["cases"][0]["diagnostic"] = "parse_error"
        with self.assertRaises(AssertionError):
            verify(self.base)

if __name__ == "__main__":
    unittest.main()
