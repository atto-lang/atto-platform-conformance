#!/usr/bin/env python3
"""Structural only: an internally consistent receipt is NOT trusted provenance.

No path through this validator certifies a real compiled guest, AOT binary,
collector selection or tenant sandbox without independently reviewed CI.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts/aot-gc-tenant-evidence-v1.json"
HEX40 = re.compile(r"[a-f0-9]{40}\Z")
HEX64 = re.compile(r"[a-f0-9]{64}\Z")


class ReceiptError(ValueError):
    pass


def need(cond, why):
    if not cond:
        raise ReceiptError(why)


def exact_int(x, minimum=0):
    return type(x) is int and x >= minimum


def exact_number(x, minimum=0):
    return type(x) in (int, float) and x >= minimum and x < float("inf")


def git_blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def validate_manifest(m):
    need(m.get("schema") == "atto.aot-gc-tenant-evidence.v1", "manifest schema")
    need(m.get("status") == "NOT_EXECUTED_ALL_BACKENDS", "baseline inflated")
    need(m.get("states") == ["passed", "failed", "unsupported", "not_executed"], "states")
    profiles = m.get("profiles", {})
    need(set(profiles) == {
        "llvm-native-aot", "graal-native-epsilon-aot", "graal-native-managed-aot",
        "java-jvm-low-gc", "wasm-precompiled-aot", "forge-native-aot", "net-native-aot",
    }, "profile set")
    need(profiles["llvm-native-aot"]["strict_zero_gc"] is True, "llvm zero GC missing")
    need(profiles["graal-native-epsilon-aot"]["selected_gc"] == "epsilon", "epsilon mode missing")
    need(profiles["graal-native-epsilon-aot"]["strict_zero_gc"] is True, "epsilon no GC missing")
    need(profiles["java-jvm-low-gc"]["full_native_aot"] is False, "JVM falsely labeled native AOT")
    need(set(m.get("default_statuses", {})) == {"java", "llvm", "wasm", "forge", "net"}, "backends")
    need(all(v == "NOT_EXECUTED" for v in m["default_statuses"].values()), "baseline not unexecuted")
    fixtures = m.get("fixtures", [])
    need(isinstance(fixtures, list) and len(fixtures) >= 2, "fixtures")
    indexed = {}
    for f in fixtures:
        name = f.get("id")
        need(isinstance(name, str) and name not in indexed and bool(name), "duplicate fixture")
        p = f.get("path", "")
        need(isinstance(p, str) and p.startswith("fixtures/aot-tenant/")
             and ".." not in Path(p).parts, "unsafe fixture path")
        file_path = ROOT / p
        need(file_path.is_file() and not file_path.is_symlink(), "fixture unavailable")
        need(git_blob_sha(file_path.read_bytes()) == f.get("git_blob_sha"), "source blob mutated")
        need(f.get("status") == "CANDIDATE_NEEDS_BACKEND_GUEST_EXECUTION", "fixture falsely passed")
        indexed[name] = f
    cases = m.get("cases", [])
    need(isinstance(cases, list) and len(cases) >= 5, "cases")
    indexed_cases = {}
    for c in cases:
        name = c.get("id")
        need(isinstance(name, str) and name not in indexed_cases and bool(name), "duplicate case")
        need(c.get("fixture") in indexed, "case missing source")
        need(c.get("kind") in {"compiled-guest", "tenant-security", "memory-soak"}, "case kind")
        need(type(c.get("require_tenant_security")) is bool, "security requirement")
        need((c["kind"] == "tenant-security") == c["require_tenant_security"], "security scope")
        indexed_cases[name] = c
    evid = m["evidence"]
    need(evid.get("structural_not_authenticating") is True, "false attestation")
    need(evid["soak_minimums"]["actor_operations"] >= 100000, "too few operations")
    need(evid["soak_minimums"]["tenant_restarts"] >= 100, "too few restarts")
    need(evid["soak_minimums"]["heap_samples"] >= 10, "too few memory samples")
    need("artifact_sha256" in evid["source_verified_fields"], "artifact identity missing")
    need("heap_high_water_bytes" in evid["soak_required"], "heap peak missing")
    need("peak_rss_bytes" in evid["soak_required"], "RSS peak missing")
    need("arena_bytes_after" in evid["soak_required"], "arena teardown missing")
    return indexed_cases, indexed


def validate_receipt(r, m):
    cases, fixtures = validate_manifest(m)
    need(isinstance(r, dict), "receipt is not object")
    p = m["profiles"].get(r.get("profile"))
    need(p is not None, "unknown execution profile")
    c = cases.get(r.get("case_id"))
    need(c is not None, "unknown case")
    status = r.get("status")
    need(status in m["states"], "unknown status")
    if status in {"unsupported", "not_executed"}:
        need(isinstance(r.get("reason"), str) and bool(r["reason"].strip()), "missing reason")
        need(r.get("guest_executed") is not True, "non-executed guest marked executed")
        return
    if status == "failed":
        need(isinstance(r.get("reason"), str) and bool(r["reason"].strip()), "missing failure reason")
        return
    need(r.get("evidence_kind") == "compiled-guest", "host/synthetic evidence masquerading as guest")
    need(r.get("guest_executed") is True, "guest did not run")
    need(r.get("runtime_jit_used") is False or p["full_native_aot"] is False,
         "AOT profile used JIT")
    need(r.get("artifact_kind") == p["artifact_kind"], "artifact type mismatch")
    need(r.get("selected_gc") == p["selected_gc"], "collector mismatch")
    need(isinstance(r.get("command"), str) and bool(r["command"].strip()), "no command")
    for field in ("source_head_sha", "compiler_head_sha"):
        need(isinstance(r.get(field), str) and HEX40.fullmatch(r[field]), f"bad {field}")
    for field in ("artifact_sha256", "guest_fixture_sha256"):
        need(isinstance(r.get(field), str) and HEX64.fullmatch(r[field]), f"bad {field}")
    need(r.get("fixture_blob_sha") == fixtures[c["fixture"]]["git_blob_sha"], "wrong fixture")
    need(exact_int(r.get("run_id"), 1), "bad CI run id")
    need(r.get("workflow_url", "").startswith("https://github.com/")
         and "/actions/runs/" + str(r["run_id"]) in r["workflow_url"], "invalid CI run link")
    need(exact_int(r.get("executed_job_steps"), 3), "CI steps not executed")
    need(type(r.get("exit_code")) is int and r["exit_code"] == 0, "guest failed")
    if c["require_tenant_security"]:
        need(r.get("boundary") in m["evidence"]["allowed_security_boundaries"],
             "no enforced security boundary")
        need(r.get("enforcement_tested") is True, "boundary not exercised")
        need(r.get("capabilities_authorized") is True, "capability check missing")
    if c["kind"] == "memory-soak":
        mins = m["evidence"]["soak_minimums"]
        for k in ("actor_operations", "tenant_restarts", "heap_samples"):
            need(exact_int(r.get(k), mins[k]), "insufficient " + k)
        for k in ("heap_start_bytes", "heap_end_bytes", "heap_high_water_bytes",
                  "managed_heap_budget_bytes", "peak_rss_bytes", "rss_budget_bytes",
                  "arena_bytes_before", "arena_bytes_after", "arena_slack_bytes",
                  "gc_collections_before", "gc_collections_after"):
            need(exact_int(r.get(k)), "missing numeric " + k)
        need(exact_number(r.get("gc_pause_p99_ms")), "missing GC p99")
        need(exact_number(r.get("gc_pause_budget_p99_ms")), "missing GC pause budget")
        need(r["heap_high_water_bytes"] >= max(r["heap_start_bytes"], r["heap_end_bytes"]),
             "inconsistent high-water measurement")
        need(r["heap_high_water_bytes"] <= r["managed_heap_budget_bytes"], "managed heap unbounded")
        need(r["peak_rss_bytes"] <= r["rss_budget_bytes"], "RSS unbounded")
        need(r["arena_bytes_after"] <= r["arena_bytes_before"] + r["arena_slack_bytes"],
             "arena not reclaimed")
        need(r["gc_collections_after"] >= r["gc_collections_before"], "GC counters reversed")
        if p["strict_zero_gc"]:
            need(r["gc_collections_after"] == r["gc_collections_before"], "collection in zero-GC mode")
        else:
            need(r["gc_pause_p99_ms"] <= r["gc_pause_budget_p99_ms"], "GC pause budget exceeded")


def main(argv):
    if len(argv) not in (1, 2):
        print("usage: verify_aot_gc_receipt.py [receipt.json]", file=sys.stderr)
        return 2
    try:
        m = json.loads(MANIFEST.read_text())
        validate_manifest(m)
        if len(argv) == 2:
            validate_receipt(json.loads(Path(argv[1]).read_text()), m)
    except (ReceiptError, OSError, ValueError, KeyError, TypeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1
    print("VALID STRUCTURE ONLY; NOT AUTHENTICATED COMPILED GUEST OR GC CERTIFICATION")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
