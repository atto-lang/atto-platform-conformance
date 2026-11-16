#!/usr/bin/env python3
"""Host-only candidate foreign ABI model and fail-closed evidence receipt validation.

No native library is loaded here. Passing these tests never certifies guest FFI.
"""
from __future__ import annotations

import json
import math
import re
import struct
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "contracts" / "ffi-boundary-v1.json"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA64 = re.compile(r"[0-9a-f]{64}\Z")
FINGERPRINT = re.compile(r"[0-9a-f]{64}\Z")
ALLOWED_KINDS = {"compile-negative", "runtime-positive", "runtime-negative", "security-negative"}
VALID_STATUSES = {"passed", "failed", "unsupported", "not_executed"}


class BoundaryError(ValueError):
    pass


def require(condition: bool, why: str) -> None:
    if not condition:
        raise BoundaryError(why)


def encode_int(value: int) -> bytes:
    require(type(value) is int and -(1 << 63) <= value < (1 << 63), "int must be signed i64")
    return struct.pack("<q", value)


def decode_int(data: bytes) -> int:
    require(type(data) is bytes and len(data) == 8, "i64 must be 8 bytes")
    return struct.unpack("<q", data)[0]


def encode_bool(value: bool) -> bytes:
    require(type(value) is bool, "bool requires exact bool type")
    return b"\x01" if value else b"\x00"


def decode_bool(data: bytes) -> bool:
    require(type(data) is bytes and data in (b"\x00", b"\x01"), "noncanonical bool")
    return data == b"\x01"


def encode_float(value: float) -> bytes:
    require(type(value) is float, "float requires exact binary64")
    if math.isnan(value):
        return bytes.fromhex("000000000000f87f")
    return struct.pack("<d", value)


def decode_float(data: bytes) -> float:
    require(type(data) is bytes and len(data) == 8, "f64 must be 8 bytes")
    value = struct.unpack("<d", data)[0]
    require(not math.isnan(value) or data == bytes.fromhex("000000000000f87f"),
            "noncanonical NaN")
    return value


@dataclass(frozen=True)
class Handle:
    domain: str
    actor_generation: int
    slot: int
    generation: int
    type_id: str
    rights: frozenset[str]


@dataclass(frozen=True)
class Lease:
    """Host-private completion receipt; never serialized into guest memory."""
    nonce: int
    handle: Handle


@dataclass
class _Entry:
    owner: str
    actor_generation: int
    generation: int
    type_id: str
    rights: frozenset[str]
    leases: int = 0
    active: bool = True


