#!/usr/bin/env node
// Independent bounded actor model only; no compiler or guest executed.
function verify() {
 const ok=(b,m)=>{if(!b)throw Error(m)};
 const initial={alive:1,panic:0,control:0,queued:0,accepted:0,delivered:0,dropped:0,notices:0,intercepted:0};
 const valid=s=>s.accepted===s.queued+s.delivered+s.dropped&&s.queued<=2&&s.notices<=1&&
 !s.intercepted&&(!s.panic||(!s.alive&&s.control+s.notices===1));
 const q=[initial],seen=new Set([JSON.stringify(initial)]),hits={};
 for(let i=0;i<q.length;i++){
  const s=q[i];ok(valid(s),"actor invariant");const moves=[];
  if(s.alive&&s.queued<2&&s.accepted<2)moves.push(["send",{...s,queued:s.queued+1,accepted:s.accepted+1}]);
  if(s.alive)moves.push(["panic",{...s,alive:0,panic:1,control:1}]);
  if(s.control)moves.push(["notice",{...s,control:0,notices:1}]);
  if(s.alive&&!s.control&&s.queued)moves.push(["deliver",{...s,queued:s.queued-1,delivered:s.delivered+1}]);
  if(!s.alive&&s.queued)moves.push(["discard",{...s,dropped:s.dropped+s.queued,queued:0}]);
  for(const [act,n] of moves) {
   ok(valid(n),act);
   if(act==="deliver")ok(!s.control&&s.alive,"data ahead of CONTROL");
   if(act==="send")ok(s.alive && s.accepted<2,"closed mailbox admitted data");
   if(act==="panic")ok(n.control===1&&!n.intercepted,"actor panic interception");
   hits[act]=(hits[act]||0)+1;
   const k=JSON.stringify(n);if(!seen.has(k)){seen.add(k);q.push(n);}
  }
 }
 ok(q.length>=15&&hits.notice&&hits.discard&&hits.deliver,"vacuous exploration");
 ok(!valid({...initial,intercepted:1}),"interception mutant");
 ok(!valid({...initial,accepted:1}),"lost message mutant");
 return {states:q.length,edges:Object.values(hits).reduce((a,b)=>a+b,0),hits,bound:"2 data messages, 1 panic"};
}
console.log(JSON.stringify(verify()));
