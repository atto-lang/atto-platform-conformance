"""Finite actor/ADT boundary contract tests. NOT compiled AttoLang guest execution."""
import json
import random
import unittest

MAX_DEPTH = 16
MAX_BYTES = 4096
JOB_VARIANTS = {
    "Completed": {"id": "int", "result": "Result<int,string>"},
    "Deferred": {},
    "Failed": {"reason": "string", "retryable": "bool"},
}

class Rejected(ValueError):
    pass

def split_generic(ty, constructor, arity):
    prefix = constructor + "<"
    if not ty.startswith(prefix) or not ty.endswith(">"):
        raise Rejected("bad type constructor")
    inside = ty[len(prefix):-1]
    depth = 0
    parts = []
    begin = 0
    for i, ch in enumerate(inside):
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth -= 1
            if depth < 0:
                raise Rejected("bad type nesting")
        elif ch == "," and depth == 0:
            parts.append(inside[begin:i])
            begin = i + 1
    parts.append(inside[begin:])
    if depth != 0 or len(parts) != arity or any(not x for x in parts):
        raise Rejected("bad type arity")
    return parts

def fields(obj, names):
    if not isinstance(obj, dict) or set(obj) != set(names):
        raise Rejected("incorrect or extra fields")

def validate(ty, value, depth=0):
    if depth > MAX_DEPTH:
        raise Rejected("ADT nesting too deep")
    if ty == "int":
        if type(value) is not int or value < -(1 << 63) or value > (1 << 63) - 1:
            raise Rejected("expected signed 64-bit int")
    elif ty == "bool":
        if type(value) is not bool:
            raise Rejected("expected bool")
    elif ty == "string":
        if type(value) is not str:
            raise Rejected("expected string")
        try:
            value.encode("utf-8", errors="strict")
        except UnicodeEncodeError as ex:
            raise Rejected("invalid unicode") from ex
    elif ty.startswith("Option<"):
        (inner,) = split_generic(ty, "Option", 1)
        if value.get("variant") == "None" if isinstance(value, dict) else False:
            fields(value, ["variant"])
        else:
            fields(value, ["variant", "payload"])
            if value["variant"] != "Some":
                raise Rejected("unexpected Option tag")
            validate(inner, value["payload"], depth+1)
    elif ty.startswith("Result<"):
        good, bad = split_generic(ty, "Result", 2)
        fields(value, ["variant", "payload"])
        tag = value["variant"]
        if tag not in ("Ok", "Err"):
            raise Rejected("unexpected Result tag")
        validate(good if tag == "Ok" else bad, value["payload"], depth+1)
    elif ty == "JobOutcome":
        fields(value, ["variant"] if isinstance(value, dict) and value.get("variant") == "Deferred"
               else ["variant", "payload"])
        tag = value["variant"]
        if tag not in JOB_VARIANTS:
            raise Rejected("unexpected JobOutcome tag")
        spec = JOB_VARIANTS[tag]
        if spec:
            fields(value["payload"], spec)
            for name, member_ty in spec.items():
                validate(member_ty, value["payload"][name], depth+1)
    else:
        raise Rejected("unknown or forbidden nominal type")

def decode(ty, blob):
    if not isinstance(blob, bytes) or len(blob) > MAX_BYTES:
        raise Rejected("invalid or oversized wire message")
    try:
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise Rejected("duplicate JSON key")
                result[key] = value
            return result
        value = json.loads(blob.decode("utf-8", "strict"), object_pairs_hook=unique,
                           parse_constant=lambda _: (_ for _ in ()).throw(Rejected("nonfinite")))
    except (UnicodeError, json.JSONDecodeError, RecursionError) as ex:
        raise Rejected("invalid encoding") from ex
    validate(ty, value)
    return value

def encode(ty, value):
    validate(ty, value)
    try:
        blob = json.dumps(value, separators=(",", ":"), ensure_ascii=False,
                          allow_nan=False).encode("utf-8", "strict")
    except (UnicodeError, ValueError) as ex:
        raise Rejected("invalid encoding") from ex
    if len(blob) > MAX_BYTES:
        raise Rejected("oversized wire message")
    return blob

