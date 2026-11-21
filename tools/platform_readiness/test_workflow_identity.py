"""Source-free, adversarial checks for the migrated Atto workflow admission guard.

These tests execute only the embedded Python policy from the checked-in YAML.
They do not authorize PR review, source transfer, a CI runner, or guest evidence.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXPECTED_REPO = "atto-lang/atto-platform-conformance"
EXPECTED_ID = 1448719136
WORKFLOW = ROOT / ".github/workflows/platform-readiness-source-free.yml"
CANARY = ROOT / ".github/workflows/source-local-runner-allocation-canary.yml"


class WorkflowRepositoryIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        text = WORKFLOW.read_text(encoding="utf-8")
        start = "          python3 - <<'PY'\n"
        end = "\n          PY"
        if text.count(start) != 1 or text.count(end) != 1:
            raise AssertionError("Expected one embedded identity gate")
        cls.script = textwrap.dedent(text.split(start, 1)[1].split(end, 1)[0])
        cls.workflow_text = text

    def payload(self, repo=EXPECTED_REPO, repo_id=EXPECTED_ID,
                head_repo=EXPECTED_REPO, head_id=EXPECTED_ID):
        return {
            "repository": {"full_name": repo, "id": repo_id},
            "pull_request": {"head": {"repo": {
                "full_name": head_repo, "id": head_id,
            }}},
        }

    def run_guard(self, payload, event="pull_request", repository=EXPECTED_REPO):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "event.json"
            p.write_text(json.dumps(payload), encoding="utf-8")
            env = dict(os.environ, GH_EVENT_PATH=str(p),
                       GH_EVENT_NAME=event, GH_REPOSITORY=repository)
            return subprocess.run([sys.executable, "-c", self.script],
                                  env=env, capture_output=True, text=True,
                                  timeout=10, check=False)

    def test_same_repository_pr_admitted_only_as_source_free(self):
        result = self.run_guard(self.payload())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SOURCE_OWNER_ONLY=true", result.stdout)

    def test_same_repository_manual_dispatch_admitted(self):
        result = self.run_guard(self.payload(), event="workflow_dispatch")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_old_organization_denied(self):
        legacy = "ores-truffle-oreslang/oreslang-platform-conformance"
        self.assertNotEqual(self.run_guard(self.payload(
            repo=legacy), repository=legacy).returncode, 0)

    def test_wrong_immutable_base_id_denied(self):
        for wrong in (1413795502, True, None, "1448719136"):
            with self.subTest(wrong=wrong):
                self.assertNotEqual(self.run_guard(
                    self.payload(repo_id=wrong)).returncode, 0)

    def test_foreign_pr_head_denied(self):
        self.assertNotEqual(self.run_guard(self.payload(
            head_repo="attacker/other-repository")).returncode, 0)

    def test_wrong_head_id_denied(self):
        self.assertNotEqual(self.run_guard(self.payload(
            head_id=1413795502)).returncode, 0)

    def test_wrong_environment_repository_denied(self):
        self.assertNotEqual(self.run_guard(self.payload(),
            repository="attacker/other-repository").returncode, 0)

    def test_unrecognized_event_denied(self):
        self.assertNotEqual(self.run_guard(self.payload(), event="push").returncode, 0)

    def test_missing_event_repository_denied(self):
        self.assertNotEqual(self.run_guard({}).returncode, 0)

    def test_precheckout_admission_and_identity_are_pinned(self):
        self.assertLess(self.workflow_text.index("Reject foreign or unrecognized"),
                        self.workflow_text.index("actions/checkout@"))
        self.assertIn(EXPECTED_REPO, self.workflow_text)
        self.assertIn(str(EXPECTED_ID), self.workflow_text)
        self.assertNotIn("ores-truffle-oreslang/oreslang-platform-conformance",
                         self.workflow_text)
        self.assertNotIn("1413795502", self.workflow_text)

    def test_source_local_canary_still_has_no_checkout_or_permissions(self):
        text = CANARY.read_text(encoding="utf-8")
        self.assertIn("permissions: {}", text)
        self.assertIn("test \"${GITHUB_REPOSITORY}\" = '" + EXPECTED_REPO + "'", text)
        self.assertIn('test -n "${RUNNER_NAME:-}"', text)
        self.assertNotIn("actions/checkout@", text)
        self.assertNotIn("ores-truffle-oreslang/oreslang-platform-conformance", text)


if __name__ == "__main__":
    unittest.main()
