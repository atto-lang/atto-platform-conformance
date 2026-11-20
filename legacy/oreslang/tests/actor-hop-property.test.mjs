import test from 'node:test';
import assert from 'node:assert/strict';
import {createActorHopTrace, appendActorHop, snapshotActorHops, convertActorHopLayout} from '../lib/actor-hop-trace.mjs';

function random(seed) { let x=seed>>>0; return ()=>((x^=x<<13,x^=x>>>17,x^=x<<5,x>>>0) / 4294967296); }
const mk = i => ({actor:'Actor'+(i%19),handler:'execute',kind:'forward',source:{unit:'src/actor.ores',line:i+1,column:1}});

for(const layout of ['aos','soa','aosoa']) {
  test(`${layout}: 100 seeded histories preserve order and immutable branching`, () => {
    for(let seed=1;seed<=100;seed++) {
      const rand=random(seed*2654435761);
      const capacity=5+Math.floor(rand()*60);
      const blockSize=1+Math.floor(rand()*13);
      const steps=10+Math.floor(rand()*300);
      let ctx=createActorHopTrace({layout,capacity,blockSize});
      const snapshots=[];
      const expected=[];
      for(let i=0;i<steps;i++) {
        if(i%17===0) snapshots.push([ctx,snapshotActorHops(ctx)]);
        ctx=appendActorHop(ctx,mk(i));
        expected.push(mk(i).actor);
      }
      const s=snapshotActorHops(ctx);
      assert.equal(s.retained,Math.min(capacity,steps));
      assert.equal(s.total_visits,steps);
      assert.equal(s.omitted_prior,steps-s.retained);
      assert.deepEqual(s.entries.map(x=>x.actor),expected.slice(-capacity));
      for(const [older,oldSnapshot] of snapshots) assert.deepEqual(snapshotActorHops(older),oldSnapshot);
      for(const other of ['aos','soa','aosoa']) assert.deepEqual(snapshotActorHops(convertActorHopLayout(ctx,other,blockSize)),s);
    }
  });
}
