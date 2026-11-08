import test from "node:test";
import assert from "node:assert/strict";
import {PubSubReference,share} from "../models/actor-pubsub-portable-v1.mjs";

// Source-free single-threaded oracle only. These checks do not establish
// compiler, guest, native AOT, interleaving or distributed membership proof.
function admitted(result,operation) {
  assert.equal(result.ok,true,operation+": "+(result.error??"unexpected rejection"));
  return result;
}

test("broker close revokes both group grants even when weak-held handles survive",()=>{
  const broker=new PubSubReference({
    maxActors:1,maxGroups:2,maxTopics:2,maxSubscriptions:2,maxMemberships:2
  });
  const actor=admitted(broker.actor("a",1),"actor").actor;
  const left=admitted(broker.group("left"),"group left").group;
  const right=admitted(broker.group("right"),"group right").group;
  const grantLeft=admitted(broker.join(left,actor),"join left").membership;
  const grantRight=admitted(broker.join(right,actor),"join right").membership;
  const topicLeft=admitted(broker.topicInGroup(left,"events","int"),"topic left").topic;
  const topicRight=admitted(broker.topicInGroup(right,"events","int"),"topic right").topic;
  const subLeft=admitted(broker.subscribe(topicLeft,"group",left,2),"sub left").subscription;
  const subRight=admitted(broker.subscribe(topicRight,"group",right,2),"sub right").subscription;
  assert.equal(broker.membershipCount,2);
  assert.equal(admitted(broker.tryPublish(topicLeft,share(11),grantLeft),"publish left").receipt.recipients,1);
  assert.equal(admitted(broker.tryPublish(topicRight,share(22),grantRight),"publish right").receipt.recipients,1);
  assert.equal(admitted(broker.start(subLeft,actor),"start left").delivery.payload,11);

  admitted(broker.close(),"close broker");
  assert.equal(broker.closed,true);
  assert.equal(broker.membershipCount,0);
  assert.equal(left.closed,true);
  assert.equal(right.closed,true);
  assert.equal(left.members.size,0);
  assert.equal(right.members.size,0);

  // A stale frozen grant remains reachable, but its private state must
  // have been revoked. Previously leave() incorrectly returned success.
  assert.equal(broker.leave(grantLeft).error,"StaleMembership");
  assert.equal(broker.leave(grantRight).error,"StaleMembership");
  assert.equal(broker.tryPublish(topicLeft,share(33),grantLeft).error,"Closed");
  assert.equal(broker.tryPublish(topicRight,share(44),grantRight).error,"Closed");
  assert.equal(broker.join(left,actor).error,"Closed");
  assert.equal(broker.start(subRight,actor).error,"Closed");
  assert.equal(broker.start(subLeft,actor).error,"Closed");

  assert.equal(subLeft.closed,true);
  assert.equal(subRight.closed,true);
  assert.equal(broker.done(subRight),true,"queued-only event must be cancelled");
  assert.equal(broker.done(subLeft),false,"active delivery retains quiescence");
  admitted(broker.finish(subLeft,actor),"finish admitted delivery");
  assert.equal(broker.done(subLeft),true);
  admitted(broker.close(),"idempotent close");
  assert.equal(broker.leave(grantLeft).error,"StaleMembership");
});

test("closing one broker cannot revoke or impersonate another brokers group",()=>{
  const first=new PubSubReference(),second=new PubSubReference();
  const firstActor=admitted(first.actor("same",1),"old actor").actor;
  const secondActor=admitted(second.actor("same",1),"other actor").actor;
  const firstGroup=admitted(first.group("same"),"old group").group;
  const secondGroup=admitted(second.group("same"),"other group").group;
  const oldGrant=admitted(first.join(firstGroup,firstActor),"old join").membership;
  const newGrant=admitted(second.join(secondGroup,secondActor),"other join").membership;
  const firstTopic=admitted(first.topicInGroup(firstGroup,"events","int"),"old topic").topic;
  const secondTopic=admitted(second.topicInGroup(secondGroup,"events","int"),"other topic").topic;
  const secondSub=admitted(second.subscribe(secondTopic,"group",secondGroup,1),"other sub").subscription;

  admitted(first.close(),"close old broker");
  assert.equal(first.leave(oldGrant).error,"StaleMembership");
  assert.equal(second.tryPublish(secondTopic,share(7),oldGrant).error,"UnauthorizedPublisher");
  assert.equal(second.tryPublish(firstTopic,share(7),newGrant).error,"UnknownTopic");
  assert.equal(second.closed,false);
  assert.equal(secondGroup.closed,false);
  assert.equal(second.membershipCount,1);
  assert.equal(admitted(second.tryPublish(secondTopic,share(8),newGrant),"other publish").receipt.recipients,1);
  assert.equal(admitted(second.start(secondSub,secondActor),"other start").delivery.payload,8);
  admitted(second.finish(secondSub,secondActor),"other finish");
  admitted(second.leave(newGrant),"other leave");
  assert.equal(second.membershipCount,0);
});
