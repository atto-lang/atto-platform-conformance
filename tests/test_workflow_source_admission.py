"""Static source-local regression for checkout authorization across conformance CI.

This verifies declared workflow shape, not runner allocation, source-byte proof,
or GitHub branch protections. Runtime verifier tests exercise actual git trees.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = ROOT / ".github" / "workflows"
CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"
GUARD = "python3 scripts/verify_raw_checkout.py"
EXPECTED = "${{ github.event.pull_request.head.sha || github.sha }}"


def checked_out_workflows():
    paths = sorted(WORKFLOW_DIR.glob("*.yml"))
    assert paths, "no workflows found"
    result = [(path, path.read_text(encoding="utf-8")) for path in paths]
    assert any(CHECKOUT in source for _, source in result), "missing source workflows"
    return result


class WorkflowSourceAdmissionTests(unittest.TestCase):
    def test_all_checked_out_workflows_require_raw_checkout_verification(self):
        verified = 0
        for path, source in checked_out_workflows():
            if "actions/checkout@" not in source:
                continue  # e.g. source-free runner admission canary
            with self.subTest(workflow=path.name):
                self.assertIn(CHECKOUT, source, "checkout action must stay SHA-pinned")
                self.assertIn("persist-credentials: false", source)
                self.assertIn(EXPECTED, source, "must bind to the PR's exact head")
                self.assertIn("EXPECTED_SHA:", source, "verifier needs exact expected commit")
                self.assertIn(GUARD, source)
                self.assertLess(source.index("actions/checkout@"), source.index(GUARD))
                verified += 1
        self.assertGreaterEqual(verified, 12)

    def test_no_git_attribute_filter_executing_worktree_probes(self):
        for path, source in checked_out_workflows():
            with self.subTest(workflow=path.name):
                self.assertNotRegex(
                    source,
                    r"(?m)^\s*(?:test\s+-z\s+.*)?git\s+(?:status|diff|hash-object)\b",
                    "worktree validation must not invoke checkout-owned Git filters",
                )
                self.assertNotIn("$(git status", source)
                self.assertNotIn("$(git diff", source)

    def test_canary_remains_without_checkout_or_private_source_access(self):
        path = WORKFLOW_DIR / "source-local-runner-allocation-canary.yml"
        source = path.read_text(encoding="utf-8")
        self.assertNotIn("actions/checkout@", source)
        self.assertNotIn(GUARD, source)
        self.assertIn("permissions: {}", source)


if __name__ == "__main__":
    unittest.main()
