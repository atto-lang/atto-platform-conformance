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



def rendered(snapshot):
    items = snapshot["items"]
    repos = len({item["repo"] for item in items})
    p0 = sum(item["priority"] == "P0" for item in items)
    heading = (f"**Snapshot:** {len(items)} distinct open PRs, {repos} repositories, "
               f"{p0} P0 and {len(items)-p0} P1.\n")
    rows = []
    for item in items:
        label = item["repo"].split("/", 1)[1] + " #" + str(item["pr"])
        rows.append(
            f'| {item["id"]} | {item["priority"]} | [{label}]({item["url"]})'
            f' — {item["title"]} | {item["next_action"]} |')
    return heading + "\n".join(rows) + "\n"


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


    def test_rendered_markdown_matches_canonical_ledger(self):
        snapshot = valid()
        self.assertEqual(checker.validate_markdown(snapshot, rendered(snapshot)), 50)

    def test_markdown_action_drift_rejected(self):
        snapshot = valid()
        original = rendered(snapshot)
        stale = original.replace("Run real compilation and regression tests",
                                 "Run old synthetic-only checks", 1)
        with self.assertRaises(ValueError):
            checker.validate_markdown(snapshot, stale)

    def test_markdown_priority_drift_rejected(self):
        snapshot = valid()
        stale = rendered(snapshot).replace("| 1 | P1 |", "| 1 | P0 |", 1)
        with self.assertRaises(ValueError):
            checker.validate_markdown(snapshot, stale)

    def test_markdown_url_drift_rejected(self):
        snapshot = valid()
        stale = rendered(snapshot).replace("/pull/1)", "/pull/2)", 1)
        with self.assertRaises(ValueError):
            checker.validate_markdown(snapshot, stale)

    def test_markdown_summary_drift_rejected(self):
        snapshot = valid()
        stale = rendered(snapshot).replace("25 P0 and 25 P1", "26 P0 and 24 P1")
        with self.assertRaises(ValueError):
            checker.validate_markdown(snapshot, stale)

    def test_markdown_missing_row_rejected(self):
        snapshot = valid()
        stale = "\n".join(rendered(snapshot).splitlines()[:-1]) + "\n"
        with self.assertRaises(ValueError):
            checker.validate_markdown(snapshot, stale)

if __name__ == "__main__": unittest.main(verbosity=2)
