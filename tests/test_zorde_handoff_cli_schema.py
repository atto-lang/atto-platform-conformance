#!/usr/bin/env python3
"""Adversarial, source-free tests for the non-promoting Zorde handoff CLI."""
import copy
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "bin/check-zorde-handoff.py"
PENDING = ROOT / "evidence/zorde-contract-handoff.pending.json"
BASE = json.loads(PENDING.read_text(encoding="utf-8"))
SPEC = importlib.util.spec_from_file_location("zorde_handoff_checker", CLI)
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class HandoffCLIAdversarialTests(unittest.TestCase):
    def test_pinned_pending_receipt_is_shape_only(self):
        finished = subprocess.run(
            [sys.executable, str(CLI), str(PENDING)],
            capture_output=True, text=True, timeout=10, check=False,
        )
        self.assertEqual(finished.returncode, 0, finished.stderr)
        self.assertEqual(finished.stdout.strip(),
                         "ZORDE_HANDOFF_SHAPE_ONLY_UNAUTHENTICATED")

    def test_invalid_receipts_are_refused(self):
        mutators = [
            lambda x: x.update(disposition="VERIFIED"),
            lambda x: x.update(privateSourceExportAuthorized=True),
            lambda x: x["source"].update(commitSha="0" * 40),
            lambda x: x["source"].update(treeSha="f" * 39),
            lambda x: x["source"].update(repository="unapproved/carrier"),
            lambda x: x["checks"]["nativeGuest"].update(status="PASS"),
            lambda x: x["checks"]["nativeGuest"].update(status="EXECUTED_UNATTESTED"),
            lambda x: x["checks"]["nativeGuest"].update(executedSteps=1),
            lambda x: x["checks"]["nativeGuest"].update(executedTests=1),
            lambda x: x["checks"]["nativeGuest"].update(evidenceSha256="f" * 64),
            lambda x: x["checks"].pop("dualAuthority"),
            lambda x: x["authorities"].pop("wit"),
            lambda x: x["authorities"]["typeSpec"].update(path="../private.tsp"),
            lambda x: x["authorities"]["wit"].update(gitBlobSha="0" * 40),
            lambda x: x.update(extra=True),
            lambda x: x["checks"]["nativeGuest"].update(executedSteps=True),
        ]
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "candidate.json"
            for index, mutate in enumerate(mutators):
                specimen = copy.deepcopy(BASE)
                mutate(specimen)
                path.write_text(json.dumps(specimen), encoding="utf-8")
                with self.subTest(mutation=index):
                    with self.assertRaises((ValueError, OSError, UnicodeError)):
                        CHECKER.check(path)

    def test_untrusted_json_and_filesystem_tricks_are_refused(self):
        # Duplicate key in an otherwise valid top-level evidence record must
        # not silently replace the previously admitted value.
        duplicate = json.dumps(BASE)[:-1] + ',"schemaVersion":1}'
        specimens = (
            b"",
            duplicate.encode("utf-8"),
            b'{"a":NaN}', b'{"a":Infinity}', b'{"a":-Infinity}',
            b'{"a":1}' + b" " * 70000,
            b"\\xff",
        )
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "candidate.json"
            for index, raw in enumerate(specimens):
                path.write_bytes(raw)
                with self.subTest(malformed=index):
                    with self.assertRaises((ValueError, OSError, UnicodeError)):
                        CHECKER.check(path)
            path.write_text(json.dumps(BASE), encoding="utf-8")
            link = Path(temp) / "link.json"
            link.symlink_to(path)
            with self.assertRaises((ValueError, OSError)):
                CHECKER.check(link)
            alias = Path(temp) / "alias.json"
            os.link(path, alias)
            with self.assertRaises((ValueError, OSError)):
                CHECKER.check(alias)

    def test_unsupported_invocation_has_no_success_output(self):
        finished = subprocess.run(
            [sys.executable, str(CLI)],
            capture_output=True, text=True, timeout=10, check=False,
        )
        self.assertEqual(finished.returncode, 2)
        self.assertEqual(finished.stdout, "")


if __name__ == "__main__":
    unittest.main()