class Boundary:
    """Bounded reference model: authority stays in host methods, never guest DATA."""
    def __init__(self, message_type, capacity=2):
        if not 1 <= capacity <= 4096:
            raise Rejected("invalid capacity")
        self.ty = message_type
        self.capacity = capacity
        self.generation = 1
        self.next_id = 1
        self.queue = []
        self.running = None
        self.control = []
        self.delivered_control = []
        self.accepted = self.completed = self.failed = self.discarded = 0
        self.retired = False

    def accounting(self):
        assert self.accepted == (self.completed + self.failed + self.discarded
                                 + len(self.queue) + (self.running is not None))
        assert len(self.queue) <= self.capacity

    def send(self, generation, data):
        if generation != self.generation or self.retired or self.control:
            raise Rejected("stale or stopped actor")
        decoded = decode(self.ty, data)
        if len(self.queue) == self.capacity:
            raise Rejected("mailbox full")
        ident = self.next_id
        self.next_id += 1
        self.queue.append((ident, decoded))
        self.accepted += 1
        self.accounting()
        return ident

    def receive(self):
        if self.control or self.retired or self.running or not self.queue:
            raise Rejected("cannot start DATA turn")
        self.running = self.queue.pop(0)
        self.accounting()
        return self.running

    def complete(self, generation, message_id):
        if generation != self.generation or not self.running or self.running[0] != message_id:
            raise Rejected("stale or forged completion")
        self.running = None
        self.completed += 1
        self.accounting()

    def panic(self, generation, message_id, reason):
        if generation != self.generation or not self.running or self.running[0] != message_id:
            raise Rejected("panic requires live accepted in-flight turn")
        if not isinstance(reason, str) or len(reason.encode("utf-8")) > 256:
            raise Rejected("unbounded failure metadata")
        self.failed += 1
        self.running = None
        self.discarded += len(self.queue)
        self.queue.clear()
        self.control.append({
            "kind": "Panic", "generation": self.generation,
            "message_id": message_id, "reason": reason,
        })
        self.retired = True
        self.accounting()

    def dispatch_control(self):
        if not self.control:
            raise Rejected("no authoritative CONTROL pending")
        notice = self.control.pop(0)
        self.delivered_control.append(notice)
        return notice

    def restart(self):
        if not self.retired or self.control:
            raise Rejected("restart requires retired actor and dispatched notice")
        self.generation += 1
        self.queue.clear()
        self.running = None
        self.next_id = 1
        self.retired = False
        self.accepted = self.completed = self.failed = self.discarded = 0
        return self.generation

