#!/usr/bin/env python3
"""Fail-closed TARGET AOT lambda fixture runner (not a compiler).

Real conformance needs additional independently verified GitHub/runner provenance.
No JIT/interpreter fallback is performed by this harness.
"""
import argparse
import hashlib
import json
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

ALLOWED_BACKENDS = {"java", "llvm", "wasm", "forge", "net"}
MAGIC = {
    "elf": (bytes.fromhex("7f454c46"),),
    "wasm": (bytes.fromhex("0061736d"),),
    "pe": (b"MZ",),
    "macho": tuple(bytes.fromhex(x) for x in (
        "feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca"
    )),
}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_manifest(path):
    """Validate fixture integrity; NEVER count this as a compiler pass."""
    path = Path(path).resolve()
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != "atto.lambda.v1" or data.get("status") != "TARGET-NOT-EXECUTED":
        raise ValueError("expected TARGET v1 manifest, not purported conformance")
    cases = data.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("empty or invalid cases")
    ids = set()
    accepts = rejects = 0
    for case in cases:
        cid = case.get("id", "")
        name = case.get("source", "")
        if not re.fullmatch(r"[a-z][a-z0-9_]*", cid) or cid in ids:
            raise ValueError(f"duplicate or invalid id: {cid}")
        if not re.fullmatch(r"[a-z][a-z0-9_]*\.atto", name):
            raise ValueError(f"invalid/unsafe source: {name}")
        ids.add(cid)
        file_path = (path.parent / name).resolve()
        if file_path.parent != path.parent or not file_path.is_file():
            raise ValueError(f"fixture missing or escaping directory: {name}")
        if digest(file_path) != case.get("sha256"):
            raise ValueError(f"fixture hash mismatch: {name}")
        if case.get("expect") == "accept":
            accepts += 1
            if not isinstance(case.get("exit_code"), int) or not 0 <= case["exit_code"] <= 255:
                raise ValueError(f"missing positive exit code: {name}")
        elif case.get("expect") == "reject":
            rejects += 1
            if case.get("phase") not in {"parse", "typecheck", "borrowcheck", "effects"}:
                raise ValueError(f"negative case missing phase: {name}")
        else:
            raise ValueError(f"invalid expectation: {name}")
    if not accepts or not rejects:
        raise ValueError("both accept and reject fixtures are required")
    return data


def render_command(template, source, artifact):
    if "{source}" not in template and "{artifact}" not in template:
        raise ValueError("command template must use {source} or {artifact}")
    parts = shlex.split(template)
    allowed = {"{source}": str(source), "{artifact}": str(artifact)}
    rendered = []
    for part in parts:
        for placeholder, value in allowed.items():
            part = part.replace(placeholder, value)
        if "{" in part or "}" in part:
            raise ValueError("unknown template placeholder")
        rendered.append(part)
    if not rendered:
        raise ValueError("empty command")
    return rendered


def assert_artifact_format(path, fmt):
    if not path.is_file() or path.stat().st_size < 4:
        raise ValueError("no nonempty compiled artifact")
    with path.open("rb") as handle:
        header = handle.read(8)
    if not any(header.startswith(magic) for magic in MAGIC[fmt]):
        raise ValueError(f"compiled artifact is not {fmt} (host fallback rejected)")


def run_command(command, timeout):
    try:
        result = subprocess.run(command, capture_output=True, text=True, errors="replace", timeout=timeout)
        return {"command": command, "exit_code": result.returncode,
                "stdout": result.stdout[-6000:], "stderr": result.stderr[-6000:]}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"command": command, "exit_code": None, "stdout": "", "stderr": str(exc)}


