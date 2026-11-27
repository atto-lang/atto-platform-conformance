import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("pool_reuse_receipt", Path(__file__).resolve().parents[1] / "bin/pool_reuse_receipt.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
BACKENDS, MIN_CYCLES, validate_reuse = gate.BACKENDS, gate.MIN_CYCLES, gate.validate_reuse


def sample():
    return dict(schema='atto.fixed-buffer-pool.reuse-receipt.v2', backend='llvm', status='passed',
                acquire_release_probe_available=True, preallocated=True, scrub_before_reissue=True,
                all_slots_reused=True, exhaustion_no_growth=True, same_backing_region_on_reacquire=True,
                dynamic_allocations_during_reuse=0, backing_allocations_during_reuse=0,
                outstanding_leases_after_reuse=0, completed_acquire_release_cycles=MIN_CYCLES,
                preallocated_slots=64, retained_backing_bytes_before_reuse=65536,
                retained_backing_bytes_after_reuse=65536)


class ReuseReceiptTests(unittest.TestCase):
    def test_all_backends(self):
        for backend in BACKENDS:
            self.assertEqual(validate_reuse(dict(sample(), backend=backend)), 'STRUCTURAL_REUSE_EVIDENCE_ONLY')

    def test_every_field_required(self):
        for key in sample():
            with self.subTest(key=key), self.assertRaises(ValueError):
                receipt = sample()
                del receipt[key]
                validate_reuse(receipt)

    def test_mutations(self):
        for key, values in dict(status=['not_executed', 'failed'], backend=['unknown', []],
            schema=['atto.fixed-buffer-pool.guest-receipt.v1'], acquire_release_probe_available=[False, 1],
            preallocated=[False], scrub_before_reissue=[False], all_slots_reused=[False],
            exhaustion_no_growth=[False], same_backing_region_on_reacquire=[False],
            dynamic_allocations_during_reuse=[1, -1, False, 0.0], backing_allocations_during_reuse=[1, False],
            outstanding_leases_after_reuse=[1, False], completed_acquire_release_cycles=[MIN_CYCLES-1, True],
            preallocated_slots=[0, -1, True, MIN_CYCLES+1], retained_backing_bytes_before_reuse=[0, True],
            retained_backing_bytes_after_reuse=[0, 65537, 65535, 65536.0]).items():
            for value in values:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    validate_reuse(dict(sample(), **{key: value}))

    def test_transfer_only_rejected(self):
        with self.assertRaises(ValueError):
            validate_reuse(dict(backend='llvm', status='passed', measured_transfers=100000,
                                dynamic_allocations_during_window=0, same_backing_region_after_move=True))


if __name__ == '__main__':
    unittest.main()