class AdtActorSupervisionTest(unittest.TestCase):
    def test_distinct_variants(self):
        fixtures = [
            ("Option<int>", {"variant": "None"}),
            ("Option<int>", {"variant": "Some", "payload": 0}),
            ("Result<int,string>", {"variant": "Ok", "payload": 0}),
            ("Result<int,string>", {"variant": "Err", "payload": ""}),
            ("Option<Result<int,string>>", {"variant": "None"}),
            ("Option<Result<int,string>>", {"variant": "Some", "payload":
                                          {"variant": "Ok", "payload": 0}}),
            ("Option<Result<int,string>>", {"variant": "Some", "payload":
                                          {"variant": "Err", "payload": ""}}),
            ("JobOutcome", {"variant": "Deferred"}),
            ("JobOutcome", {"variant": "Completed", "payload":
                            {"id": 2, "result": {"variant": "Err", "payload": "x"}}}),
            ("JobOutcome", {"variant": "Failed", "payload":
                            {"reason": "timeout", "retryable": True}}),
        ]
        for ty, value in fixtures:
            with self.subTest(ty=ty, value=value):
                self.assertEqual(decode(ty, encode(ty, value)), value)

    def test_bad_variants_field_sets_payload_and_family(self):
        mutations = [
            ("Option<int>", {"variant": "Missing"}),
            ("Option<int>", {"variant": "None", "payload": 4}),
            ("Option<int>", {"variant": "Some"}),
            ("Option<int>", {"variant": "Some", "payload": "4"}),
            ("Option<int>", {"variant": "Some", "payload": True}),
            ("Result<int,string>", {"variant": "Err", "payload": 2}),
            ("Result<int,string>", {"variant": "Ok", "payload": False}),
            ("Result<int,string>", {"variant": "None"}),
            ("Result<int,string>", {"variant": "Ok", "payload": 1, "extra": 0}),
            ("Option<Result<int,string>>", {"variant": "Some", "payload":
                                            {"variant": "Err", "payload": 7}}),
            ("JobOutcome", {"variant": "Completed", "payload": {"id": 1}}),
            ("JobOutcome", {"variant": "Completed", "payload":
                            {"id": 1, "result": {"variant": "Ok", "payload": 4}, "x": 0}}),
            ("JobOutcome", {"variant": "Failed", "payload":
                            {"reason": "x", "retryable": "yes"}}),
            ("JobOutcome", {"variant": "Unknown"}),
            ("JobOutcome", {"variant": "Deferred", "payload": {}}),
            ("SupervisorNotice", {"variant": "Panic"}),
            ("Option<int>", {"variant": "Some", "payload": 1 << 64}),
            ("Option<Option<int>>", {"variant": "Some", "payload": 1}),
        ]
        for ty, value in mutations:
            with self.subTest(ty=ty, value=value), self.assertRaises(Rejected):
                encode(ty, value)

    def test_encoding_malformations(self):
        for blob in [
            b'{"variant":"None","variant":"Some"}',
            b'{"variant":"Some","payload":0,"payload":1}',
            b'{"variant":"Some","payload":NaN}',
            b'{"variant":"Some","payload":9223372036854775808}',
            b'{"variant":"None"} garbage',
            b'\\xff',
            b' ' * (MAX_BYTES + 1),
        ]:
            with self.subTest(blob=blob[:50]), self.assertRaises(Rejected):
                decode("Option<int>", blob)
        with self.assertRaises(Rejected):
            decode("Option<int>", b'{"variant":"Some","payload":1.0}')

    def test_depth_budget_and_transitive_validation(self):
        ty, value = "int", 3
        for _ in range(MAX_DEPTH + 1):
            ty = f"Option<{ty}>"
            value = {"variant": "Some", "payload": value}
        with self.assertRaises(Rejected):
            encode(ty, value)
        with self.assertRaises(Rejected):
            encode("Option<ActorRef<Worker>>", {"variant": "Some", "payload": {"id": 2}})

    def test_mailbox_and_control_invariants(self):
        b = Boundary("Option<Result<int,string>>", capacity=2)
        data = encode(b.ty, {"variant": "Some", "payload": {"variant": "Err", "payload": "x"}})
        first, second = b.send(1, data), b.send(1, data)
        with self.assertRaises(Rejected):
            b.send(1, data)
        self.assertEqual(b.receive()[0], first)
        b.panic(1, first, "uncaught raise")
        with self.assertRaises(Rejected):
            b.receive()
        self.assertEqual(b.dispatch_control()["message_id"], first)
        self.assertEqual((b.accepted, b.completed, b.failed, b.discarded), (2, 0, 1, 1))
        with self.assertRaises(Rejected):
            b.send(1, data)
        self.assertEqual(b.restart(), 2)
        with self.assertRaises(Rejected):
            b.send(1, data)
        with self.assertRaises(Rejected):
            b.complete(1, first)
        new_id = b.send(2, data)
        b.receive()
        b.complete(2, new_id)
        self.assertEqual((b.accepted, b.completed, b.failed, b.discarded), (1, 1, 0, 0))

    def test_control_is_not_guest_data(self):
        b = Boundary("JobOutcome")
        forged = json.dumps({"kind": "Panic", "lane": "CONTROL", "generation": 1}).encode()
        with self.assertRaises(Rejected):
            b.send(1, forged)
        self.assertEqual(b.control, [])
        with self.assertRaises(Rejected):
            b.panic(1, 900, "fabricated")
        self.assertEqual(b.control, [])

    def test_seeded_nested_matrix_and_accounting(self):
        rng = random.Random(20261116)
        b = Boundary("Option<Result<int,string>>", capacity=8)
        for _ in range(512):
            if b.running is not None:
                b.complete(b.generation, b.running[0])
            if b.queue and rng.randrange(3):
                b.receive()
            else:
                variant = rng.choice(["None", "Ok", "Err"])
                data = ({"variant": "None"} if variant == "None"
                        else {"variant": "Some", "payload": {"variant": variant, "payload":
                              rng.randrange(-1000, 1000) if variant == "Ok" else "x"}})
                try:
                    b.send(b.generation, encode(b.ty, data))
                except Rejected:
                    pass
            b.accounting()
        while b.queue or b.running:
            if b.running:
                b.complete(b.generation, b.running[0])
            else:
                b.receive()
        self.assertEqual(b.accepted, b.completed)
        b.accounting()

if __name__ == "__main__":
    unittest.main()
