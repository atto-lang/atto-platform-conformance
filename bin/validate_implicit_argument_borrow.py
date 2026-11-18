#!/usr/bin/env python3
"""Validate *target* implicit-borrow fixture registry only; never claims guest execution."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "contracts" / "implicit-argument-borrow-v1.json"
VALID_STATES = {"NOT_EXECUTED", "PASS", "FAIL", "UNSUPPORTED"}


def validate() -> int:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert data["schema"] == "atto.implicit-argument-borrow.v1"
    assert data["status"] == "TARGET_NOT_EXECUTED"
    ids = set()
    for item in data["required_cases"]:
        assert item["id"] not in ids, f"duplicate id: {item['id']}"
        ids.add(item["id"])
        path = ROOT / item["path"]
        assert path.is_file(), f"missing fixture: {path}"
        assert item["path"].startswith("fixtures/implicit-borrow/")
        source = path.read_text(encoding="utf-8")
        expected_prefix = "// expect-exit: " if item["kind"] == "pass" else "// expect-error: "
        value = item.get("expected_exit") if item["kind"] == "pass" else item.get("expected_error")
        assert source.startswith(f"{expected_prefix}{value}\n"), item["id"]
        assert "pub fnc main()" in source, item["id"]
    assert len(ids) >= 12, "insufficient negative/positive coverage"
    assert set(data["backend_status"]) == {
        "rs-browser", "java", "llvm", "net", "wasm-independent", "forge"
    }
    assert all(value in VALID_STATES for value in data["backend_status"].values())
    # No backend may be upgraded to PASS by merely running this source-only validator.
    assert all(v == "NOT_EXECUTED" for v in data["backend_status"].values())
    print(f"Registry shape valid: {len(ids)} target fixtures, 0 guests executed")
    return 0


if __name__ == "__main__":
    raise SystemExit(validate())