def check_git_tree(checkout_dir, expected_tree_sha):
    if not re.fullmatch(r"[0-9a-f]{40}", expected_tree_sha):
        raise ValueError("expected SHA-1 Git tree hash (40 lowercase hex)")
    cmd = ["git", "-C", str(checkout_dir), "rev-parse", "HEAD^{tree}"]
    result = run_command(cmd, 20)
    if result["exit_code"] != 0 or result["stdout"].strip() != expected_tree_sha:
        raise ValueError("local exact-tree verification failed")
    return result["stdout"].strip()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("fixtures/lambda-v1/manifest.json"))
    parser.add_argument("--check-manifest", action="store_true", help="Integrity only; NEVER conformance")
    parser.add_argument("--backend", choices=sorted(ALLOWED_BACKENDS))
    parser.add_argument("--compile-command", help="argv with {source} and {artifact} placeholders")
    parser.add_argument("--run-command", help="argv with {artifact} placeholder; e.g. 'wasmtime {artifact}'")
    parser.add_argument("--artifact-format", choices=sorted(MAGIC))
    parser.add_argument("--checkout-dir", type=Path, help="local exact-tree compiler checkout")
    parser.add_argument("--expected-tree-sha", help="Git tree SHA, checked against local checkout")
    parser.add_argument("--compiler-source-commit-sha", help="original source commit, recorded but not trusted without upstream verification")
    parser.add_argument("--evidence-file", type=Path)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args(argv)
    try:
        manifest = validate_manifest(args.manifest)
        if args.check_manifest:
            print(f"MANIFEST-ONLY OK: {len(manifest['cases'])} intact target cases; no compiler run or backend PASS")
            return 0
        required = ["backend", "compile_command", "run_command", "artifact_format",
                    "checkout_dir", "expected_tree_sha", "compiler_source_commit_sha", "evidence_file"]
        missing = [field for field in required if getattr(args, field) is None]
        if missing:
            raise ValueError("missing real-execution prerequisites: " + ", ".join(missing))
        if not re.fullmatch(r"[0-9a-f]{40}", args.compiler_source_commit_sha):
            raise ValueError("invalid compiler source commit SHA")
        if args.timeout < 1 or args.timeout > 3600:
            raise ValueError("timeout out of range")
        tree = check_git_tree(args.checkout_dir, args.expected_tree_sha)
        rows = []
        with tempfile.TemporaryDirectory(prefix="atto-lambda-aot-") as tmp:
            for case in manifest["cases"]:
                source = args.manifest.resolve().parent / case["source"]
                artifact = Path(tmp) / (case["id"] + ".bin")
                compile_cmd = render_command(args.compile_command, source, artifact)
                compile_result = run_command(compile_cmd, args.timeout)
                row = {"case_id": case["id"], "fixture_sha256": case["sha256"],
                       "expect": case["expect"], "compile": compile_result, "passed": False}
                if case["expect"] == "reject":
                    row["passed"] = compile_result["exit_code"] is not None and compile_result["exit_code"] != 0
                elif compile_result["exit_code"] == 0:
                    try:
                        assert_artifact_format(artifact, args.artifact_format)
                        row["artifact_sha256"] = digest(artifact)
                        run_cmd = render_command(args.run_command, source, artifact)
                        run_result = run_command(run_cmd, args.timeout)
                        row["run"] = run_result
                        row["passed"] = run_result["exit_code"] == case["exit_code"]
                    except ValueError as exc:
                        row["failure"] = str(exc)
                rows.append(row)
        successes = sum(1 for row in rows if row["passed"])
        evidence = {
            "schema": "atto.lambda.execution-candidate.v1", "backend": args.backend,
            "artifact_format": args.artifact_format,
            "source_tree_sha_verified_locally": tree,
            "compiler_source_commit_sha_supplied_not_upstream_verified": args.compiler_source_commit_sha,
            "passed": successes, "total": len(rows), "all_passed": successes == len(rows),
            "status": "RUNNER-CANDIDATE-REQUIRES-INDEPENDENT-CI-PROVENANCE" if successes == len(rows) else "FAIL",
            "cases": rows,
            "notice": "Local exact tree + actual command invocation does NOT certify upstream commit equivalence, release provenance, or five-backend parity."
        }
        args.evidence_file.parent.mkdir(parents=True, exist_ok=True)
        args.evidence_file.write_text(json.dumps(evidence, indent=2) + "\n")
        print(f"{evidence['status']}: {successes}/{len(rows)} ({args.backend})")
        return 0 if successes == len(rows) else 1
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"FAIL CLOSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
