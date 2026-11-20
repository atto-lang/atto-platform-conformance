#!/usr/bin/env python3
"""Source-free state-region contract model; not a compiler/runtime proof.

Run:
  python3 -m unittest discover -s contracts/state_regions -p 'test_*.py' -v

The model is deliberately allocation/simple-state oriented. It models exact
logical task identity + generation, not physical worker-thread identity.
"""
import json
import unittest
from dataclasses import dataclass, field
from pathlib import Path


class AdmissionError(Exception):
    pass


@dataclass(frozen=True)
class TaskIdentity:
    runtime_domain: int
    execution: int
    slot: int
    generation: int

    def valid(self):
        return all(v > 0 for v in (
            self.runtime_domain, self.execution, self.slot, self.generation
        ))


def task(n, generation=1, domain=1):
    return TaskIdentity(domain, 1000 + n, 10 + n, generation)


def provenance_authorizes(borrow, release):
    if borrow.get("contractVersion") != "1.0" or release.get("contractVersion") != "1.0":
        return False
    if borrow.get("action") != "borrow" or release.get("action") != "release":
        return False
    keys = (
        "regionId", "regionGeneration", "runtimeDomain", "executionId",
        "executionSlot", "executionGeneration", "loanId", "place", "kind",
    )
    return all(borrow.get(key) == release.get(key) for key in keys)


def valid_compile_time_requirement(value):
    if value.get("contractVersion") != "1.0":
        return False
    if not isinstance(value.get("regionBinding"), str) or not value["regionBinding"].strip():
        return False
    if value.get("executionBinding") != "current-logical-execution":
        return False
    if value.get("generationFence") is not True:
        return False
    if not isinstance(value.get("loanId"), int) or value["loanId"] <= 0:
        return False
    if not isinstance(value.get("place"), str) or not value["place"].strip():
        return False
    if value.get("kind") not in ("read", "write"):
        return False
    if value.get("action") not in ("borrow", "release"):
        return False

    # Compile time must never fabricate concrete scheduler/region incarnations.
    forbidden_runtime_fields = {
        "regionId", "regionGeneration", "runtimeDomain", "executionId",
        "executionSlot", "executionGeneration",
    }
    return not (forbidden_runtime_fields & value.keys())


@dataclass
class Region:
    owner: str
    readers: dict = field(default_factory=dict)
    writer: TaskIdentity | None = None
    pins: set = field(default_factory=set)
    retired: bool = False
    allocations: int = 1
    releases: int = 0
    value: int = 0

    def acquire(self, task_id, mode):
        if not isinstance(task_id, TaskIdentity) or not task_id.valid():
            raise AdmissionError("invalid task identity")
        if self.retired:
            raise AdmissionError("region retired")
        if mode == "read":
            if self.writer is not None:
                raise AdmissionError("exclusive writer live")
            self.readers[task_id] = self.readers.get(task_id, 0) + 1
        elif mode == "write":
            if self.writer is not None or self.readers:
                raise AdmissionError("conflicting loan")
            self.writer = task_id
        else:
            raise AdmissionError("invalid mode")
        self.pins.add(task_id)
        return Capability(self, task_id, mode)

    def retire(self):
        if self.readers or self.writer is not None or self.pins:
            raise AdmissionError("live loans/tasks prohibit reclamation")
        if self.retired:
            raise AdmissionError("double retire")
        self.retired = True
        self.releases += 1


