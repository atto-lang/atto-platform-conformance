import test from 'node:test';
import assert from 'node:assert/strict';
import {PubSubReference,share} from '../models/actor-pubsub-portable-v1.mjs';

// Offline reference model, not compiler-backed actor execution or concurrency proof.
function expect(result,label) {
  assert.equal(result.ok,true,label+': '+(result.error||'unexpected rejection'));
  return result;
}
test('one actor joins two groups without leaking authority across them',()=>{
  const bus=new PubSubReference({maxActors:2,maxGroups:2,maxTopics:2,maxSubscriptions:2,maxMemberships:2});
  const actor=expect(bus.actor('tenant/a',1),'actor').actor;
  const first=expect(bus.group('first'),'first').group;
  const second=expect(bus.group('second'),'second').group;
  const grant1=expect(bus.join(first,actor),'join first').membership;
  const grant2=expect(bus.join(second,actor),'join second').membership;
  assert.equal(bus.membershipCount,2);
  const topic1=expect(bus.topicInGroup(first,'v','int'),'topic one').topic;
  const topic2=expect(bus.topicInGroup(second,'v','int'),'topic two').topic;
  const sub1=expect(bus.subscribe(topic1,'group',first,3),'sub one').subscription;
  const sub2=expect(bus.subscribe(topic2,'group',second,3),'sub two').subscription;
  assert.equal(expect(bus.tryPublish(topic1,share(11),grant1),'pub one').receipt.recipients,1);
  assert.equal(expect(bus.tryPublish(topic2,share(22),grant2),'pub two').receipt.recipients,1);
  assert.equal(bus.tryPublish(topic1,share(33),grant2).error,'UnauthorizedPublisher');
  assert.equal(bus.tryPublish(topic2,share(33),grant1).error,'UnauthorizedPublisher');
  assert.equal(expect(bus.start(sub1,actor),'read one').delivery.payload,11);
  expect(bus.finish(sub1,actor),'finish one');
  assert.equal(expect(bus.start(sub2,actor),'read two').delivery.payload,22);
  expect(bus.finish(sub2,actor),'finish two');
  expect(bus.leave(grant1),'leave one');
  assert.equal(bus.membershipCount,1);
  assert.equal(bus.tryPublish(topic1,share(33),grant1).error,'UnauthorizedPublisher');
  assert.equal(expect(bus.tryPublish(topic2,share(44),grant2),'publish unaffected').receipt.recipients,1);
  assert.equal(expect(bus.start(sub2,actor),'read surviving group').delivery.payload,44);
  expect(bus.finish(sub2,actor),'finish surviving group');
  expect(bus.closeGroup(first),'close first');
  assert.equal(bus.membershipCount,1);
  assert.equal(bus.tryPublish(topic1,share(55),grant1).error,'UnauthorizedPublisher');
  assert.equal(expect(bus.tryPublish(topic2,share(66),grant2),'second still live').receipt.recipients,1);
  assert.equal(expect(bus.start(sub2,actor),'second still deliver').delivery.payload,66);
  expect(bus.finish(sub2,actor),'second still finish');
  expect(bus.stopActor(actor),'stop actor');
  assert.equal(bus.membershipCount,0);
  assert.equal(bus.tryPublish(topic2,share(77),grant2).error,'UnauthorizedPublisher');
});

test('256 join-leave cycles mint unique grants and stale grants never authorize',()=>{
  const bus=new PubSubReference({maxActors:2,maxGroups:1,maxTopics:1,maxMemberships:1});
  const actor=expect(bus.actor('tenant-a',1),'actor').actor;
  const group=expect(bus.group('room'),'group').group;
  const topic=expect(bus.topicInGroup(group,'events','int'),'topic').topic;
  const old=[];
  for(let round=0;round<256;round++){
    const grant=expect(bus.join(group,actor),'join '+round).membership;
    assert.equal(bus.membershipCount,1);
    assert.equal(group.members.size,1);
    assert.equal(expect(bus.tryPublish(topic,share(round),grant),'publish live').receipt.recipients,0);
    for(const prev of old)
      assert.equal(bus.tryPublish(topic,share(round),prev).error,'UnauthorizedPublisher');
    old.push(grant);
    expect(bus.leave(grant),'leave '+round);
    assert.equal(bus.membershipCount,0);
    assert.equal(group.members.size,0);
    assert.equal(bus.leave(grant).error,'StaleMembership');
    assert.equal(bus.tryPublish(topic,share(round),grant).error,'UnauthorizedPublisher');
  }
  assert.equal(new Set(old.map(g=>g.id)).size,256);
  const fresh=expect(bus.join(group,actor),'join after 256').membership;
  assert.ok(fresh.id>old[old.length-1].id);
  expect(bus.leave(fresh),'final leave');
});

test('one membership leaving cannot retire a separate actor generation or group',()=>{
  const bus=new PubSubReference({maxActors:3,maxGroups:2,maxTopics:2,maxMemberships:3});
  const old=expect(bus.actor('same',1),'old').actor;
  const newer=expect(bus.actor('same',2),'new').actor;
  const g1=expect(bus.group('g1'),'g1').group;
  const g2=expect(bus.group('g2'),'g2').group;
  const oldGrant=expect(bus.join(g1,old),'old g1').membership;
  const newGrant=expect(bus.join(g1,newer),'new g1').membership;
  const other=expect(bus.join(g2,newer),'new g2').membership;
  assert.equal(g1.members.size,2);
  expect(bus.stopActor(old),'stop old');
  assert.equal(g1.members.size,1);
  assert.equal(bus.membershipCount,2);
  assert.equal(bus.leave(oldGrant).error,'StaleMembership');
  assert.equal(newer.alive,true);
  expect(bus.leave(newGrant),'leave only g1');
  assert.equal(g1.members.size,0);
  assert.equal(g2.members.size,1);
  assert.equal(bus.membershipCount,1);
  expect(bus.leave(other),'leave g2');
  assert.equal(g2.members.size,0);
  assert.equal(bus.membershipCount,0);
});
