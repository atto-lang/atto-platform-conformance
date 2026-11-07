"""Pony-inspired AttoLang actor-graph *reference model*; NOT a compiler/runtime.

Tokens are minted and authenticated by this local broker's object identity.
This models invariants, not OS sandboxing, lock-free native runtime behavior
or a real proof that a user program cannot forge arbitrary machine pointers.
"""
from copy import deepcopy
from dataclasses import dataclass, field


class Denied(ValueError):
    pass


@dataclass
class Actor:
    tenant: str
    name: str
    generation: int
    capacity: int
    active: bool = True
    queue: list = field(default_factory=list)
    accepted: int = 0
    refused_full: int = 0
    refused_stale: int = 0
    abandoned: int = 0


@dataclass
class Graph:
    tenant: str
    actor: Actor | None
    version: int
    nodes: dict
    edges: dict
    frozen: bool = False
    active_reads: int = 0
    active_writer: bool = False
    external_mutable_alias: bool = False
    destroyed: bool = False


class Token:
    """Opaque by convention; no token attribute is an authorization claim."""
    pass


class Broker:
    MAX_NODES = 128

    def __init__(self):
        self._grants = {}     # Token identity -> (kind, referent, version)
        self._actors = {}     # (tenant,name) -> latest incarnation
        self._cross_tenant_copy = set()
        self.graphs = []

    def _mint(self, kind, target, version=0):
        token = Token()
        self._grants[token] = [kind, target, version]
        return token

    def _use(self, token, kind):
        entry = self._grants.get(token)
        if entry is None or entry[0] != kind:
            raise Denied("unknown, forged, consumed or wrong-kind capability")
        target = entry[1]
        if isinstance(target, Graph):
            if target.destroyed or target.version != entry[2]:
                raise Denied("stale graph generation")
            if target.actor is not None and not target.actor.active:
                raise Denied("actor incarnation retired")
        elif isinstance(target, Actor):
            if not target.active or self._actors.get((target.tenant, target.name)) is not target:
                raise Denied("actor incarnation retired")
        return target

    def _graph_owner(self, token):
        graph = self._use(token, "owner")
        if graph.frozen or graph.actor is None:
            raise Denied("graph is not exclusively owned")
        return graph

    def actor(self, tenant, name, capacity=2):
        if not isinstance(tenant, str) or not isinstance(name, str) or not tenant or not name:
            raise Denied("tenant/actor identity invalid")
        if not isinstance(capacity, int) or not 1 <= capacity <= 4096:
            raise Denied("mailbox capacity not admitted")
        existing = self._actors.get((tenant, name))
        if existing is not None and existing.active:
            raise Denied("duplicate live actor")
        generation = 1 if existing is None else existing.generation + 1
        actor = Actor(tenant, name, generation, capacity)
        self._actors[(tenant, name)] = actor
        return self._mint("actor", actor)

    def _actor(self, token):
        return self._use(token, "actor")

    def actor_tag(self, actor_token):
        return self._mint("actor_tag", self._actor(actor_token))

    def send_using_tag(self, tag_token, sender_actor_token):
        actor = self._use(tag_token, "actor_tag")
        sender = self._actor(sender_actor_token)
        if sender.tenant != actor.tenant:
            raise Denied("actor tag is not a cross-tenant broker grant")
        return (actor.name, actor.generation)

    def read_using_tag(self, tag):
        self._use(tag, "actor_tag")
        raise Denied("tag is identity-only; cannot read actor state")

    def grant_copy(self, source_tenant, dest_tenant):
        if source_tenant == dest_tenant:
            raise Denied("not a cross-tenant permission")
        self._cross_tenant_copy.add((source_tenant, dest_tenant))

    def create_graph(self, actor_token, nodes, edges=None, external_mutable_alias=False):
        actor = self._actor(actor_token)
        if not isinstance(nodes, dict) or not 1 <= len(nodes) <= self.MAX_NODES:
            raise Denied("bounded graph node budget")
        if set(nodes) != set(range(len(nodes))) or any(type(v) is not int for v in nodes.values()):
            raise Denied("graph must use exact i64 index/value slots")
        if any(v < -(1 << 63) or v >= (1 << 63) for v in nodes.values()):
            raise Denied("graph scalar slot must fit i64")
        edges = {n: list(links) for n, links in (edges or {}).items()}  # retain opaque Token identity
        if not isinstance(edges, dict) or not set(edges).issubset(nodes):
            raise Denied("invalid graph adjacency")
        for links in edges.values():
            if not isinstance(links, list) or len(links) > self.MAX_NODES:
                raise Denied("graph adjacency budget")
            for edge in links:
                if not isinstance(edge, tuple) or len(edge) != 2 or edge[0] not in (
                        "local", "external_mutable", "val", "tag"):
                    raise Denied("edge capability kind invalid")
                if edge[0] == "local" and edge[1] not in nodes:
                    raise Denied("dangling local edge")
        graph = Graph(actor.tenant, actor, 1, deepcopy(nodes), edges,
                      external_mutable_alias=external_mutable_alias)
        self.graphs.append(graph)
        return self._mint("owner", graph, 1)

    def borrow(self, owner, mutable=False):
        graph = self._graph_owner(owner)
        if graph.active_writer or (mutable and graph.active_reads):
            raise Denied("conflicting graph borrow")
        if mutable:
            graph.active_writer = True
            return self._mint("borrow_mut", graph, graph.version)
        graph.active_reads += 1
        return self._mint("borrow", graph, graph.version)

    def release(self, loan):
        entry = self._grants.get(loan)
        if entry is None or entry[0] not in ("borrow", "borrow_mut"):
            raise Denied("unknown or consumed graph loan")
        graph = self._use(loan, entry[0])
        if entry[0] == "borrow":
            if graph.active_reads < 1:
                raise Denied("read borrow counter underflow")
            graph.active_reads -= 1
        else:
            if not graph.active_writer:
                raise Denied("write borrow counter underflow")
            graph.active_writer = False
        del self._grants[loan]

    def read(self, token, node=0):
        entry = self._grants.get(token)
        if entry is None or entry[0] not in ("owner", "borrow", "borrow_mut", "val"):
            raise Denied("capability does not permit field reading")
        graph = self._use(token, entry[0])
        if node not in graph.nodes:
            raise Denied("out-of-bounds graph read")
        if entry[0] == "owner" and graph.active_writer:
            raise Denied("owner cannot read while mutable loan is held")
        return graph.nodes[node]

    def write(self, token, node, value):
        entry = self._grants.get(token)
        if entry is None or entry[0] not in ("owner", "borrow_mut"):
            raise Denied("write through frozen/read/opaque or invalid authority")
        graph = self._use(token, entry[0])
        if graph.frozen or node not in graph.nodes or type(value) is not int:
            raise Denied("write denied")
        if entry[0] == "owner" and (graph.active_reads or graph.active_writer):
            raise Denied("owner write during outstanding loan")
        if entry[0] == "borrow_mut" and not graph.active_writer:
            raise Denied("exclusive loan no longer held")
        if not -(1 << 63) <= value < (1 << 63):
            raise Denied("i64 overflow")
        graph.nodes[node] = value

    def _closure(self, graph):
        if graph.external_mutable_alias:
            raise Denied("mutable external alias makes graph non-isolated")
        seen = set()
        frontier = [0]
        while frontier:
            n = frontier.pop()
            if n in seen:
                continue
            seen.add(n)
            for kind, target in graph.edges.get(n, []):
                if kind == "local":
                    frontier.append(target)
                elif kind == "external_mutable":
                    raise Denied("transitive mutable alias escapes exclusive graph")
                elif kind == "val":
                    self._use(target, "val")
                elif kind == "tag":
                    self._use(target, "actor_tag")
        if len(seen) != len(graph.nodes):
            # Conservative: frozen material includes all reachable and
            # unreachable slots in the same allocation. Audit all nodes.
            for links in graph.edges.values():
                for kind, target in links:
                    if kind == "external_mutable":
                        raise Denied("mutable external alias anywhere in graph")
                    if kind == "val":
                        self._use(target, "val")
                    if kind == "tag":
                        self._use(target, "actor_tag")

    def share_immutable(self, owner):
        """rt share is deep *permanent* freeze. It cannot be unshared/thawed."""
        graph = self._graph_owner(owner)
        if graph.active_reads or graph.active_writer:
            raise Denied("deep freeze requires discharged loans")
        self._closure(graph)             # preflight all edges before mutation
        graph.frozen = True
        graph.actor = None
        graph.version += 1
        del self._grants[owner]
        return self._mint("val", graph, graph.version)

    def borrow_across_suspend(self, loan):
        entry = self._grants.get(loan)
        if entry and entry[0] in ("borrow", "borrow_mut"):
            self._use(loan, entry[0])
            raise Denied("unpinned graph loan crosses await/select")
        raise Denied("missing active loan")

    def transfer(self, owner, dest_actor):
        """Linearization: on rejection, preserve owner graph and both versions."""
        graph = self._graph_owner(owner)
        receiver = self._actor(dest_actor)
        if graph.active_reads or graph.active_writer:
            raise Denied("cannot send borrowed mutable graph")
        self._closure(graph)             # validate every graph edge first
        if graph.tenant != receiver.tenant and (
                graph.tenant, receiver.tenant) not in self._cross_tenant_copy:
            raise Denied("cross-tenant graph copy capability required")
        if len(receiver.queue) >= receiver.capacity:
            receiver.refused_full += 1
            return "MailboxFull"
        if graph.tenant != receiver.tenant and any(
                kind in ("val", "tag") for links in graph.edges.values()
                for kind, _ in links):
            raise Denied("cross-tenant copy of embedded capabilities requires explicit serialization")
        if graph.tenant == receiver.tenant:
            graph.version += 1
            graph.actor = receiver
            incoming = self._mint("owner", graph, graph.version)
        else:
            # Distinct object graph, no shared mutable backing pointer.
            clone = Graph(receiver.tenant, receiver, 1, deepcopy(graph.nodes),
                          {n: list(links) for n, links in graph.edges.items()})
            self.graphs.append(clone)
            incoming = self._mint("owner", clone, 1)
            graph.destroyed = True
        del self._grants[owner]
        receiver.queue.append(incoming)
        receiver.accepted += 1
        return "Ok"

    def send_immutable(self, value, dest_actor):
        graph = self._use(value, "val")
        receiver = self._actor(dest_actor)
        if graph.tenant != receiver.tenant and (
                graph.tenant, receiver.tenant) not in self._cross_tenant_copy:
            raise Denied("cross-tenant immutable copy capability required")
        if graph.tenant != receiver.tenant and any(
                kind in ("val", "tag") for links in graph.edges.values()
                for kind, _ in links):
            raise Denied("cross-tenant copy of embedded capabilities requires explicit serialization")
        if len(receiver.queue) >= receiver.capacity:
            receiver.refused_full += 1
            return "MailboxFull"
        if graph.tenant == receiver.tenant:
            delivered = self._mint("val", graph, graph.version)
        else:
            delivered_graph = Graph(receiver.tenant, None, 1,
                                    deepcopy(graph.nodes), {n: list(links) for n, links in graph.edges.items()},
                                    frozen=True)
            self.graphs.append(delivered_graph)
            delivered = self._mint("val", delivered_graph, 1)
        receiver.queue.append(delivered)
        receiver.accepted += 1
        return "Ok"

    def receive(self, actor_token):
        actor = self._actor(actor_token)
        if not actor.queue:
            raise Denied("empty actor mailbox")
        return actor.queue.pop(0)

    def mailbox_depth(self, actor_token):
        return len(self._actor(actor_token).queue)

    def retire(self, actor_token):
        actor = self._actor(actor_token)
        actor.abandoned += len(actor.queue)
        for pending in actor.queue:
            self._grants.pop(pending, None)
        actor.queue.clear()
        actor.active = False
        for graph in self.graphs:
            if graph.actor is actor:
                graph.destroyed = True
        self._grants.pop(actor_token, None)

    def recover_captures(self, captures):
        """A stricter fail-closed model of recover, not emitted language syntax."""
        for token in captures:
            entry = self._grants.get(token)
            if not entry or entry[0] not in ("val", "actor_tag"):
                raise Denied("recover may capture only immutable values or opaque tags")
            self._use(token, entry[0])
        return True