@dataclass
class Capability:
    region: Region
    task: TaskIdentity
    mode: str
    released: bool = False

    def _authorize(self, by_task):
        if by_task != self.task:
            raise AdmissionError("foreign task capability use")
        if self.released:
            raise AdmissionError("released capability")

    def update(self, by_task, delta):
        self._authorize(by_task)
        if self.mode != "write" or self.region.writer != self.task:
            raise AdmissionError("write without live exclusive capability")
        self.region.value += delta

    def read(self, by_task):
        self._authorize(by_task)
        if self.region.retired:
            raise AdmissionError("expired read capability")
        return self.region.value

    def release(self, by_task):
        self._authorize(by_task)
        if self.mode == "write":
            if self.region.writer != self.task:
                raise AdmissionError("wrong owner")
            self.region.writer = None
        else:
            count = self.region.readers.get(self.task, 0)
            if count < 1:
                raise AdmissionError("missing reader")
            if count == 1:
                del self.region.readers[self.task]
            else:
                self.region.readers[self.task] = count - 1
        self.released = True
        # A task may have nested read loans. Dropping one does not unpin the
        # region while another loan from the same exact task identity remains.
        if self.region.writer != self.task and self.task not in self.region.readers:
            self.region.pins.discard(self.task)


@dataclass
class Handler:
    ident: TaskIdentity
    held: list = field(default_factory=list)
    admission_count: int = 0
    budget_checks: int = 0

    def enter(self, region, mode):
        # Acquisition is an actor-visible admission opportunity even if the
        # underlying lock is uncontended.
        self.admit()
        cap = region.acquire(self.ident, mode)
        self.held.append(cap)
        return cap

    def leave(self, cap):
        cap.release(self.ident)
        self.held.remove(cap)
        self.admit()

    def admit(self):
        if any(not cap.released for cap in self.held):
            raise AdmissionError("actor admission with live capability")
        self.admission_count += 1

    def cooperate(self):
        self.admit()

    def budget_checkpoint(self):
        # Worker fairness only: no actor-visible admission and no unlock.
        self.budget_checks += 1


