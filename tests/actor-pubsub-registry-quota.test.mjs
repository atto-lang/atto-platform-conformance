import {test} from "node:test";
import assert from "node:assert/strict";
import {PubSubReference} from "../models/actor-pubsub-portable-v1.mjs";

// Reference oracle only: executing these tests does not prove any native guest backend.
test("actor identity registry is bounded, including terminated incarnation tombstones", () => {
  const bus = new PubSubReference({maxActors:2});
  const old = bus.actor("tenant/actor", 1);
  assert.equal(old.ok, true);
  assert.equal(bus.actor("tenant/actor", 1).error, "AlreadyExists");

  assert.equal(bus.stopActor(old.actor).ok, true);
  assert.equal(bus.isActor(old.actor), false);
  assert.equal(bus.actor("tenant/actor", 1).error, "AlreadyExists",
    "stopped incarnation cannot be recycled while stale handles exist");
  const next = bus.actor("tenant/actor", 2);
  assert.equal(next.ok, true);
  assert.equal(bus.actor("other", 1).error, "ResourceExhausted",
    "registered identities, not just live actors, consume the bounded quota");
  assert.equal(bus.isActor(next.actor), true);
  assert.equal(bus.isActor(old.actor), false);
});

test("closed group authority is fenced and registered group quota is bounded", () => {
  const bus = new PubSubReference({maxGroups:1});
  const first = bus.group("g");
  assert.equal(first.ok, true);
  assert.equal(bus.group("g").error, "AlreadyExists");
  assert.equal(bus.group("new").error, "ResourceExhausted");
  assert.equal(bus.closeGroup(first.group).ok, true);
  assert.equal(bus.isGroup(first.group), false);
  assert.equal(bus.group("g").error, "AlreadyExists",
    "closed group identity must never be reused with a different authority");
  assert.equal(bus.group("new").error, "ResourceExhausted",
    "group closure cannot silently erase a tombstone");
});

test("new actor/group quotas fail closed on non-positive or non-finite inputs", () => {
  for (const key of ["maxActors", "maxGroups"]) {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1, null, "1"]) {
      assert.throws(() => new PubSubReference({[key]:value}), RangeError,
        key + "=" + String(value) + " must be refused");
    }
  }
  const bus = new PubSubReference({maxActors:1,maxGroups:1});
  assert.equal(bus.actor("a", 1).ok, true);
  assert.equal(bus.group("g").ok, true);
  assert.equal(bus.actor("b", 1).error, "ResourceExhausted");
  assert.equal(bus.group("h").error, "ResourceExhausted");
});

test("registry exhaustion does not affect unrelated topic and subscription quotas", () => {
  const bus = new PubSubReference({
    maxActors:1, maxGroups:1, maxTopics:2,
    maxSubscriptions:1, maxMemberships:1
  });
  const actor = bus.actor("a", 1).actor;
  const group = bus.group("g").group;
  assert.equal(bus.actor("b", 1).error, "ResourceExhausted");
  assert.equal(bus.group("h").error, "ResourceExhausted");

  const membership = bus.join(group,actor);
  assert.equal(membership.ok,true);
  const topic = bus.topic("events", "Event");
  assert.equal(topic.ok,true);
  const sub = bus.subscribe(topic.topic,"actor",actor,1);
  assert.equal(sub.ok,true);
  assert.equal(bus.topic("other", "Event").ok,true,
    "registered actors and groups must not consume topic quota");
  assert.equal(bus.topic("third", "Event").error,"ResourceExhausted");
  assert.equal(bus.unsubscribe(sub.subscription).ok,true);
  assert.equal(bus.leave(membership.membership).ok,true);
});
