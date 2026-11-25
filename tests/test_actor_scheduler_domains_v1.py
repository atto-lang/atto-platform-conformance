"""Source-free Atto scheduler-domain admission oracle; NOT guest/runtime/sandbox proof.

Run: python3 -m unittest discover -s tests -p 'test_actor_scheduler_domains_v1.py' -v
"""
from collections import deque
from pathlib import Path
import json
import unittest

MANIFEST = json.loads((Path(__file__).resolve().parents[1] /
                       "contracts/actor-scheduler-domains-v1.json").read_text())


class AdmissionError(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise AdmissionError(code)


class Handle:
    """Host-minted identity stand-in. An object handle is NOT a real capability."""
    def __init__(self, name, generation=1, tenant=None, domain=None):
        self.name, self.generation = name, generation
        self.tenant, self.domain = tenant, domain
        self.active = True


class Pool:
    def __init__(self, domain, workers):
        self.domain, self.workers = domain, workers
        self.data = deque()
        self.reactor_polls = 0


class SchedulerOracle:
    def __init__(self, cores=4, background_budget=8, queue_limit=2,
                 control_limit=4, sandbox_available=False):
        require(type(cores) is int and cores >= 1, "CORES")
        require(type(background_budget) is int and background_budget >= 1, "BUDGET")
        require(type(queue_limit) is int and queue_limit >= 1, "QUEUE_LIMIT")
        require(type(control_limit) is int and control_limit >= 1, "CONTROL_LIMIT")
        self.baseline = 1 if cores == 1 else 2
        require(background_budget >= self.baseline, "BUDGET")
        self.budget, self.started = background_budget, self.baseline
        self.queue_limit, self.control_limit = queue_limit, control_limit
        self.sandbox_available = sandbox_available
        self.pools = {("shared",): Pool(("shared",), self.baseline)}
        self.tenants, self.generations = {}, {}
        self.actors, self.supervisors = set(), set()
        self.control = {}
        self.burst, self.last_supervisor = {}, {}
        self.events, self.cancelled, self.escalations = [], [], []

    @property
    def startup_threads_including_caller(self):
        return self.baseline + 1

    def tenant_vm(self, account):
        require(isinstance(account, str) and bool(account) and
                account not in (".", ".."), "ACCOUNT")
        require(self.sandbox_available, "UNVERIFIED_SANDBOX")
        require(account not in self.tenants or not self.tenants[account].active,
                "TENANT_EXISTS")
        generation = self.generations.get(account, 0) + 1
        self.generations[account] = generation
        tenant = Handle(account, generation)
        self.tenants[account] = tenant
        return tenant

    def check_tenant(self, tenant):
        require(isinstance(tenant, Handle) and tenant.active and
                self.tenants.get(tenant.name) is tenant, "STALE_TENANT")

    def actor(self, name, mode="shared", tenant=None):
        require(mode in ("shared", "isolated", "untrusted"), "MODE")
        require(isinstance(name, str) and bool(name), "ACTOR")
        if mode == "untrusted":
            self.check_tenant(tenant)
            domain = ("tenant", tenant.name, tenant.generation)
        else:
            require(tenant is None, "TENANT_MISMATCH")
            domain = ("shared",) if mode == "shared" else ("isolated", object())
        actor = Handle(name, tenant=tenant, domain=domain)
        actor.mode = mode
        self.actors.add(actor)
        return actor

    def check_actor(self, actor):
        require(actor in self.actors and actor.active, "STALE_ACTOR")
        if actor.tenant is not None:
            self.check_tenant(actor.tenant)

    def supervisor(self, name, domain=("shared",)):
        require(domain in self.pools, "SUPERVISOR_DOMAIN")
        sup = Handle(name, domain=domain)
        self.supervisors.add(sup)
        self.control[sup] = deque()
        return sup

    def submit(self, actor, message):
        self.check_actor(actor)
        domain = actor.domain
        if domain not in self.pools:
            require(self.started < self.budget, "THREAD_BUDGET")
            self.pools[domain] = Pool(domain, 1)
            self.started += 1
        pool = self.pools[domain]
        require(len(pool.data) < self.queue_limit, "QUEUE_FULL")
        pool.data.append((actor, message))
        return domain

    def fail(self, actor, sup, reason="panic"):
        """Trusted host only: a guest must not directly invoke this operation."""
        self.check_actor(actor)
        require(sup in self.supervisors and sup.active, "SUPERVISOR")
        q = self.control[sup]
        if any(ref is actor for ref, _ in q):
            return "coalesced"
        if len(q) >= self.control_limit:
            # Real runtimes must synchronously escalate to an enforceable
            # process/tenant failure policy, not merely record this event.
            self.escalations.append((sup, actor, reason))
            self.close_actor(actor)
            return "escalated"
        q.append((actor, reason))
        return "accepted"

    def step(self, domain=("shared",)):
        require(domain in self.pools, "NO_CARRIER")
        pool = self.pools[domain]
        ready = sorted((sup for sup, queue in self.control.items()
                        if sup.active and sup.domain == domain and queue),
                       key=lambda sup: (sup.name, id(sup)))
        burst = self.burst.get(domain, 0)
        if ready and (burst < self.control_limit or not pool.data):
            previous = self.last_supervisor.get(domain)
            index = next((i for i, sup in enumerate(ready)
                          if sup is previous), -1)
            sup = ready[(index + 1) % len(ready)]
            self.last_supervisor[domain] = sup
            actor, reason = self.control[sup].popleft()
            self.events.append(("CONTROL", sup.name, actor.name, reason))
            self.burst[domain] = burst + 1
            pool.reactor_polls += 1
            return "control"
        self.burst[domain] = 0
        if pool.data:
            actor, message = pool.data.popleft()
            if actor.active and (actor.tenant is None or actor.tenant.active):
                self.events.append(("DATA", actor.name, message, domain))
                pool.reactor_polls += 1
                return "data"
            self.cancelled.append((actor, message))
            return "cancelled"
        pool.reactor_polls += 1
        return "idle"

    def close_actor(self, actor):
        self.check_actor(actor)
        actor.active = False
        pool = self.pools.get(actor.domain)
        if pool is not None:
            remaining = deque()
            while pool.data:
                ref, msg = pool.data.popleft()
                if ref is actor:
                    self.cancelled.append((ref, msg))
                else:
                    remaining.append((ref, msg))
            pool.data = remaining
            if actor.mode == "isolated":
                require(not pool.data, "PRIVATE_POOL_LEAK")
                self.started -= pool.workers
                del self.pools[actor.domain]

    def retire_tenant(self, tenant):
        self.check_tenant(tenant)
        for actor in list(self.actors):
            if actor.tenant is tenant and actor.active:
                self.close_actor(actor)
        tenant.active = False
        domain = ("tenant", tenant.name, tenant.generation)
        pool = self.pools.pop(domain, None)
        if pool is not None:
            require(not pool.data, "PENDING_TENANT_WORK")
            self.started -= pool.workers
        for sup in self.supervisors:
            if sup.domain == domain:
                sup.active = False
                self.control[sup].clear()


class DomainTests(unittest.TestCase):
    def setUp(self):
        self.m = SchedulerOracle(sandbox_available=True)

    def rejects(self, code, fn):
        with self.assertRaises(AdmissionError) as cm:
            fn()
        self.assertEqual(str(cm.exception), code)

    def test_manifest_is_not_falsely_passed(self):
        self.assertEqual(MANIFEST["schema"], "atto.actor-scheduler-domains.v1")
        self.assertEqual(len(MANIFEST["cases"]), 14)
        self.assertEqual(len({c["id"] for c in MANIFEST["cases"]}), 14)
        self.assertTrue(all(v["status"] == "NOT_EXECUTED"
                            for v in MANIFEST["backends"].values()))

    def test_startup_and_no_eager_private_tenant_threads(self):
        self.assertEqual(self.m.startup_threads_including_caller, 3)
        self.assertEqual(SchedulerOracle(cores=1).startup_threads_including_caller, 2)
        self.m.actor("isolated", "isolated")
        self.assertEqual(self.m.started, 2)

    def test_private_per_actor_and_global_budget(self):
        a, b = self.m.actor("a", "isolated"), self.m.actor("b", "isolated")
        self.assertNotEqual(a.domain, b.domain)
        self.m.submit(a, 1)
        self.m.submit(b, 2)
        self.assertEqual(self.m.started, 4)
        m = SchedulerOracle(background_budget=2)
        p = m.actor("p", "isolated")
        self.rejects("THREAD_BUDGET", lambda: m.submit(p, 1))
        self.assertEqual(m.pools[("shared",)].data, deque())

    def test_shared_stays_shared(self):
        a, b = self.m.actor("a"), self.m.actor("b")
        self.assertEqual(self.m.submit(a, 1), self.m.submit(b, 2))
        self.assertEqual(self.m.started, 2)

    def test_untrusted_requires_real_sandbox(self):
        m = SchedulerOracle(sandbox_available=False)
        self.rejects("UNVERIFIED_SANDBOX", lambda: m.tenant_vm("a"))
        self.rejects("STALE_TENANT", lambda: m.actor("bad", "untrusted"))

    def test_one_pool_per_tenant_generation(self):
        a, b = self.m.tenant_vm("a"), self.m.tenant_vm("b")
        x, y = self.m.actor("x", "untrusted", a), self.m.actor("y", "untrusted", b)
        self.assertNotEqual(self.m.submit(x, 1), self.m.submit(y, 2))
        self.assertEqual(self.m.started, 4)

    def test_bounded_queue_admission(self):
        a = self.m.actor("a")
        self.m.submit(a, 1)
        self.m.submit(a, 2)
        self.rejects("QUEUE_FULL", lambda: self.m.submit(a, 3))
        self.assertEqual([self.m.step(), self.m.step()], ["data", "data"])

    def test_priority_reserved_control(self):
        a, b = self.m.actor("a"), self.m.actor("b")
        sup = self.m.supervisor("root")
        self.m.submit(a, 1)
        self.m.submit(a, 2)
        self.assertEqual(self.m.fail(b, sup), "accepted")
        self.assertEqual(self.m.step(), "control")
        self.assertEqual(self.m.step(), "data")

    def test_control_coalesce_and_fail_closed_overflow(self):
        sup = self.m.supervisor("root")
        actors = [self.m.actor(str(i)) for i in range(5)]
        self.assertEqual(self.m.fail(actors[0], sup), "accepted")
        self.assertEqual(self.m.fail(actors[0], sup), "coalesced")
        for actor in actors[1:4]:
            self.m.fail(actor, sup)
        self.assertEqual(self.m.fail(actors[4], sup), "escalated")
        self.assertEqual(len(self.m.escalations), 1)
        self.rejects("STALE_ACTOR", lambda: self.m.submit(actors[4], 99))

    def test_supervisor_round_robin_and_data_fairness(self):
        a = self.m.actor("mail")
        self.m.submit(a, "ok")
        first, second = self.m.supervisor("A"), self.m.supervisor("B")
        actors = [self.m.actor(f"bad{i}") for i in range(8)]
        for i in range(4):
            self.m.fail(actors[i], first)
            self.m.fail(actors[i + 4], second)
        self.assertEqual([self.m.step() for _ in range(5)],
                         ["control"] * 4 + ["data"])
        self.assertEqual({entry[1] for entry in self.m.events[:4]}, {"A", "B"})

    def test_tenant_retirement_replay_and_neighbor(self):
        a, b = self.m.tenant_vm("a"), self.m.tenant_vm("b")
        x, y = self.m.actor("x", "untrusted", a), self.m.actor("y", "untrusted", b)
        self.m.submit(x, "old")
        self.m.submit(y, "live")
        self.m.retire_tenant(a)
        self.rejects("STALE_ACTOR", lambda: self.m.submit(x, "replayed"))
        again = self.m.tenant_vm("a")
        self.assertNotEqual(again.generation, a.generation)
        self.assertEqual(self.m.step(y.domain), "data")
        self.assertIn((x, "old"), self.m.cancelled)

    def test_private_retirement_releases_carrier(self):
        m = SchedulerOracle(background_budget=3)
        a = m.actor("a", "isolated")
        m.submit(a, 1)
        m.close_actor(a)
        self.assertEqual(m.started, 2)
        self.assertEqual(m.submit(m.actor("b", "isolated"), 2)[0], "isolated")

    def test_reactor_poll_has_no_dedicated_carrier(self):
        before = self.m.started
        self.assertEqual(self.m.step(), "idle")
        self.assertEqual(self.m.started, before)
        self.assertEqual(self.m.pools[("shared",)].reactor_polls, 1)


if __name__ == "__main__":
    unittest.main()
