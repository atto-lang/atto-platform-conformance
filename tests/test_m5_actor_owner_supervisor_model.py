"""M5 finite semantic *reference model*: NOT compiled AttoLang guest execution."""
from collections import deque
import json
from pathlib import Path
import random
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "contracts/m5-ownership-supervisor-v1.json").read_text())

class Rejected(ValueError):
    pass

class Owner:
    def __init__(self):
        self.live = True
        self.readers = 0
        self.writer = False
        self.frozen = False  # permanent value conversion, not a revocable read loan

    def ensure(self):
        if not self.live:
            raise Rejected("linear owner has moved or retired")

    def borrow(self, mutable=False):
        self.ensure()
        if self.writer or (mutable and self.readers):
            raise Rejected("conflicting exclusive loan")
        if mutable:
            self.writer = True
        else:
            self.readers += 1

    def release(self, mutable=False):
        self.ensure()
        if mutable:
            if not self.writer:
                raise Rejected("no mutable loan")
            self.writer = False
        else:
            if not self.readers:
                raise Rejected("no read loan")
            self.readers -= 1

    def take(self):
        self.ensure()
        if self.readers or self.writer:
            raise Rejected("cannot move a borrowed/shared owner")
        self.live = False
        return Owner()

    def share(self):
        # Pony-inspired `val`: immutable sharing is a *permanent conversion*.
        # The graph-level reference model performs transitive alias validation;
        # this scalar owner test only checks permanent sender invalidation.
        self.ensure()
        if self.writer or self.readers:
            raise Rejected("cannot deep-freeze while loans are outstanding")
        self.frozen = True
        self.live = False
        return "val"

    def unshare(self):
        raise Rejected("deep frozen val cannot thaw or recover mutable ownership")

    def write(self):
        self.ensure()
        if self.readers or self.shares or self.writer:
            raise Rejected("write conflicts with outstanding loan")

    def across_suspend(self):
        self.ensure()
        if self.readers or self.writer or self.shares:
            raise Rejected("unpinned ownership loan across await/select")

class Tenant:
    def __init__(self, tenant_id, capacity=2, generation=1, state=0):
        if capacity < 1 or capacity > 4096:
            raise Rejected("invalid mailbox capacity")
        self.tenant_id = tenant_id
        self.generation = generation
        self.capacity = capacity
        self.state = state
        self.mail = deque()
        self.accepted = 0
        self.completed = 0
        self.failed = 0
        self.abandoned = 0
        self.rejected_full = 0
        self.rejected_stale = 0
        self.stopping = False
        self.control = deque()

    def token(self):
        return (self.tenant_id, self.generation)

    def send(self, token, value):
        if token != self.token() or self.stopping:
            self.rejected_stale += 1
            return "StaleHandle"
        if len(self.mail) == self.capacity:
            self.rejected_full += 1
            return "MailboxFull"
        self.mail.append(value)
        self.accepted += 1
        self.invariant()
        return "Ok"

    def step(self):
        if not self.mail:
            return "Idle"
        payload = self.mail.popleft()
        if payload == "#panic":
            self.failed += 1
            self.control.append(("panic", self.tenant_id, self.generation))
            self.stopping = True
            self.abandoned += len(self.mail)
            self.mail.clear()
            self.invariant()
            return "ActorTerminated"
        next_value = self.state + payload
        if next_value < -(1 << 63) or next_value >= (1 << 63):
            self.failed += 1
            self.control.append(("panic", self.tenant_id, self.generation))
            self.stopping = True
            self.abandoned += len(self.mail)
            self.mail.clear()
            self.invariant()
            return "ActorTerminated"
        self.state = next_value
        self.completed += 1
        self.invariant()
        return "Ok"

    def drain(self):
        while self.mail:
            if self.step() == "ActorTerminated":
                break
        self.stopping = True
        self.invariant()

    def restart(self):
        if not self.stopping:
            raise Rejected("tenant restart requires retired generation")
        return Tenant(self.tenant_id, self.capacity, self.generation + 1)

    def invariant(self):
        assert len(self.mail) <= self.capacity
        assert self.accepted == self.completed + self.failed + self.abandoned + len(self.mail)
        assert self.failed == len(self.control)
        assert self.rejected_full >= 0 and self.rejected_stale >= 0