class Broker:
    """Reference logical authority checks; not a memory/pointer allocator."""

    MAX_GENERATION = (1 << 32) - 1

    def __init__(self, domain: str, quota: int = 64):
        require(isinstance(domain, str) and bool(domain), "empty domain")
        require(type(quota) is int and 1 <= quota <= 65536, "invalid quota")
        self.domain = domain
        self.quota = quota
        self._entries: dict[int, _Entry] = {}
        self._next_slot = 1
        self._owners: dict[str, int] = {}
        self._stopped: set[str] = set()
        self._freed: set[int] = set()
        self._next_lease = 1
        self._leases: dict[int, tuple[Lease, bool]] = {}

    def register_actor(self, actor: str, generation: int) -> None:
        require(actor not in self._owners and actor not in self._stopped, "owner already registered/retired")
        require(type(generation) is int and generation > 0, "invalid actor generation")
        self._owners[actor] = generation

    def issue(self, actor: str, type_id: str, rights: frozenset[str]) -> Handle:
        require(actor in self._owners and actor not in self._stopped, "actor retired or unknown")
        require(isinstance(type_id, str) and bool(type_id), "missing type identity")
        require(type(rights) is frozenset and rights <= {"read", "write", "call"}
                and bool(rights), "invalid rights")
        require(len(self._entries) - len(self._freed) < self.quota, "quota exhausted")
        # Non-wrapping monotonic IDs: retired slots cannot be resurrected.
        require(self._next_slot <= self.MAX_GENERATION, "slot ids exhausted")
        slot = self._next_slot
        self._next_slot += 1
        generation = 1
        self._entries[slot] = _Entry(actor, self._owners[actor], generation, type_id, rights)
        return Handle(self.domain, self._owners[actor], slot, generation, type_id, rights)

    def _validate(self, actor: str, handle: Handle, type_id: str, right: str) -> _Entry:
        require(type(handle) is Handle, "invalid handle")
        require(handle.domain == self.domain, "cross-domain handle")
        require(actor in self._owners and actor not in self._stopped, "actor not admitted")
        require(handle.actor_generation == self._owners[actor], "stale actor generation")
        entry = self._entries.get(handle.slot)
        require(entry is not None and entry.active, "stale slot")
        require(entry.owner == actor and entry.actor_generation == handle.actor_generation,
                "forged owner")
        require(entry.generation == handle.generation, "stale slot generation")
        require(entry.type_id == type_id == handle.type_id, "type mismatch")
        require(handle.rights == entry.rights and right in entry.rights, "rights mismatch")
        return entry

    def enter(self, actor: str, handle: Handle, type_id: str, right: str) -> Lease:
        entry = self._validate(actor, handle, type_id, right)
        require(entry.leases < self.MAX_GENERATION and self._next_lease <= self.MAX_GENERATION,
                "lease overflow")
        entry.leases += 1
        lease = Lease(self._next_lease, handle)
        self._next_lease += 1
        self._leases[lease.nonce] = (lease, False)
        return lease

    def complete(self, lease: Lease) -> bool:
        # Idempotency is per CALL, not per handle: concurrent calls can share a handle.
        # Never surface the lease ticket to the guest as a forged integer.
        require(type(lease) is Lease and lease.handle.domain == self.domain, "foreign completion")
        saved = self._leases.get(lease.nonce)
        require(saved is not None and saved[0] == lease, "stale or forged completion")
        if saved[1]:
            return False
        handle = lease.handle
        entry = self._entries.get(handle.slot)
        require(entry is not None and entry.generation == handle.generation
                and entry.actor_generation == handle.actor_generation and
                entry.type_id == handle.type_id and entry.rights == handle.rights,
                "stale completion")
        require(entry.leases > 0, "lease counter underflow")
        entry.leases -= 1
        self._leases[lease.nonce] = (lease, True)
        if not entry.active and entry.leases == 0:
            self._freed.add(handle.slot)
        return True

    def retire(self, actor: str) -> None:
        require(actor in self._owners, "unknown actor")
        self._stopped.add(actor)
        for slot, entry in self._entries.items():
            if entry.owner == actor:
                entry.active = False
                if entry.leases == 0:
                    self._freed.add(slot)

    def reclaimed(self, handle: Handle) -> bool:
        return handle.slot in self._freed


def validate_manifest(m: dict) -> list[dict]:
    require(type(m) is dict and m.get("schema") == "atto.ffi-boundary.v1"
            and m.get("version") == 1, "wrong schema/version")
    require(m.get("status") == "CANDIDATE_CONTRACT_ONLY_NO_GUEST_EXECUTION", "misleading status")
    require(m.get("capability") == "FFI" and m.get("hostImportNamespace") == "atto", "capability/import change")
    scalar = m.get("scalarSemantics", {})
    require(scalar == {"int": "signed-i64", "bool": "strict-0-or-1",
                       "float": "ieee754-binary64", "void": "return-only"}, "scalar ABI drift")
    layout = m.get("canonicalInterchange", {})
    require(layout.get("byteOrder") == "little" and layout.get("intBytes") == 8
            and layout.get("boolBytes") == 1 and layout.get("floatBytes") == 8
            and layout.get("nanHex") == "000000000000f87f", "canonical layout drift")
    require(type(m.get("backends")) is dict and set(m["backends"]) ==
            {"rs-wasm", "java", "llvm", "net", "forge"}, "missing backend")
    for backend, status in m["backends"].items():
        require(status.get("status") == "NOT_EXECUTED" and status.get("repository"),
                f"{backend}: baseline must be unexecuted")
    cases = m.get("cases")
    require(type(cases) is list and len(cases) >= 25, "insufficient FFI matrix")
    ids = set()
    for case in cases:
        require(type(case) is dict and set(case) == {"id", "kind", "expect"}, "malformed case")
        require(type(case["id"]) is str and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", case["id"])
                and case["id"] not in ids, "duplicate/invalid case id")
        ids.add(case["id"])
        require(case["kind"] in ALLOWED_KINDS and bool(case["expect"]), "unknown case kind")
    require(set(m["resultPolicy"]["states"]) == VALID_STATUSES, "result status drift")
    return cases


