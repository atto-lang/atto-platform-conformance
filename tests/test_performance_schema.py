#!/usr/bin/env python3
"""Independent Draft 2020-12 JSON Schema admission test.

Requires jsonschema==4.26.0. Exercises the actual checked-in JSON Schema,
NOT a hand-rolled approximation. These source-free fixtures do not verify
execution, compiler provenance, benchmark accuracy or artifact authenticity.
"""
import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schemas" / "performance-evidence.schema.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
Draft202012Validator.check_schema(SCHEMA)
VALIDATOR = Draft202012Validator(SCHEMA)
STAGES = ("correctness", "benchmark", "place-route", "board", "simulation", "synthesis", "power-model")


def report(*, family="software", status="MEASURED", kind="latency", unit="ns", stages=("correctness", "benchmark")):
    return {
        "schemaVersion": 1,
        "status": status,
        "family": family,
        "backend": {"software": "llvm", "fpga": "fpga", "asic": "asic"}[family],
        "mode": "source-free-test-fixture",
        "sourceSha": "a" * 40,
        "compilerSha256": "b" * 64,
        "fixtureSha256": "c" * 64,
        "toolchain": {"name": "model", "version": "fixture-1"},
        "environment": {"target": "synthetic", "cpu": "synthetic", "clockPolicy": "synthetic"},
        "kind": kind,
        "unit": unit,
        "samples": [1, 2, 3, 4, 5],
        "correctness": "PASS",
        "evidence": [
            {"stage": stage, "sha256": "d" * 64, "locator": f"artifacts/{stage}.json"}
            for stage in stages
        ],
    }


def accepted(item):
    return not list(VALIDATOR.iter_errors(item))


class PerformanceSchemaTests(unittest.TestCase):
    def test_draft_2020_12_is_well_formed(self):
        self.assertEqual(SCHEMA["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertFalse(SCHEMA["additionalProperties"])

    def test_software_measured_cannot_substitute_compile_for_benchmark(self):
        self.assertTrue(accepted(report()))
        self.assertFalse(accepted(report(stages=("correctness", "compile"))))
        self.assertFalse(accepted(report(stages=("benchmark", "compile"))))

    def test_fpga_measured_requires_each_distinct_stage(self):
        stages = ("correctness", "benchmark", "place-route", "board")
        complete = report(family="fpga", kind="fmax", unit="MHz", stages=stages)
        self.assertTrue(accepted(complete))
        for missing in stages:
            with self.subTest(missing=missing):
                case = report(family="fpga", kind="fmax", unit="MHz",
                              stages=tuple(s for s in stages if s != missing))
                self.assertFalse(accepted(case))

    def test_synthesis_and_simulation_claims_require_matching_evidence(self):
        for status, needed in (("SYNTH_ONLY", "synthesis"),
                               ("SIMULATED_ONLY", "simulation")):
            with self.subTest(status=status):
                good = report(family="fpga", status=status, kind="ii", unit="cycles",
                              stages=("correctness", needed))
                self.assertTrue(accepted(good))
                self.assertFalse(accepted(report(
                    family="fpga", status=status, kind="ii", unit="cycles",
                    stages=("correctness", "benchmark"))))

    def test_placed_fpga_requires_place_route_and_correctness(self):
        good = report(family="fpga", status="PLACE_ROUTE_VERIFIED", kind="fmax",
                      unit="MHz", stages=("correctness", "place-route"))
        self.assertTrue(accepted(good))
        for bad in (("correctness", "benchmark"), ("place-route", "benchmark")):
            self.assertFalse(accepted(report(family="fpga",
                status="PLACE_ROUTE_VERIFIED", kind="fmax", unit="MHz", stages=bad)))

    def test_asic_power_model_is_mandatory_but_silicon_measurement_rejected(self):
        stages = ("correctness", "synthesis", "power-model")
        good = report(family="asic", status="SYNTH_ONLY", kind="power", unit="mW", stages=stages)
        self.assertTrue(accepted(good))
        self.assertFalse(accepted(report(family="asic", status="SYNTH_ONLY",
                                         kind="power", unit="mW", stages=stages[:-1])))
        self.assertFalse(accepted(report(family="asic", status="MEASURED",
                                         kind="power", unit="mW", stages=stages)))

    def test_required_stages_exhaustive_128_subsets_each_family_and_status(self):
        # Oracle is independent of JSON Schema implementation. Unknown/false
        # stage combinations may be structurally invalid; never permit a
        # missing required stage merely because enough references exist.
        cases = [
            ("software", "MEASURED", "latency", "ns", {"correctness", "benchmark"}),
            ("fpga", "MEASURED", "fmax", "MHz",
             {"correctness", "benchmark", "place-route", "board"}),
            ("fpga", "SYNTH_ONLY", "lut", "count", {"correctness", "synthesis"}),
            ("fpga", "SIMULATED_ONLY", "ii", "cycles", {"correctness", "simulation"}),
            ("fpga", "PLACE_ROUTE_VERIFIED", "fmax", "MHz", {"correctness", "place-route"}),
            ("asic", "SYNTH_ONLY", "power", "mW",
             {"correctness", "synthesis", "power-model"}),
            ("asic", "SIMULATED_ONLY", "area", "um2", {"correctness", "simulation"}),
        ]
        n = 0
        for family, status, kind, unit, required in cases:
            for mask in range(1 << len(STAGES)):
                chosen = tuple(stage for i, stage in enumerate(STAGES) if (mask >> i) & 1)
                case = report(family=family, status=status, kind=kind, unit=unit, stages=chosen)
                expected = required.issubset(chosen)
                if len(chosen) < 2: expected = False
                with self.subTest(family=family, status=status, mask=mask):
                    self.assertEqual(accepted(case), expected)
                n += 1
        self.assertEqual(n, 896)


if __name__ == "__main__":
    unittest.main()
