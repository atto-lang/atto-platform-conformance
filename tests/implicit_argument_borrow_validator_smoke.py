#!/usr/bin/env python3
"""No-compiler tamper regression for the implicit-borrow TARGET validator.

Run with python3 -O as well: optimized Python must never remove validation.
This is not a guest conformance test or evidence of backend support.
"""
import copy
import importlib.util
import tempfile
from pathlib import Path


VALIDATOR = Path(__file__).resolve().parent.parent / "bin" / "validate_implicit_argument_borrow.py"
spec = importlib.util.spec_from_file_location("implicit_borrow_validator", VALIDATOR)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


def fixtures(root: Path) -> dict:
    cases = []
    for kind, mark, expected in (("pass", "P", 42), ("fail", "F", "E_BORROW")):
        for number in range(1, 7):
            path = f"fixtures/implicit-borrow/{kind}/case{number:02}.atto"
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            header = (f"// expect-exit: {expected}\n" if kind == "pass"
                      else f"// expect-error: {expected}\n")
            target.write_text(header + "pub fnc main(): int { return 42; }\n",
                              encoding="utf-8")
            case = {
                "id": f"IB_{mark}_{number:02}",
                "kind": kind,
                "path": path,
                "proof": "source-only validator tamper test",
            }
            case["expected_exit" if kind == "pass" else "expected_error"] = expected
            cases.append(case)
    return {
        "schema": "atto.implicit-argument-borrow.v1",
        "version": 1,
        "status": "TARGET_NOT_EXECUTED",
        "required_cases": cases,
        "backend_status": {name: "NOT_EXECUTED" for name in validator.BACKENDS},
    }


def main() -> None:
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        data = fixtures(root)
        if validator.validate_manifest(data, root) != 12:
            raise AssertionError("valid synthetic target registry was rejected")
        invalid = []
        tampered = copy.deepcopy(data)
        tampered["backend_status"]["java"] = "PASS"
        invalid.append(("fabricated backend PASS", tampered))
        tampered = copy.deepcopy(data)
        tampered["required_cases"][2]["id"] = tampered["required_cases"][0]["id"]
        invalid.append(("duplicate id", tampered))
        tampered = copy.deepcopy(data)
        tampered["required_cases"][2]["path"] = tampered["required_cases"][0]["path"]
        invalid.append(("duplicate fixture", tampered))
        tampered = copy.deepcopy(data)
        tampered["required_cases"][0]["path"] = (
            "fixtures/implicit-borrow/pass/../../../../../etc/passwd"
        )
        invalid.append(("path traversal", tampered))
        tampered = copy.deepcopy(data)
        tampered["required_cases"][0]["expected_exit"] = 43
        invalid.append(("mismatched header", tampered))
        tampered = copy.deepcopy(data)
        tampered["required_cases"][0]["proof"] = ""
        invalid.append(("missing proof obligation", tampered))
        for label, broken in invalid:
            try:
                validator.validate_manifest(broken, root)
            except (ValueError, OSError):
                continue
            raise AssertionError(f"invalid registry accepted: {label}")
        print(f"PASS: 1 valid registry + {len(invalid)} rejected tamper variants; no guests executed")


if __name__ == "__main__":
    main()
