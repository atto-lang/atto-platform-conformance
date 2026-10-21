import test from "node:test";
import assert from "node:assert/strict";
import {PublicationClaimOracle} from "../src/batch05-publication-claim-oracle.mjs";

const epoch=(session,routeEpoch=3,capabilityGeneration=4)=>({
  domain:"tenant",sender:"sender",destination:"worker",session,
  senderIncarnation:1,destinationIncarnation:2,routeEpoch,capabilityGeneration
});

test("unclaimed message cannot be acknowledged by peer",()=>{
  const g=new PublicationClaimOracle(),t=g.admit();
  assert.throws(()=>g.receipt(t,"REMOTE_ACCEPTED"),/out of order/);
  assert.equal(g.state(t),"LOCAL_ADMITTED");
  assert.equal(g.invariant(),true);
});
test("local dispatch claim makes unsent rejection impossible",()=>{
  const g=new PublicationClaimOracle(),t=g.admit();
  g.claim(t);
  assert.throws(()=>g.reject(t),/never-sent not proven/);
  assert.equal(g.state(t),"DISPATCH_CLAIMED");
  assert.equal(g.counts().credits,1);
  assert.equal(g.invariant(),true);
});
test("local rejection before claim is final and exact once",()=>{
  const g=new PublicationClaimOracle(),t=g.admit();
  assert.equal(g.reject(t),"REJECTED_BEFORE_REMOTE");
  assert.throws(()=>g.claim(t),/stale/);
  assert.throws(()=>g.reject(t),/stale/);
  assert.equal(g.counts().pending,0);
  assert.equal(g.invariant(),true);
});
test("remote peer cannot forge local uncertain or unsent result",()=>{
  const g=new PublicationClaimOracle(),t=g.admit();
  for(const stage of ["REJECTED_BEFORE_REMOTE","OUTCOME_UNKNOWN"])
    assert.throws(()=>g.receipt(t,stage),/remote cannot assert/);
  assert.equal(g.state(t),"LOCAL_ADMITTED");
});
test("one ACK and one terminal receipt retire credits exactly once",()=>{
  const g=new PublicationClaimOracle(),t=g.admit();
  g.claim(t);
  assert.equal(g.receipt(t,"REMOTE_ACCEPTED"),null);
  assert.equal(g.counts().credits,0);
  assert.equal(g.receipt(t,"HANDLER_COMMITTED"),"HANDLER_COMMITTED");
  assert.throws(()=>g.receipt(t,"HANDLER_COMMITTED"),/stale/);
  assert.equal(g.invariant(),true);
});
test("duplicate claim and duplicate ACK must reject",()=>{
  const g=new PublicationClaimOracle(),t=g.admit();
  g.claim(t);
  assert.throws(()=>g.claim(t),/duplicate claim/);
  g.receipt(t,"REMOTE_ACCEPTED");
  assert.throws(()=>g.receipt(t,"REMOTE_ACCEPTED"),/out of order/);
});
test("lost session after claimed write is ambiguous and reclaims credit",()=>{
  const g=new PublicationClaimOracle(),t=g.admit(epoch("old"));
  g.claim(t);
  const lost=g.eof(epoch("old"));
  assert.equal(lost.length,1);
  assert.equal(lost[0].stage,"DISPATCH_CLAIMED");
  assert.equal(g.counts().credits,0);
  assert.equal(g.invariant(),true);
});
test("lost session after ACK does not imply handler committed",()=>{
  const g=new PublicationClaimOracle(),t=g.admit(epoch("old"));
  g.claim(t);g.receipt(t,"REMOTE_ACCEPTED");
  assert.equal(g.eof(epoch("old"))[0].stage,"REMOTE_ACCEPTED");
  assert.equal(g.state(t),"RETIRED");
  assert.equal(g.invariant(),true);
});
test("session fencing only retires correlations of chosen session",()=>{
  const g=new PublicationClaimOracle(),a=g.admit(epoch("old")),b=g.admit(epoch("new"));
  g.claim(a);
  assert.equal(g.eof(epoch("old")).length,1);
  assert.equal(g.state(b),"LOCAL_ADMITTED");
  assert.equal(g.counts().credits,1);
  g.reject(b);assert.equal(g.invariant(),true);
});
test("capacity is bounded and freed on real retirement",()=>{
  const g=new PublicationClaimOracle(1),a=g.admit();
  assert.equal(g.admit(),null);g.reject(a);
  assert.ok(g.admit());assert.equal(g.invariant(),true);
});
test("foreign opaque ticket cannot steal another ledger's credit",()=>{
  const a=new PublicationClaimOracle(),b=new PublicationClaimOracle();
  const token=a.admit();b.admit();
  assert.throws(()=>b.claim(token),/stale/);
  assert.equal(b.invariant(),true);
});
test("all 24 claim/reject/ACK/EOF serial schedules maintain invariants",()=>{
  const actions=["claim","reject","ack","eof"];
  let n=0;
  function permutations(arr,p=[]){
    if(!arr.length){
      n++;
      const g=new PublicationClaimOracle(1),t=g.admit(epoch("s"));
      for(const action of p){
        try{
          if(action==="claim")g.claim(t);
          else if(action==="reject")g.reject(t);
          else if(action==="ack")g.receipt(t,"REMOTE_ACCEPTED");
          else g.eof(epoch("s"));
        }catch(e){assert.match(String(e),/stale|never-sent|out of order|duplicate/);}
        assert.equal(g.invariant(),true);
      }
      return;
    }
    arr.forEach((action,i)=>permutations(arr.filter((_,j)=>j!==i),[...p,action]));
  }
  permutations(actions);assert.equal(n,24);
});
test("100000 deterministic transitions preserve outstanding credit accounting",()=>{
  let seed=20261019;
  const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let run=0;run<200;run++){
    const g=new PublicationClaimOracle(10),tickets=[];
    for(let step=0;step<500;step++){
      const action=random()%7;
      if(action===0){const t=g.admit(epoch("s"));if(t)tickets.push(t);}
      else if(tickets.length){
        const t=tickets[random()%tickets.length];
        try{
          if(action===1)g.claim(t);
          else if(action===2)g.reject(t);
          else if(action===3)g.receipt(t,"REMOTE_ACCEPTED");
          else if(action===4)g.receipt(t,"HANDLER_FAILED");
          else if(action===5)g.receipt(t,"OUTCOME_UNKNOWN");
          else g.eof(epoch("s"));
        }catch(e){assert.match(String(e),/stale|never-sent|out of order|duplicate|remote cannot/);}
      }
      assert.equal(g.invariant(),true);
      assert.ok(g.counts().pending<=10);
    }
  }
});