class M5OwnershipAndSupervisionTests(unittest.TestCase):
    def test_contract_identity_and_nonclaims(self):
        s = CONTRACT
        self.assertEqual(s["schema"], "atto.m5.actor-ownership-supervision-contract.v1")
        self.assertIn("rt take", " ".join(s["rules"]["ownership"]))
        self.assertIn("critical-write", " ".join(s["rules"]["actor_state"]))
        self.assertIn("CONTROL", " ".join(s["rules"]["supervision"]))
        self.assertEqual(s["proposed_release_targets"]["actor_lifetimes"], 100000)
        self.assertEqual(s["source_compiler_backends"]["graalvm-native"]["owner_sealed_state_full"],
                         "NOT_EXECUTED")

    def test_take_invalidates_sender(self):
        o = Owner()
        successor = o.take()
        with self.assertRaises(Rejected): o.borrow()
        successor.borrow()
        successor.release()

    def test_take_twice_refused(self):
        o = Owner()
        o.take()
        with self.assertRaises(Rejected): o.take()

    def test_move_during_read_borrow_refused(self):
        o = Owner()
        o.borrow()
        with self.assertRaises(Rejected): o.take()
        o.release()
        o.take()

    def test_concurrent_read_loans_allowed(self):
        o = Owner()
        o.borrow()
        o.borrow()
        self.assertEqual(o.readers, 2)
        o.release()
        o.release()
        o.write()

    def test_mutable_loan_is_exclusive(self):
        o = Owner()
        o.borrow(mutable=True)
        with self.assertRaises(Rejected): o.borrow()
        with self.assertRaises(Rejected): o.borrow(mutable=True)
        with self.assertRaises(Rejected): o.take()
        o.release(mutable=True)
        o.take()

    def test_readers_block_mutable_borrow(self):
        o = Owner()
        o.borrow()
        with self.assertRaises(Rejected): o.borrow(mutable=True)

    def test_share_freezes_mutation(self):
        o = Owner()
        o.share()
        with self.assertRaises(Rejected): o.write()
        with self.assertRaises(Rejected): o.take()
        with self.assertRaises(Rejected): o.unshare()
        with self.assertRaises(Rejected): o.write()
        with self.assertRaises(Rejected): o.borrow()

    def test_read_borrow_blocks_permanent_deep_share(self):
        o = Owner()
        o.borrow()
        with self.assertRaises(Rejected): o.share()
        o.release()
        self.assertEqual(o.share(), "val")
        with self.assertRaises(Rejected): o.take()

    def test_double_freeze_denied(self):
        o = Owner()
        self.assertEqual(o.share(), "val")
        with self.assertRaises(Rejected): o.share()

    def test_mut_loan_blocks_share(self):
        o = Owner()
        o.borrow(mutable=True)
        with self.assertRaises(Rejected): o.share()

    def test_loan_cannot_cross_suspend(self):
        for mode in ("read", "mut", "share"):
            o = Owner()
            if mode == "read": o.borrow()
            elif mode == "mut": o.borrow(mutable=True)
            else: o.share()  # frozen owner cannot be used as a loan
            with self.subTest(mode=mode), self.assertRaises(Rejected):
                o.across_suspend()

    def test_nonborrowed_owner_can_suspend(self):
        Owner().across_suspend()

    def test_invalid_release_refused(self):
        o = Owner()
        with self.assertRaises(Rejected): o.release()
        with self.assertRaises(Rejected): o.release(mutable=True)
        with self.assertRaises(Rejected): o.unshare()

    def test_exact_full_mailbox_refusal(self):
        t = Tenant("alpha", capacity=1)
        cap = t.token()
        self.assertEqual(t.send(cap, 7), "Ok")
        self.assertEqual(t.send(cap, 8), "MailboxFull")
        t.step()
        self.assertEqual(t.state, 7)
        self.assertEqual(t.accepted, 1)
        self.assertEqual(t.rejected_full, 1)

    def test_actor_stops_and_rejects_stale_capability(self):
        t = Tenant("alpha")
        cap = t.token()
        t.send(cap, 3)
        t.drain()
        self.assertEqual(t.send(cap, 1), "StaleHandle")
        self.assertEqual(t.state, 3)

    def test_restart_fences_generation(self):
        t = Tenant("alpha")
        cap = t.token()
        t.drain()
        new = t.restart()
        self.assertEqual(new.send(cap, 1), "StaleHandle")
        self.assertEqual(new.send(new.token(), 2), "Ok")
        new.step()
        self.assertEqual(new.state, 2)

    def test_other_tenant_token_never_admitted(self):
        a, b = Tenant("a"), Tenant("b")
        self.assertEqual(b.send(a.token(), 11), "StaleHandle")
        self.assertEqual(b.state, 0)

    def test_panic_is_control_only(self):
        t = Tenant("a", capacity=3)
        cap = t.token()
        t.send(cap, 1)
        t.send(cap, "#panic")
        t.send(cap, 7)
        t.step()
        self.assertEqual(t.step(), "ActorTerminated")
        self.assertEqual(t.state, 1)
        self.assertEqual(list(t.control), [("panic", "a", 1)])
        self.assertEqual(t.accepted, 3)
        self.assertEqual(t.completed, 1)
        self.assertEqual(t.failed, 1)
        self.assertEqual(t.abandoned, 1)

    def test_checked_arithmetic_overflow_as_panic(self):
        t = Tenant("a", state=(1 << 63)-1)
        t.send(t.token(), 1)
        self.assertEqual(t.step(), "ActorTerminated")
        self.assertEqual(t.state, (1 << 63)-1)
        self.assertEqual(t.failed, 1)

    def test_healthy_tenant_survives_neighbor_panic(self):
        a, b = Tenant("a"), Tenant("b")
        a.send(a.token(), "#panic")
        b.send(b.token(), 42)
        a.step()
        b.step()
        self.assertEqual(b.state, 42)
        self.assertEqual(b.control, deque())
        self.assertEqual(a.control[0][0], "panic")

    def test_all_accepted_messages_accounted_on_shutdown(self):
        t = Tenant("a", capacity=3)
        for v in (1, 2, 3): self.assertEqual(t.send(t.token(), v), "Ok")
        t.drain()
        self.assertEqual(t.state, 6)
        self.assertEqual(t.completed, 3)
        self.assertEqual(t.abandoned, 0)

    def test_bounded_mailbox_randomized_256_traces(self):
        randomizer = random.Random(20261107)
        for test in range(256):
            cap = randomizer.randrange(1, 17)
            t = Tenant("tenant" + str(test), cap)
            token = t.token()
            for _ in range(80):
                kind = randomizer.randrange(6)
                if kind < 4:
                    t.send(token, randomizer.randrange(-3, 4))
                else:
                    t.step()
                t.invariant()
            t.drain()
            t.invariant()
            self.assertEqual(t.accepted, t.completed + t.failed + t.abandoned, test)

if __name__ == "__main__":
    unittest.main()
