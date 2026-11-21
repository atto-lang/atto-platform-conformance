#!/usr/bin/env python3
"""Validate the target borrowing registry; this does NOT execute AttoLang guests.

Keep failure checks active even under `python -O`. Do not let an untrusted
registry entry escape the fixture root or claim backend PASS from source checks.
"""
import json
import re
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "contracts" / "implicit-argument-borrow-v1.json"
BACKENDS = {"rs-browser", "java", "llvm", "net", "wasm-independent", "forge"}
CASE_ID = re.compile(r"IB_([PF])_([0-9]{2,})$")
ERROR_ID = re.compile(r"E_[A-Z][A-Z0-9_]*$")


def require(condition: bool, why: str) -> None:
    if not condition:
        raise ValueError(why)


def validate_manifest(data: dict, root: Path) -> int:
    """Return the number of TARGET fixtures; never return a backend PASS."""
    require(isinstance(data, dict), "manifest must be an object")
    require(data.get("schema") == "atto.implicit-argument-borrow.v1", "wrong schema")
    require(data.get("version") == 1, "wrong version")
    require(data.get("status") == "TARGET_NOT_EXECUTED", "target status must remain unexecuted")
    cases = data.get("required_cases")
    require(isinstance(cases, list) and len(cases) >= 12, "insufficient target cases")
    statuses = data.get("backend_status")
    require(isinstance(statuses, dict) and set(statuses) == BACKENDS,
            "incomplete or unknown backend inventory")
    require(all(statuses[name] == "NOT_EXECUTED" for name in BACKENDS),
            "source-only validator cannot certify a backend PASS/FAIL/UNSUPPORTED")

    root = root.resolve(strict=True)
    seen_ids: set[str] = set()
    seen_paths: set[str] = set()
    for case in cases:
        require(isinstance(case, dict), "case must be an object")
        ident = case.get("id")
        require(isinstance(ident, str) and CASE_ID.fullmatch(ident) is not None,
                f"invalid case id {ident!r}")
        kind = case.get("kind")
        require(kind in ("pass", "fail"), f"{ident}: invalid kind")
        require(ident[3] == ("P" if kind == "pass" else "F"),
                f"{ident}: id disagrees with kind")
        require(ident not in seen_ids, f"duplicate id: {ident}")
        seen_ids.add(ident)

        rel = case.get("path")
        require(isinstance(rel, str) and "\\" not in rel, f"{ident}: invalid path")
        part = PurePosixPath(rel)
        require(not part.is_absolute() and len(part.parts) == 4 and
                part.parts[:3] == ("fixtures", "implicit-borrow", kind) and
                part.parts[-1].endswith(".atto") and
                part.as_posix() == rel and "." not in rel.split("/") and
                ".." not in rel.split("/"), f"{ident}: noncanonical fixture path")
        require(rel not in seen_paths, f"duplicate fixture path: {rel}")
        seen_paths.add(rel)
        fixture = (root / rel).resolve(strict=True)
        require(fixture.is_relative_to(root) and fixture.is_file(),
                f"{ident}: fixture escapes root or is not a file")
        source = fixture.read_text(encoding="utf-8")
        require("pub fnc main()" in source, f"{ident}: missing guest main()")
        if kind == "pass":
            expected = case.get("expected_exit")
            require(type(expected) is int and 0 <= expected <= 255,
                    f"{ident}: expected_exit must be a byte-sized integer")
            require("expected_error" not in case, f"{ident}: mixed pass/fail expectations")
            prefix = f"// expect-exit: {expected}\\n"
        else:
            expected = case.get("expected_error")
            require(isinstance(expected, str) and ERROR_ID.fullmatch(expected) is not None,
                    f"{ident}: invalid diagnostic expectation")
            require("expected_exit" not in case, f"{ident}: mixed pass/fail expectations")
            prefix = f"// expect-error: {expected}\\n"
        require(source.startswith(prefix), f"{ident}: fixture expectation mismatch")
        require(isinstance(case.get("proof"), str) and bool(case["proof"].strip()),
                f"{ident}: missing proof obligation")
    return len(seen_ids)


def validate() -> int:
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        count = validate_manifest(data, ROOT)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"Invalid borrowing target registry: {exc}", file=sys.stderr)
        return 1
    print(f"Registry shape valid: {count} target fixtures, 0 guests executed")
    return 0


if __name__ == "__main__":
    raise SystemExit(validate())
