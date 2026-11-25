/**
 * Deterministic HOST-ONLY oracle for AttoLang actor graph test design.
 * NOT a compiled guest, authenticated event source, supervisor, or authority.
 * This local model cannot certify any backend's runtime semantics.
 */
export function runLongRunningGraph({count=10000,capacity=4,failAt=7}={}){
  if(!Number.isSafeInteger(count)||count<1||count>100000||!Number.isSafeInteger(capacity)||capacity<1||capacity>1024||!Number.isSafeInteger(failAt)||failAt<1||failAt>count)throw new RangeError("invalid bounded graph inputs");
  const inbox=[[],[]],outbox=[[],[]],generation=[1,1],seen=new Set();
  let next=1,processed=0,ticks=0,checksum=0n,restarts=0,staleRejected=0,peakInbox=0,peakOutbox=0,backpressure=0,latest=null,latestOverwrites=0,observedProgress=0;
  const admit=(worker,item,expectedGeneration)=>{
    if(expectedGeneration!==generation[worker]||inbox[worker].length>=capacity)return false;
    inbox[worker].push({...item,generation:expectedGeneration});
    return true;
  };
  while(processed<count){
    ticks++;
    if(ticks>count*48+256)throw new Error("graph progress budget exceeded");
    if(ticks%7===0&&latest!==null){observedProgress=latest;latest=null;}
    if(ticks%3===0){
      const preferred=ticks%2,choice=outbox[preferred].length?preferred:1-preferred;
      if(outbox[choice].length){
        const item=outbox[choice].shift();
        if(seen.has(item.id))throw new Error("duplicate committed task");
        seen.add(item.id);checksum+=BigInt(item.id)*BigInt(item.id)+1n;
        processed++;
        if(latest!==null)latestOverwrites++;
        latest=processed;
      }
    }
    for(let worker=0;worker<2;worker++){
      if(!inbox[worker].length)continue;
      if(outbox[worker].length>=capacity){backpressure++;continue;}
      const item=inbox[worker][0];
      if(item.generation!==generation[worker])throw new Error("old-generation work admitted");
      if(item.id===failAt&&restarts===0){
        const old=generation[worker];
        generation[worker]++;
        restarts++;
        // Model-only: trusted supervisor reissues bounded pending work.
        // No old-generation mailbox capability is reused.
        const pending=inbox[worker].splice(0);
        if(admit(worker,{id:item.id},old))throw new Error("stale capability accepted");
        staleRejected++;
        for(const record of pending)if(!admit(worker,{id:record.id},generation[worker]))throw new Error("bounded recovery failed");
        continue;
      }
      inbox[worker].shift();
      outbox[worker].push({id:item.id,generation:generation[worker]});
    }
    if(next<=count){
      const worker=(next-1)%2;
      if(admit(worker,{id:next},generation[worker]))next++;
      else backpressure++;
    }
    peakInbox=Math.max(peakInbox,inbox[0].length,inbox[1].length);
    peakOutbox=Math.max(peakOutbox,outbox[0].length,outbox[1].length);
  }
  if(next!==count+1||inbox.some(q=>q.length)||outbox.some(q=>q.length)||seen.size!==count)throw new Error("unsettled work on completion");
  const n=BigInt(count),expected=n*(n+1n)*(2n*n+1n)/6n+n;
  if(checksum!==expected)throw new Error("graph checksum mismatch");
  return Object.freeze({count,checksum:checksum.toString(),processed,restarts,staleRejected,peakInbox,peakOutbox,backpressure,latestOverwrites,observedProgress,ticks});
}
export class ActorGroupOracle {
  constructor(capacity=4){
    if(!Number.isSafeInteger(capacity)||capacity<1||capacity>1024)throw new RangeError("invalid bounded topic capacity");
    this.capacity=capacity;this.groups=new Map();
  }
  openGroup(name){
    if(typeof name!=="string"||!/^[a-z][a-z0-9_-]{0,63}$/.test(name)||this.groups.has(name))throw new Error("invalid group");
    this.groups.set(name,{closed:false,members:new Map(),topics:new Map()});
  }
  group(name){
    const g=this.groups.get(name);
    if(!g||g.closed)throw new Error("closed or missing group");
    return g;
  }
  join(group,actor,generation){
    const g=this.group(group);
    if(typeof actor!=="string"||!actor||!Number.isSafeInteger(generation)||generation<1)throw new Error("invalid member");
    const existing=g.members.get(actor);
    if(existing!==undefined&&existing!==generation)throw new Error("incarnation change requires leave");
    g.members.set(actor,generation);
  }
  requireMember(g,actor,generation){
    if(g.members.get(actor)!==generation)throw new Error("nonmember or stale generation");
  }
  addTopic(group,topic,policy){
    const g=this.group(group);
    if(typeof topic!=="string"||!topic||g.topics.has(topic)||!["LATEST","RELIABLE"].includes(policy))throw new Error("invalid topic");
    g.topics.set(topic,{policy,subscriptions:new Map()});
  }
  subscribe(group,topic,actor,generation){
    const g=this.group(group);this.requireMember(g,actor,generation);
    const t=g.topics.get(topic);if(!t)throw new Error("unknown topic");
    t.subscriptions.set(actor,{generation,queue:[]});
  }
  publish(group,topic,actor,generation,value){
    const g=this.group(group);this.requireMember(g,actor,generation);
    const t=g.topics.get(topic);if(!t)throw new Error("unknown topic");
    const recipients=[...t.subscriptions.entries()].filter(([member,s])=>g.members.get(member)===s.generation);
    if(t.policy==="RELIABLE"&&recipients.some(([,s])=>s.queue.length>=this.capacity))return false;
    for(const [,s] of recipients){
      if(t.policy==="LATEST"&&s.queue.length)s.queue.shift();
      s.queue.push(value);
    }
    return true;
  }
  read(group,topic,actor,generation){
    const g=this.group(group);this.requireMember(g,actor,generation);
    const s=g.topics.get(topic)?.subscriptions.get(actor);
    if(!s||s.generation!==generation)throw new Error("not an authorized subscriber");
    return s.queue.shift()??null;
  }
  leave(group,actor,generation){
    const g=this.group(group);this.requireMember(g,actor,generation);
    g.members.delete(actor);
    for(const t of g.topics.values())t.subscriptions.delete(actor);
  }
  close(group){
    const g=this.group(group);g.closed=true;g.members.clear();g.topics.clear();
  }
}