test("stale EOF cannot retire a new route or capability with same session string",()=>{
  const g=new PublicationClaimOracle(2);
  const old=epoch("reused",3,4),newRoute=epoch("reused",4,5);
  const a=g.admit(old),b=g.admit(newRoute);
  g.claim(a);g.claim(b);
  const previous=g.eof(old);
  assert.equal(previous.length,1);
  assert.equal(previous[0].ticket,a);
  assert.equal(g.state(b),"DISPATCH_CLAIMED");
  assert.equal(g.counts().credits,1);
  assert.equal(g.eof(old).length,0);
  g.receipt(b,"REMOTE_ACCEPTED");
  g.receipt(b,"HANDLER_COMMITTED");
  assert.equal(g.invariant(),true);
});
test("epoch values are copied: mutating input after admission cannot change authority",()=>{
  const g=new PublicationClaimOracle(1),proof=epoch("immutable");
  const t=g.admit(proof);
  proof.routeEpoch=99;proof.session="forged";
  assert.equal(g.eof(proof).length,0);
  assert.equal(g.eof(epoch("immutable")).length,1);
  assert.equal(g.state(t),"RETIRED");
});
test("text-only EOF and truncated generation metadata are rejected",()=>{
  const g=new PublicationClaimOracle();
  g.admit(epoch("protected"));
  assert.throws(()=>g.eof("protected"),/complete transport epoch/);
  assert.throws(()=>g.eof({session:"protected"}),/complete transport epoch/);
  assert.equal(g.counts().pending,1);
});