def _valid_url(value: object) -> bool:
    if type(value) is not str:
        return False
    u = urlparse(value)
    return u.scheme == "https" and u.hostname == "github.com" and bool(u.path)


def validate_receipt(r: dict, m: dict) -> None:
    cases = {c["id"]: c for c in validate_manifest(m)}
    require(type(r) is dict and r.get("backend") in m["backends"], "unknown backend")
    case = cases.get(r.get("case_id"))
    require(case is not None, "unknown case")
    status = r.get("status")
    require(status in VALID_STATUSES, "unknown result")
    if status in ("not_executed", "unsupported"):
        require(type(r.get("reason")) is str and len(r["reason"].strip()) >= 12, "missing reason")
        require(not r.get("guest_executed") and not r.get("artifact_sha256"),
                "non-executed result contains guest success evidence")
        return
    # Failed results must never silently be counted as a pass.
    if status == "failed":
        require(type(r.get("reason")) is str and bool(r["reason"].strip()), "failure without reason")
        return
    if case["kind"] == "compile-negative":
        require(r.get("guest_executed") is False and
                r.get("evidence_kind") == "source-compiler",
                "compile-negative must prove compiler rejection, not guest execution")
    else:
        require(r.get("guest_executed") is True and
                r.get("evidence_kind") == "compiled-guest",
                "host-only or unexecuted tests are not guest passes")
    for field in ("source_head_sha", "source_tree_sha"):
        require(type(r.get(field)) is str and SHA40.fullmatch(r[field]) is not None, f"invalid {field}")
    require(type(r.get("abi_fingerprint")) is str and FINGERPRINT.fullmatch(r["abi_fingerprint"]),
            "ABI fingerprint missing")
    require(_valid_url(r.get("workflow_url")), "workflow URL missing")
    require(type(r.get("run_id")) is int and r["run_id"] > 0 and
            type(r.get("job_id")) is int and r["job_id"] > 0 and
            type(r.get("executed_steps")) is int and r["executed_steps"] >= 2,
            "zero-step or invented CI receipt")
    require(type(r.get("command")) is str and bool(r["command"].strip()), "command missing")
    require(type(r.get("target")) is str and len(r["target"]) >= 3 and
            type(r.get("bridge_version")) is int and r["bridge_version"] == 1,
            "target/bridge mismatch")
    require(r.get("observed") == case["expect"], "observed outcome mismatch")
    require(type(r.get("exit_code")) is int, "exit code missing")
    if case["kind"] == "compile-negative":
        require(r.get("artifact_sha256") is None and r.get("exit_code") != 0 and
                r.get("no_artifact_proven") is True,
                "rejected source must emit no artifact and have nonzero status")
    else:
        require(type(r.get("artifact_sha256")) is str and
                SHA64.fullmatch(r["artifact_sha256"]) is not None, "guest artifact hash missing")
        require(r.get("exit_code") == 0, "guest/runtime failure cannot pass")
        if case["kind"] == "security-negative":
            require(r.get("isolation_boundary") in
                    {"native-process", "validated-wasm-isolate", "isolated-managed-runtime"},
                    "security proof lacks real memory/process boundary")
            require(r.get("enforcement_tested") is True, "security denial not exercised")


def main() -> None:
    m = json.loads(MANIFEST_PATH.read_text())
    cases = validate_manifest(m)
    print(f"STRUCTURAL_ONLY: {len(cases)} FFI cases; 5 backends NOT_EXECUTED")
    print("Canonical bool/int/float and opaque-generation model are host-only; no FFI guest pass")


if __name__ == "__main__":
    main()
