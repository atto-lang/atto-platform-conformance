"""Host-only concurrency tests, never evidence of compiled Atto guest parity."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "model"))
from actor_registry_v1 import ActorRegistry, LogicalKey, RecursiveCreation, ClosedActor

CONTRACT = json.loads((ROOT / "contracts/actor-registry-v1.json").read_text())
KEY = LogicalKey("vhost/main", "QueueActor", "orders.pending")


class ActorRegistryV1Tests(unittest.TestCase):
    def test_contract_status_and_scenarios(self):
        self.assertEqual(CONTRACT["schema"], "atto.actor-registry.v1")
        self.assertEqual(CONTRACT["status"], "CANDIDATE_HOST_MODEL_ONLY")
        self.assertEqual(CONTRACT["evidence"]["atto_source_guest_execution"], "NOT_EXECUTED")
        self.assertEqual(len(CONTRACT["required_scenarios"]), 11)

    def test_same_key_concurrent_creation(self):
        registry = ActorRegistry()
        count = 0
        count_lock = threading.Lock()
        start = threading.Barrier(16)

        def make(_):
            nonlocal count
            with count_lock:
                count += 1
            time.sleep(0.025)
            return object()

        def lookup(_):
            start.wait(timeout=5)
            return registry.get_or_create(KEY, make)

        with ThreadPoolExecutor(max_workers=16) as pool:
            refs = list(pool.map(lookup, range(16)))
        self.assertEqual(count, 1)
        self.assertEqual(len(set(refs)), 1)
        self.assertTrue(registry.is_live(refs[0].ref))

    def test_independent_keys(self):
        registry = ActorRegistry()
        other = LogicalKey("vhost/main", "QueueActor", "payments")
        a = registry.get_or_create(KEY, lambda _: object())
        b = registry.get_or_create(other, lambda _: object())
        self.assertNotEqual(a.ref.actor_id, b.ref.actor_id)

    def test_independent_keys_do_not_wait_for_unrelated_factory(self):
        registry = ActorRegistry()
        blocked = threading.Event()
        release = threading.Event()
        other = LogicalKey("vhost/main", "QueueActor", "notifications")

        def slow(_):
            blocked.set()
            if not release.wait(timeout=5):
                raise RuntimeError("test timed out")
            return object()

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(lambda: registry.get_or_create(KEY, slow))
            self.assertTrue(blocked.wait(timeout=5))
            fast = pool.submit(lambda: registry.get_or_create(other, lambda _: object()))
            self.assertEqual(fast.result(timeout=2).key, other)
            release.set()
            self.assertEqual(first.result(timeout=5).key, KEY)

    def test_factory_failure_wakes_waiters(self):
        registry = ActorRegistry()
        started = threading.Event()
        release = threading.Event()
        errors = []

        def failing(_):
            started.set()
            if not release.wait(timeout=5):
                raise RuntimeError("test timed out")
            raise ValueError("intentional failure")

        def failed_call():
            try:
                registry.get_or_create(KEY, failing)
            except ValueError as exc:
                errors.append(str(exc))

        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(failed_call)
            self.assertTrue(started.wait(timeout=5))
            b = pool.submit(lambda: registry.get_or_create(KEY, lambda _: object()))
            release.set()
            a.result(timeout=5)
            good = b.result(timeout=5)
        self.assertEqual(errors, ["intentional failure"])
        self.assertEqual(registry.lookup(KEY), good)

    def test_recursive_same_key_rejected(self):
        registry = ActorRegistry()

        def make(_):
            with self.assertRaises(RecursiveCreation):
                registry.get_or_create(KEY, lambda _: object())
            return object()

        self.assertIsNotNone(registry.get_or_create(KEY, make))

    def test_stale_unregister_cannot_remove_successor(self):
        registry = ActorRegistry()
        first = registry.get_or_create(KEY, lambda _: object())
        self.assertTrue(registry.retire(first))
        replacement = registry.get_or_create(KEY, lambda _: object())
        self.assertEqual(replacement.ref.incarnation, first.ref.incarnation + 1)
        self.assertFalse(registry.retire(first))
        self.assertEqual(registry.lookup(KEY), replacement)

    def test_wrong_epoch_rejected(self):
        old_registry = ActorRegistry(runtime_epoch="epoch-1")
        new_registry = ActorRegistry(runtime_epoch="epoch-2")
        old = old_registry.get_or_create(KEY, lambda _: object())
        new = new_registry.get_or_create(KEY, lambda _: object())
        self.assertFalse(new_registry.retire(old))
        self.assertNotEqual(old.ref, new.ref)
        self.assertEqual(new_registry.lookup(KEY), new)

    def test_physical_handle_stale_after_retire(self):
        registry = ActorRegistry()
        first = registry.get_or_create(KEY, lambda _: object())
        self.assertTrue(registry.is_live(first.ref))
        registry.retire(first)
        self.assertFalse(registry.is_live(first.ref))
        replacement = registry.get_or_create(KEY, lambda _: object())
        self.assertFalse(registry.is_live(first.ref))
        self.assertTrue(registry.is_live(replacement.ref))

    def test_namespaces_and_types_isolated(self):
        registry = ActorRegistry()
        variants = [KEY,
                    LogicalKey("vhost/other", "QueueActor", "orders.pending"),
                    LogicalKey("vhost/main", "OtherActor", "orders.pending")]
        refs = [registry.get_or_create(k, lambda _: object()) for k in variants]
        self.assertEqual(len({r.ref for r in refs}), 3)
        with self.assertRaises(ValueError):
            LogicalKey("", "QueueActor", "orders.pending")
        with self.assertRaises(ValueError):
            LogicalKey("main", "QueueActor", "x" * 5000)

    def test_virtual_ref_not_implicit_activation(self):
        registry = ActorRegistry()
        virtual = registry.ref_for(KEY)
        self.assertEqual(virtual.key, KEY)
        self.assertIsNone(registry.lookup(KEY))
        registry.get_or_create(KEY, lambda _: object())
        self.assertEqual(virtual.key, KEY)

    def test_closed_actor_rejected(self):
        registry = ActorRegistry()

        class Closed:
            closed = True

        with self.assertRaises(ClosedActor):
            registry.get_or_create(KEY, lambda _: Closed())
        self.assertIsNone(registry.lookup(KEY))
        self.assertIsNotNone(registry.get_or_create(KEY, lambda _: object()))


if __name__ == "__main__":
    unittest.main()
