"""Offline adversarial suite for source-free Actions artifact receipt integrity."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('receipt', Path(__file__).with_name('verify_source_free_receipt.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

HEAD = 'a' * 40
TREE = 'b' * 40
BLOBS = {'.github/workflows/ci-run-evidence-contract.yml': 'c' * 40,
         'scripts/verify_ci_run.py': 'd' * 40,
         'scripts/test_verify_ci_run.py': 'e' * 40}


def fixture():
    return {'carrier_head_sha': HEAD, 'carrier_tree_sha': TREE, 'expected_total': 231,
            'git_blobs': dict(BLOBS), 'guest_runtime_certified': False,
            'private_runtime_or_compiler_source_transferred': False,
            'repository': 'scintilla-run-test/gleam-runner-conformance',
            'rounds': 3, 'run_attempt': 1, 'run_id': 27,
            'schema': 'oreslang.source_free_ci_verifier_77.v1',
            'source_free_only': True, 'source_repository_native_ci_certified': False,
            'tests_per_round': 77}


class Receipts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'receipt.zip'
        self.report = fixture()

    def run_report(self, *, min_tests=77, min_rounds=3, file_name='77-parity.json',
                   payload=None, additional_member=False, pinned_sha=None, pinned_blobs=None):
        raw = json.dumps(self.report, ensure_ascii=True).encode() if payload is None else payload
        with zipfile.ZipFile(self.path, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr(file_name, raw)
            if additional_member:
                z.writestr('unreviewed.json', b'{}')
        data = self.path.read_bytes()
        return m.verify_zip(self.path,
             expected_zip_sha256=pinned_sha or hashlib.sha256(data).hexdigest(),
             expected_head_sha=HEAD, expected_tree_sha=TREE,
             expected_run_id=27, expected_attempt=1,
             expected_schema='oreslang.source_free_ci_verifier_77.v1',
             expected_blobs=pinned_blobs or BLOBS,
             min_tests_per_round=min_tests, min_rounds=min_rounds)

    def rejected(self, **kw):
        with self.assertRaises(m.ReceiptDenied):
            self.run_report(**kw)

    def test_valid_77_receipt_is_never_native_certification(self):
        data = self.run_report()
        self.assertEqual(data['tests_reported'], 231)
        self.assertIs(data['five_backend_parity_certified'], False)
        self.assertIs(data['actual_job_execution_independently_verified'], False)

    def test_newer_80_inventory_cannot_reuse_77_receipt(self):
        self.rejected(min_tests=80)

    def test_rounds_not_enough(self):
        self.rejected(min_rounds=4)

    def test_expected_total_forged(self):
        self.report['expected_total'] = 240
        self.rejected()

    def test_run_id_not_trusted_from_receipt(self):
        self.report['run_id'] = 28
        self.rejected()

    def test_bool_run_id_denied(self):
        self.report['run_id'] = True
        self.rejected()

    def test_wrong_attempt(self):
        self.report['run_attempt'] = 2
        self.rejected()

    def test_forged_head(self):
        self.report['carrier_head_sha'] = 'f'*40
        self.rejected()

    def test_forged_tree(self):
        self.report['carrier_tree_sha'] = 'f'*40
        self.rejected()

    def test_forged_workflow_blob(self):
        self.report['git_blobs']['.github/workflows/ci-run-evidence-contract.yml'] = 'f'*40
        self.rejected()

    def test_unexpected_blob_or_field(self):
        self.report['git_blobs']['evil'] = 'f'*40
        self.rejected()

    def test_fake_native_certification(self):
        self.report['guest_runtime_certified'] = True
        self.rejected()

    def test_fake_native_source_execution(self):
        self.report['source_repository_native_ci_certified'] = True
        self.rejected()

    def test_false_source_transfer_flag(self):
        self.report['private_runtime_or_compiler_source_transferred'] = True
        self.rejected()

    def test_forged_sourcefree_only(self):
        self.report['source_free_only'] = False
        self.rejected()

    def test_forged_repository(self):
        self.report['repository'] = 'attacker/runner'
        self.rejected()

    def test_unexpected_member(self):
        self.rejected(file_name='../exfil.json')

    def test_extra_archive_member(self):
        self.rejected(additional_member=True)

    def test_duplicate_json_keys(self):
        raw = json.dumps(self.report).encode()
        raw = raw[:-1] + b', "run_id":27}'
        self.rejected(payload=raw)

    def test_nan_json(self):
        raw = json.dumps(self.report).encode()
        raw = raw[:-1] + b', "other":NaN}'
        self.rejected(payload=raw)

    def test_overflowing_json_exponent(self):
        self.rejected(payload=b'{"run_id":1e999}')

    def test_invalid_utf8(self):
        self.rejected(payload=b'{"x":"\xff"}')

    def test_zip_digest_mismatch(self):
        self.rejected(pinned_sha='f'*64)

    def test_hardlink_denied(self):
        alias=Path(self.temp.name)/'extra.zip'
        self.run_report()
        import os
        os.link(self.path,alias)
        with self.assertRaises(m.ReceiptDenied):
            self.run_report()

    def test_wrong_trusted_blob_set_denied(self):
        self.rejected(pinned_blobs={'scripts/verify_ci_run.py': 'd'*40})

    def test_floating_run_id_denied(self):
        self.report['run_id'] = 27.0
        self.rejected()

    def test_additional_unreviewed_report_field_denied(self):
        self.report['native_passed'] = True
        self.rejected()

    def test_truncated_zip_denied(self):
        self.run_report()
        raw=self.path.read_bytes()
        self.path.write_bytes(raw[:25])
        with self.assertRaises(m.ReceiptDenied):
            m.verify_zip(self.path, expected_zip_sha256=hashlib.sha256(raw[:25]).hexdigest(),
                 expected_head_sha=HEAD, expected_tree_sha=TREE,
                 expected_run_id=27, expected_attempt=1,
                 expected_schema='oreslang.source_free_ci_verifier_77.v1',
                 expected_blobs=BLOBS, min_tests_per_round=77,min_rounds=3)

if __name__ == '__main__':
    unittest.main(verbosity=2)