class StateRegionContract(unittest.TestCase):
    def test_compile_time_requirement_never_contains_runtime_identity(self):
        requirement = {
            "contractVersion": "1.0",
            "regionBinding": "inventory",
            "executionBinding": "current-logical-execution",
            "generationFence": True,
            "loanId": 501,
            "place": "inventory.stock",
            "kind": "write",
            "action": "borrow",
        }
        self.assertTrue(valid_compile_time_requirement(requirement))
        for field, value in (
            ("executionId", 1001),
            ("executionGeneration", 6),
            ("executionSlot", 41),
            ("runtimeDomain", 7),
            ("regionId", 9),
            ("regionGeneration", 3),
        ):
            with self.subTest(field=field):
                forged = dict(requirement)
                forged[field] = value
                self.assertFalse(valid_compile_time_requirement(forged))
        unfenced = dict(requirement, generationFence=False)
        self.assertFalse(valid_compile_time_requirement(unfenced))
        wrong_execution = dict(
            requirement, executionBinding="guest-supplied-execution")
        self.assertFalse(valid_compile_time_requirement(wrong_execution))

    def test_canonical_machine_readable_provenance_vectors(self):
        vector_path = Path(__file__).with_name(
            "state-region-provenance-vectors.json")
        vectors = json.loads(vector_path.read_text(encoding="utf-8"))
        borrow = vectors["borrow"]
        self.assertTrue(
            provenance_authorizes(borrow, vectors["validRelease"]))
        for case in vectors["invalidReleases"]:
            with self.subTest(case=case["name"]):
                self.assertFalse(
                    provenance_authorizes(borrow, case["release"]))

    def test_local_exclusive_mutation_no_lock_or_copy(self):
        ident = task(1)
        r = Region("task")
        h = Handler(ident)
        cap = h.enter(r, "write")
        for _ in range(1000):
            cap.update(ident, 1)
        self.assertEqual(cap.read(ident), 1000)
        self.assertEqual(r.allocations, 1)
        h.leave(cap)
        r.retire()
        self.assertEqual(r.releases, 1)

    def test_multiple_readers_exclude_writer(self):
        r = Region("actor")
        a = Handler(task(1))
        b = Handler(task(2))
        x = a.enter(r, "read")
        y = b.enter(r, "read")
        with self.assertRaisesRegex(AdmissionError, "conflicting loan"):
            r.acquire(task(3), "write")
        a.leave(x)
        b.leave(y)
        z = a.enter(r, "write")
        a.leave(z)

    def test_nested_reader_release_preserves_pin(self):
        ident = task(4)
        r = Region("actor")
        a = r.acquire(ident, "read")
        b = r.acquire(ident, "read")
        a.release(ident)
        self.assertIn(ident, r.pins)
        with self.assertRaises(AdmissionError):
            r.retire()
        b.release(ident)
        self.assertNotIn(ident, r.pins)
        r.retire()

    def test_writer_excludes_readers_and_writers(self):
        r = Region("actor")
        owner = task(5)
        cap = r.acquire(owner, "write")
        for mode in ("read", "write"):
            with self.assertRaises(AdmissionError):
                r.acquire(task(6), mode)
        cap.release(owner)

    def test_task_identity_and_generation_bind_capability(self):
        r = Region("actor")
        owner = task(7, generation=9)
        foreign_execution = task(8, generation=9)
        stale_generation = TaskIdentity(
            owner.runtime_domain, owner.execution, owner.slot, owner.generation - 1
        )
        cap = r.acquire(owner, "write")
        with self.assertRaisesRegex(AdmissionError, "foreign task"):
            cap.update(foreign_execution, 1)
        with self.assertRaisesRegex(AdmissionError, "foreign task"):
            cap.release(stale_generation)
        cap.update(owner, 1)
        self.assertEqual(cap.read(owner), 1)
        cap.release(owner)

    def test_invalid_zero_identity_is_rejected(self):
        r = Region("actor")
        invalid = TaskIdentity(1, 2, 3, 0)
        with self.assertRaisesRegex(AdmissionError, "invalid task"):
            r.acquire(invalid, "read")

    def test_reentrancy_on_acquire_and_release(self):
        ident = task(9)
        h = Handler(ident)
        r = Region("actor")
        cap = h.enter(r, "write")
        self.assertEqual(h.admission_count, 1)
        with self.assertRaisesRegex(AdmissionError, "live capability"):
            h.cooperate()
        h.budget_checkpoint()
        self.assertEqual(h.admission_count, 1)
        h.leave(cap)
        self.assertEqual(h.admission_count, 2)
        self.assertEqual(h.budget_checks, 1)

    def test_no_retire_while_live_loan_or_external_pin(self):
        ident = task(10)
        r = Region("actor")
        cap = r.acquire(ident, "read")
        with self.assertRaisesRegex(AdmissionError, "live loans"):
            r.retire()
        cap.release(ident)
        continuation_pin = ("continuation", ident, 55)
        r.pins.add(continuation_pin)
        with self.assertRaisesRegex(AdmissionError, "live loans"):
            r.retire()
        r.pins.remove(continuation_pin)
        r.retire()
        with self.assertRaisesRegex(AdmissionError, "double retire"):
            r.retire()

    def test_no_capability_use_after_release_or_retire(self):
        ident = task(11)
        r = Region("actor")
        cap = r.acquire(ident, "write")
        cap.release(ident)
        with self.assertRaises(AdmissionError):
            cap.update(ident, 1)
        with self.assertRaises(AdmissionError):
            cap.read(ident)
        r.retire()
        with self.assertRaises(AdmissionError):
            r.acquire(ident, "read")

    def test_same_actor_different_handlers_do_not_share_writer(self):
        r = Region("actor")
        a = task(12)
        b = task(13)
        cap = r.acquire(a, "write")
        with self.assertRaises(AdmissionError):
            r.acquire(b, "write")
        with self.assertRaisesRegex(AdmissionError, "foreign task"):
            cap.release(b)
        cap.release(a)

    def test_model_has_no_implicit_snapshot_allocation(self):
        ident = task(14)
        r = Region("actor")
        h = Handler(ident)
        for _ in range(100):
            cap = h.enter(r, "write")
            cap.update(ident, 1)
            h.leave(cap)
        self.assertEqual(r.value, 100)
        self.assertEqual(r.allocations, 1)
        self.assertEqual(r.releases, 0)
        r.retire()
        self.assertEqual(r.releases, 1)


if __name__ == "__main__":
    unittest.main()
