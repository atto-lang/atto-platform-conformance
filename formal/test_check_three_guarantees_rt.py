"""Adversarial parser tests: a green solver process is not itself a sound proof."""
import unittest
from check_three_guarantees_rt import validate_output

WITNESS = """unsat
sat
(
 (define-fun wcet () Int 0)
 (define-fun jitter () Int 0)
 (define-fun interference () Int 0)
 (define-fun blocking () Int 0)
 (define-fun cleanup () Int 1)
 (define-fun activation () Int 0)
 (define-fun deadline () Int 0)
 (define-fun allKnown () Bool true)
 (define-fun certMatches () Bool true)
)
"""


class SolverReceiptTests(unittest.TestCase):
    def test_complete_nonvacuous_solver_counterexample(self):
        witness = validate_output(WITNESS)
        self.assertEqual(witness['cleanup'], 1)
        self.assertEqual(witness['deadline'], 0)

    def test_solver_unknown_is_never_proved(self):
        with self.assertRaisesRegex(ValueError, 'exact unsat/sat'):
            validate_output(WITNESS.replace('unsat', 'unknown', 1))

    def test_solver_missing_query_is_never_proved(self):
        with self.assertRaisesRegex(ValueError, 'exact unsat/sat'):
            validate_output(WITNESS.replace('unsat\n', '', 1))

    def test_solver_extra_query_is_not_ignored(self):
        with self.assertRaisesRegex(ValueError, 'exact unsat/sat'):
            validate_output(WITNESS.replace('sat\n', 'sat\nsat\n', 1))

    def test_solver_error_is_not_ignored(self):
        with self.assertRaisesRegex(ValueError, 'reported an error'):
            validate_output(WITNESS + 'error: unknown command')

    def test_missing_model_field_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'missing/invalid'):
            validate_output(WITNESS.replace('(define-fun cleanup () Int 1)', ''))

    def test_spurious_sat_without_real_cleanup_witness_rejected(self):
        with self.assertRaisesRegex(ValueError, 'does not demonstrate cleanup'):
            validate_output(WITNESS.replace('(define-fun cleanup () Int 1)', '(define-fun cleanup () Int 0)'))

    def test_permission_or_certificate_not_proven_rejected(self):
        with self.assertRaisesRegex(ValueError, 'admission premises'):
            validate_output(WITNESS.replace('(define-fun certMatches () Bool true)', '(define-fun certMatches () Bool false)'))

    def test_negative_cost_rejected(self):
        with self.assertRaisesRegex(ValueError, 'nonnegativity'):
            validate_output(WITNESS.replace('(define-fun wcet () Int 0)', '(define-fun wcet () Int -1)'))


if __name__ == '__main__':
    unittest.main()
