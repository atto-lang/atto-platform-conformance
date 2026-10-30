#!/usr/bin/env python3
"""Source-free executable state-region contract model (not a compiler/runtime proof).

Run: python3 -m unittest discover -s contracts/state_regions -p 'test_*.py' -v
No private source, dependencies, threads, or GitHub credentials are needed.
"""
import unittest
from dataclasses import dataclass, field

class AdmissionError(Exception):
    pass

@dataclass
class Region:
    owner: str
    readers: dict = field(default_factory=dict)
    writer: str | None = None
    pins: set = field(default_factory=set)
    retired: bool = False
    allocations: int = 1
    releases: int = 0
    value: int = 0

    def acquire(self, task, mode):
        if self.retired:
            raise AdmissionError("region retired")
        if mode == "read":
            if self.writer is not None:
                raise AdmissionError("exclusive writer live")
            self.readers[task] = self.readers.get(task, 0) + 1
        elif mode == "write":
            if self.writer is not None or self.readers:
                raise AdmissionError("conflicting loan")
            self.writer = task
        else:
            raise AdmissionError("invalid mode")
        self.pins.add(task)
        return Capability(self, task, mode)

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
    task: str
    mode: str
    released: bool = False

    def update(self, delta):
        if self.released or self.mode != "write" or self.region.writer != self.task:
            raise AdmissionError("write without live exclusive capability")
        self.region.value += delta

    def read(self):
        if self.released or self.region.retired:
            raise AdmissionError("expired read capability")
        return self.region.value

    def release(self):
        if self.released:
            raise AdmissionError("double release")
        if self.mode == "write":
            if self.region.writer != self.task:
                raise AdmissionError("wrong owner")
            self.region.writer = None
        else:
            n = self.region.readers.get(self.task, 0)
            if n < 1:
                raise AdmissionError("missing reader")
            if n == 1:
                del self.region.readers[self.task]
            else:
                self.region.readers[self.task] = n - 1
        self.released = True
        # Task may still be alive outside this scope, but must explicitly
        # maintain a separate continuation/pin if it retains region access.
        self.region.pins.discard(self.task)

@dataclass
class Handler:
    ident: str
    held: list = field(default_factory=list)
    admission_count: int = 0
    budget_checks: int = 0

    def enter(self, region, mode):
        # Acquisition is an admission opportunity even if uncontended.
        self.admit()
        cap = region.acquire(self.ident, mode)
        self.held.append(cap)
        return cap

    def leave(self, cap):
        cap.release()
        self.held.remove(cap)
        self.admit()

    def admit(self):
        if any(not c.released for c in self.held):
            raise AdmissionError("actor admission with live capability")
        self.admission_count += 1

    def cooperate(self):
        self.admit()

    def budget_checkpoint(self):
        # Worker fairness checkpoint; NOT actor reentrancy or unlocking.
        self.budget_checks += 1

class StateRegionContract(unittest.TestCase):
    def test_local_exclusive_mutation_no_lock_or_copy(self):
        r = Region("task")
        h = Handler("task")
        c = h.enter(r, "write")
        for _ in range(1000):
            c.update(1)
        self.assertEqual(c.read(), 1000)
        self.assertEqual(r.allocations, 1)
        h.leave(c)
        r.retire()
        self.assertEqual(r.releases, 1)

    def test_multiple_readers_exclude_writer(self):
        r = Region("actor")
        a = Handler("a")
        b = Handler("b")
        x = a.enter(r, "read")
        y = b.enter(r, "read")
        with self.assertRaisesRegex(AdmissionError, "conflicting loan"):
            r.acquire("c", "write")
        a.leave(x)
        b.leave(y)
        z = a.enter(r, "write")
        a.leave(z)

    def test_writer_excludes_readers_and_writers(self):
        r = Region("actor")
        cap = r.acquire("a", "write")
        for mode in ("read", "write"):
            with self.assertRaises(AdmissionError):
                r.acquire("b", mode)
        cap.release()

    def test_reentrancy_on_acquire_and_release(self):
        h = Handler("a")
        r = Region("actor")
        c = h.enter(r, "write")
        self.assertEqual(h.admission_count, 1)
        with self.assertRaisesRegex(AdmissionError, "live capability"):
            h.cooperate()
        h.budget_checkpoint()
        self.assertEqual(h.admission_count, 1)
        h.leave(c)
        self.assertEqual(h.admission_count, 2)
        self.assertEqual(h.budget_checks, 1)

    def test_no_retire_while_live_loan_or_pin(self):
        r = Region("actor")
        c = r.acquire("worker", "read")
        with self.assertRaisesRegex(AdmissionError, "live loans"):
            r.retire()
        c.release()
        r.pins.add("suspended-continuation")
        with self.assertRaisesRegex(AdmissionError, "live loans"):
            r.retire()
        r.pins.clear()
        r.retire()
        with self.assertRaisesRegex(AdmissionError, "double retire"):
            r.retire()

    def test_no_capability_use_after_release_or_retire(self):
        r = Region("a")
        c = r.acquire("a", "write")
        c.release()
        with self.assertRaises(AdmissionError):
            c.update(1)
        with self.assertRaises(AdmissionError):
            c.read()
        r.retire()
        with self.assertRaises(AdmissionError):
            r.acquire("a", "read")

    def test_same_actor_different_handlers_do_not_share_writer(self):
        r = Region("actor")
        a = r.acquire("handler-a", "write")
        with self.assertRaises(AdmissionError):
            r.acquire("handler-b", "write")
        a.release()

    def test_model_has_no_implicit_snapshot_allocation(self):
        r = Region("actor")
        h = Handler("a")
        for _ in range(100):
            c = h.enter(r, "write")
            c.update(1)
            h.leave(c)
        self.assertEqual(r.value, 100)
        self.assertEqual(r.allocations, 1)
        self.assertEqual(r.releases, 0)
        r.retire()
        self.assertEqual(r.releases, 1)

if __name__ == "__main__":
    unittest.main()
