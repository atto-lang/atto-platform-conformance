"""Harness/manifest unit tests only; NEVER guest execution evidence."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "scripts"))
from run_lambda_v1 import assert_artifact_format, render_command, validate_manifest  # noqa: E402

MANIFEST = HERE / "fixtures/lambda-v1/manifest.json"


class LambdaManifestTests(unittest.TestCase):
    def test_manifest_integrity(self):
        data = validate_manifest(MANIFEST)
        self.assertEqual(10, len(data["cases"]))
        self.assertEqual({"accept", "reject"}, {c["expect"] for c in data["cases"]})

    def test_modified_fixture_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp)
            for source in MANIFEST.parent.iterdir():
                shutil.copy(source, dest / source.name)
            changed = dest / "typed_single.atto"
            changed.write_text(changed.read_text() + "// mutated\n")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                validate_manifest(dest / "manifest.json")

    def test_duplicate_id_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp)
            for source in MANIFEST.parent.iterdir():
                shutil.copy(source, dest / source.name)
            data = json.loads((dest / "manifest.json").read_text())
            data["cases"][1]["id"] = data["cases"][0]["id"]
            (dest / "manifest.json").write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "duplicate"):
                validate_manifest(dest / "manifest.json")

    def test_non_native_artifact_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "out"
            file.write_text("#!/usr/bin/env python3\nprint('not AOT')\n")
            with self.assertRaisesRegex(ValueError, "host fallback"):
                assert_artifact_format(file, "elf")
            with self.assertRaisesRegex(ValueError, "host fallback"):
                assert_artifact_format(file, "wasm")

    def test_placeholder_safety(self):
        self.assertEqual(["compiler", "--out", "/tmp/a b", "/tmp/in.atto"],
                         render_command("compiler --out {artifact} {source}", "/tmp/in.atto", "/tmp/a b"))
        with self.assertRaises(ValueError):
            render_command("compiler --bad {unknown} {source}", "a", "b")

    def test_missing_compiler_is_not_skipped(self):
        run = subprocess.run([sys.executable, str(HERE / "scripts/run_lambda_v1.py"),
                             "--manifest", str(MANIFEST)], capture_output=True, text=True)
        self.assertEqual(2, run.returncode)
        self.assertIn("FAIL CLOSED", run.stderr)


if __name__ == "__main__":
    unittest.main()
