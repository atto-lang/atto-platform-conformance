#!/usr/bin/env python3
"""Source-only manifest integrity check. NEVER marks guest/backend conformance PASS."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "contracts" / "shared-ownership-and-guards-v1.json"
EXPECTED_BACKENDS = {
    "rs-browser", "java", "llvm", "net", "wasm-independent", "forge",
}


def validate() -> int:
    manifest = json.loads(REGISTRY.read_text(encoding="utf-8"))
    assert manifest["schema"] == "atto.shared-ownership-and-guards.v1"
    assert manifest["version"] == 1
    assert manifest["status"] == "TARGET_NOT_EXECUTED"
    assert set(manifest["backend_status"]) == EXPECTED_BACKENDS
    assert all(v == "NOT_EXECUTED" for v in manifest["backend_status"].values()), (
        "A source-only registry must never assert backend guest PASS"
    )

    ids, paths, counts = set(), set(), {"pass": 0, "fail": 0}
    for case in manifest["required_cases"]:
        case_id, kind, rel_path = case["id"], case["kind"], case["path"]
        assert kind in counts, (case_id, kind)
        assert case_id not in ids, case_id
        assert rel_path not in paths, rel_path
        ids.add(case_id)
        paths.add(rel_path)
        counts[kind] += 1
        assert rel_path.startswith(f"fixtures/shared-ownership/{kind}/"), rel_path
        path = (ROOT / rel_path).resolve()
        assert path.is_relative_to(ROOT), rel_path
        assert path.is_file(), rel_path
        if kind == "pass":
            assert isinstance(case["expected_exit"], int)
            header = f"// expect-exit: {case['expected_exit']}\n"
        else:
            assert case["expected_error"].startswith("E_")
            header = f"// expect-error: {case['expected_error']}\n"
        source = path.read_text(encoding="utf-8")
        assert source.startswith(header), case_id
        assert "pub fnc main()" in source, case_id
        assert "share!" in source, case_id
        assert "proof" in case, case_id
    assert counts["pass"] >= 6, counts
    assert counts["fail"] >= 10, counts

    print(
        f"PASS source-only integrity: {len(ids)} TARGET fixtures "
        f"({counts['pass']} positives, {counts['fail']} negatives); "
        "0 guest programs executed / 0 verified backends"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(validate())
