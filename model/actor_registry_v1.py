"""Host-only local registry *reference model*. No compiled Atto guest execution."""
from dataclasses import dataclass
import threading
import uuid


class RegistryError(Exception):
    pass


class RecursiveCreation(RegistryError):
    pass


class ClosedActor(RegistryError):
    pass


@dataclass(frozen=True)
class LogicalKey:
    namespace: str
    actor_type: str
    application_key: str

    def __post_init__(self):
        values = (self.namespace, self.actor_type, self.application_key)
        if not all(isinstance(v, str) and v for v in values):
            raise ValueError("logical key components must be nonempty strings")
        if sum(len(v.encode("utf-8")) for v in values) > 4096:
            raise ValueError("logical key exceeds bounded budget")


@dataclass(frozen=True)
class PhysicalRef:
    runtime_epoch: str
    actor_id: str
    incarnation: int


@dataclass(frozen=True)
class Registration:
    key: LogicalKey
    ref: PhysicalRef
    token: str


@dataclass(frozen=True)
class VirtualRef:
    key: LogicalKey


class _Pending:
    def __init__(self):
        self.owner_thread = threading.get_ident()
        self.ready = threading.Event()


class ActorRegistry:
    """Per-key single-flight creation; no distributed leases/mailbox dispatch."""

    def __init__(self, runtime_epoch=None):
        self._epoch = runtime_epoch or str(uuid.uuid4())
        self._lock = threading.Lock()
        self._entries = {}
        self._generations = {}  # Tombstones; avoid ABA after unregister.
        self._pending = {}

    def ref_for(self, key):
        return VirtualRef(key)  # Never activates an entity.

    def lookup(self, key):
        with self._lock:
            return self._entries.get(key)

    def retire(self, registration):
        with self._lock:
            existing = self._entries.get(registration.key)
            if existing is None or existing != registration:
                return False
            del self._entries[registration.key]
            return True

    def is_live(self, ref):
        # Model liveness means registered, NOT actual mailbox admission.
        with self._lock:
            return any(r.ref == ref for r in self._entries.values())

    def get_or_create(self, key, factory):
        while True:
            with self._lock:
                existing = self._entries.get(key)
                if existing is not None:
                    return existing
                pending = self._pending.get(key)
                if pending is None:
                    pending = _Pending()
                    self._pending[key] = pending
                    creator = True
                else:
                    creator = False
                    if pending.owner_thread == threading.get_ident():
                        raise RecursiveCreation("same-key recursive creation")
            if not creator:
                pending.ready.wait()
                continue
            try:
                # Factory runs OUTSIDE global lock, so unrelated keys progress.
                actor = factory(key)
                if actor is None or bool(getattr(actor, "closed", False)):
                    raise ClosedActor("factory did not produce a live actor")
                with self._lock:
                    incarnation = self._generations.get(key, 0) + 1
                    self._generations[key] = incarnation
                    reg = Registration(
                        key,
                        PhysicalRef(self._epoch, str(uuid.uuid4()), incarnation),
                        str(uuid.uuid4())
                    )
                    self._entries[key] = reg
                    return reg
            finally:
                # Publish or failure: wake all same-key waiters to recheck.
                with self._lock:
                    del self._pending[key]
                    pending.ready.set()
