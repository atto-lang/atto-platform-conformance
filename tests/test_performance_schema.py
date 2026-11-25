#!/usr/bin/env python3
"""Independent Draft 2020-12 JSON Schema admission test.

Requires jsonschema==4.26.0. Exercises the actual checked-in JSON Schema,
NOT a hand-rolled approximation. These source-free fixtures do not verify
execution, compiler provenance, benchmark accuracy or artifact authenticity.
"""
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


def copy_report(item):
    return json.loads(json.dumps(item))


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

    def test_measured_identity_and_environment_are_nonzero_and_configured(self):
        source=report()
        self.assertTrue(accepted(source))
        for field, value in (("sourceSha", "0" * 40),
                             ("compilerSha256", "0" * 64),
                             ("fixtureSha256", "0" * 64)):
            case=copy_report(source)
            case[field]=value
            with self.subTest(field=field):
                self.assertFalse(accepted(case))
        for path in (("toolchain", "version", "unconfigured"),
                     ("environment", "target", "unknown"),
                     ("environment", "cpu", "unknown"),
                     ("environment", "clockPolicy", "unknown")):
            case=copy_report(source)
            case[path[0]][path[1]]=path[2]
            with self.subTest(path=path):
                self.assertFalse(accepted(case))

    def test_zero_evidence_digest_and_metric_range_are_denied(self):
        case=report()
        case["evidence"][0]["sha256"]="0" * 64
        self.assertFalse(accepted(case))
        for field, unit, invalid in (
            ("latency", "ns", -1.0),
            ("throughput", "ops/s", -0.5),
            ("ii", "cycles", 0),
            ("ii", "cycles", 1.5),
            ("ii", "cycles", 2**53),
            ("lut", "count", -1),
            ("lut", "count", 1.5),
            ("dsp", "count", 2**53),
            ("fmax", "MHz", -0.01),
        ):
            case=report(family="fpga" if field in ("ii","lut","dsp","fmax") else "software",
                        kind=field, unit=unit)
            case["samples"][0]=invalid
            with self.subTest(metric=field, sample=invalid):
                self.assertFalse(accepted(case))
        allowed=report(family="asic", status="SYNTH_ONLY", kind="slack", unit="ns",
                       stages=("correctness","synthesis"))
        allowed["samples"][0]=-2.5
        self.assertTrue(accepted(allowed))

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
            ("asic", "SIMULATED_ONLY", "power", "mW",
             {"correctness", "simulation", "power-model"}),
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
        self.assertEqual(n, 1024)

    def test_live_node_validator_matches_independent_jsonschema(self):
        # Exercise the executable JS validator, not just a duplicated Python
        # interpretation of the status/stage rules. One source-free Node
        # subprocess receives all fixtures, including negative attacks.
        import subprocess
        scenarios = [
            ("software", "MEASURED", "latency", "ns"),
            ("fpga", "MEASURED", "fmax", "MHz"),
            ("fpga", "SYNTH_ONLY", "lut", "count"),
            ("fpga", "SIMULATED_ONLY", "ii", "cycles"),
            ("fpga", "PLACE_ROUTE_VERIFIED", "fmax", "MHz"),
            ("asic", "SYNTH_ONLY", "power", "mW"),
            ("asic", "SIMULATED_ONLY", "area", "um2"),
            ("asic", "SIMULATED_ONLY", "power", "mW"),
        ]
        samples = []
        for family, status, kind, unit in scenarios:
            for mask in range(1 << len(STAGES)):
                selected = tuple(v for i, v in enumerate(STAGES) if (mask >> i) & 1)
                samples.append(report(family=family, status=status,
                                      kind=kind, unit=unit, stages=selected))
        good = report()
        for field, bad in (("sourceSha", "0" * 40),
                           ("compilerSha256", "0" * 64),
                           ("fixtureSha256", "0" * 64),
                           ("status", "PASS"), ("unit", "MHz")):
            item = copy_report(good)
            item[field] = bad
            samples.append(item)
        for field, bad in (("latency", -1), ("latency", -0.01),
                           ("latency", 0), ("latency", 100)):
            item = copy_report(good)
            item["kind"] = field
            item["samples"][0] = bad
            samples.append(item)
        for metric, unit, bad in (("ii", "cycles", 0),
                                  ("ii", "cycles", 1.5),
                                  ("lut", "count", -1),
                                  ("lut", "count", 9007199254740992)):
            item = report(family="fpga", status="SYNTH_ONLY",
                          kind=metric, unit=unit,
                          stages=("correctness", "synthesis"))
            item["samples"][0] = bad
            samples.append(item)
        unsupported = report(status="UNCONFIGURED", stages=())
        unsupported["samples"] = []
        unsupported["correctness"] = "UNVERIFIED"
        samples.append(unsupported)
        # Read the entire JSON array once; no network, credentials, mirrored
        # private repositories, package downloads or output artifacts.
        source = (
            "import {readFileSync} from 'node:fs';"
            "import {validatePerformanceEvidence} "
            "from './src/performance-evidence.mjs';"
            "const fixtures=JSON.parse(readFileSync(0,'utf8'));"
            "const admitted=fixtures.map(x=>{try{"
            "validatePerformanceEvidence(x);return true"
            "}catch{return false}});"
            "process.stdout.write(JSON.stringify(admitted));"
        )
        root = SCHEMA_PATH.parent.parent
        finished = subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=root, input=json.dumps(samples), capture_output=True,
            text=True, check=True, timeout=40,
        )
        decisions = json.loads(finished.stdout)
        self.assertEqual(len(decisions), len(samples))
        for i, (sample, admitted) in enumerate(zip(samples, decisions)):
            with self.subTest(i=i, family=sample["family"],
                              status=sample["status"], kind=sample["kind"]):
                self.assertEqual(bool(admitted), accepted(sample))


if __name__ == "__main__":
    unittest.main()
