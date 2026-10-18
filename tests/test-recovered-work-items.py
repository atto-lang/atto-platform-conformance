#!/usr/bin/env python3
"""Source-free negative tests for the recovery snapshot schema."""
import importlib.util
import pathlib
import unittest

script = pathlib.Path(__file__).resolve().parents[1] / "scripts/validate-recovered-work-items.py"
spec = importlib.util.spec_from_file_location("recovery_checker", script)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def valid():
    repos = ["oreslang-source.java", "oreslang-source.llvm", "oreslang-format", "oreslang-source.wasm",
             "oreslang-data-science", "oreslang-serialization-and-validation", "oreslang-platform-conformance",
             "oreslang-source.net", "oreslang-source.forge", "oreslang-common-source"]
    return {"window_start": "2026-10-08", "window_end": "2026-10-18",
            "source_query": "org:ores-truffle-oreslang is:open updated:>=2026-10-08",
            "items": [{"id": i+1, "repo": "ores-truffle-oreslang/" + repos[i%10], "pr": i+1,
                       "url": "https://github.com/ores-truffle-oreslang/" + repos[i%10] + "/pull/" + str(i+1),
                       "title": "A substantive unfinished feature task", "priority": "P0" if i%2 else "P1",
                       "observed": "open; runtime/CI unverified", "next_action": "Run real compilation and regression tests"} for i in range(50)]}


class RecoveryCheckerTests(unittest.TestCase):
    def test_valid_snapshot(self):
        self.assertEqual(checker.validate(valid()), (50, 10))
    def test_missing_task_rejected(self):
        t=valid(); t["items"].pop()
        with self.assertRaises(ValueError): checker.validate(t)
    def test_duplicate_pr_rejected(self):
        t=valid(); t["items"][1]["url"] = t["items"][0]["url"]
        with self.assertRaises(ValueError): checker.validate(t)
    def test_unverified_claim_cannot_be_promoted_to_complete(self):
        t=valid(); t["items"][0]["observed"] = "completed"
        with self.assertRaises(ValueError): checker.validate(t)
    def test_identity_mismatch_rejected(self):
        t=valid(); t["items"][0]["pr"] = 17
        with self.assertRaises(ValueError): checker.validate(t)
    def test_untrusted_link_rejected(self):
        t=valid(); t["items"][0]["url"] = "https://evil.example/pull/1"
        with self.assertRaises(ValueError): checker.validate(t)
    def test_bad_window_rejected(self):
        t=valid(); t["window_start"] = "2026-01-01"
        with self.assertRaises(ValueError): checker.validate(t)
    def test_too_few_repos_rejected(self):
        t=valid(); template=t["items"][0]
        for i, item in enumerate(t["items"]):
            item["repo"] = template["repo"]
            item["url"] = "https://github.com/" + template["repo"] + "/pull/" + str(i+1)
        with self.assertRaises(ValueError): checker.validate(t)
    def test_missing_gate_rejected(self):
        t=valid(); t["items"][0]["next_action"]=""
        with self.assertRaises(ValueError): checker.validate(t)

if __name__ == "__main__": unittest.main(verbosity=2)
