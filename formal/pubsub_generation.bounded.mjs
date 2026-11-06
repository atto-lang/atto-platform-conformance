// Design-level actor pub-sub state exploration, not guest-native execution proof.
// A queued message is tagged with the subscription generation at publication time.
const model={
 name:"AttoLang pub-sub subscription generation fencing",
 bounds:"one subscriber, at most two join generations, two-slot queue, max two deliveries",
 initial:{generation:0,joined:false,closed:false,queue:[],delivered:0,staleDeliveries:0,postClosePublications:0},
 invariants:{
  NoStaleDelivery:s=>s.staleDeliveries===0,
  NoPostClosePublication:s=>s.postClosePublications===0,
  QueueBounded:s=>s.queue.length<=2&&s.queue.every(g=>g>0&&g<=s.generation)
 },
 mutations:{deliver_old_generation:"NoStaleDelivery",publish_after_close:"NoPostClosePublication"},
 actions(s,m){
  const out=[];
  if(!s.joined&&!s.closed&&s.generation<2)out.push(["join-next-generation",{...s,generation:s.generation+1,joined:true}]);
  if(s.joined)out.push(["unsubscribe",{...s,joined:false}]);
  if(!s.closed)out.push(["close-group",{...s,closed:true,joined:false}]);
  if(s.joined&&!s.closed&&s.queue.length<2)out.push(["publish",{...s,queue:[...s.queue,s.generation]}]);
  if(m==="publish_after_close"&&s.closed&&s.queue.length<2)
    out.push(["unsafe-post-close-publish",{...s,queue:[...s.queue,Math.max(1,s.generation)],postClosePublications:s.postClosePublications+1}]);
  if(s.queue.length){
   if(s.joined&&s.queue[0]===s.generation&&s.delivered<2)
     out.push(["deliver-current",{...s,queue:s.queue.slice(1),delivered:s.delivered+1}]);
   else out.push(["discard-old-or-undeliverable",{...s,queue:s.queue.slice(1)}]);
   if(m==="deliver_old_generation"&&s.joined&&s.queue[0]<s.generation&&s.delivered<2)
     out.push(["unsafe-deliver-expired-generation",{...s,queue:s.queue.slice(1),delivered:s.delivered+1,staleDeliveries:s.staleDeliveries+1}]);
  }
  return out;
 }
};
// Exhaustive reachable-state exploration with an expected counterexample for each mutant.
function walk(mutation = null) {
  const todo = [{s: model.initial, trace: ["init"]}];
  const seen = new Set();
  let transitions = 0;
  for (let i = 0; i < todo.length; i++) {
    const {s, trace} = todo[i];
    const k = JSON.stringify(s);
    if (seen.has(k)) continue;
    seen.add(k);
    if (seen.size > 50000) throw Error("MODEL_BOUND_EXCEEDED");
    for (const [name, holds] of Object.entries(model.invariants)) {
      if (!holds(s)) throw Error("COUNTEREXAMPLE " + name + " via " + trace.join(" -> ") + ": " + k);
    }
    for (const [name, next] of model.actions(s, mutation)) {
      transitions++;
      if (!seen.has(JSON.stringify(next))) todo.push({s: next, trace: [...trace, name]});
    }
  }
  if (seen.size < 3 || transitions < 2) throw Error("MODEL_DID_NOT_EXPLORE");
  return {reachableStates: seen.size, transitions};
}
function verify() {
  const positive = walk();
  const negative = {};
  for (const [mutant, expectedInvariant] of Object.entries(model.mutations)) {
    let observed = "";
    try { walk(mutant); } catch(e) {
      if (!e.message.startsWith("COUNTEREXAMPLE ")) throw e;
      observed = e.message;
    }
    if (!observed.startsWith("COUNTEREXAMPLE " + expectedInvariant + " "))
      throw Error("MUTANT_NOT_DETECTED " + mutant + " expected=" + expectedInvariant + " observed=" + observed);
    negative[mutant] = expectedInvariant;
  }
  if (!Object.keys(negative).length) throw Error("NO_NEGATIVE_CONTROLS");
  return {model: model.name, bounds: model.bounds, positive, negative};
}
if (typeof process !== "undefined" && process.versions?.node) console.log(JSON.stringify(verify(), null, 2));
