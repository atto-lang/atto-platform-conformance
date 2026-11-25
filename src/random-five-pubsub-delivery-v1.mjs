// Task #64: synchronous bounded pub-sub *reference* model, not AttoLang runtime.
// RELIABLE never acknowledges a partially admitted fan-out. No carrier waits.
const POLICIES=new Set(['RELIABLE','DROP_NEW','DROP_OLDEST','LATEST']);
const idOk=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,48}$/.test(x);
const fail=code=>({status:'REJECTED',diagnostic:code});
export class ReferenceDeliveryBroker{
  constructor({capacity=2}={}){
    if(!Number.isSafeInteger(capacity)||capacity<1||capacity>64)throw Error('INVALID_CAPACITY');
    this.capacity=capacity;this.members=new Map();this.generations=new Map();
    this.pending=new Map();this.lastSeq=new Map();this.closed=false;
  }
  subscribe(id,policy){
    if(this.closed||!idOk(id)||!POLICIES.has(policy)||this.members.has(id))
      return fail('SUBSCRIBE_DENIED');
    const generation=(this.generations.get(id)||0)+1;
    this.generations.set(id,generation);
    this.members.set(id,{policy,generation,queue:[]});
    return {status:'SUBSCRIBED',id,generation};
  }
  unsubscribe(id){
    const member=this.members.get(id);
    if(!member)return fail('UNKNOWN_SUBSCRIPTION');
    this.members.delete(id); // all queued messages are retired with this generation
    return {status:'UNSUBSCRIBED',id,generation:member.generation};
  }
  close(){
    this.closed=true;const cancelled=this.pending.size;this.pending.clear();this.members.clear();
    return {status:'CLOSED',cancelled};
  }
  snapshot(){
    return {closed:this.closed,members:[...this.members].map(([id,s])=>({id,generation:s.generation,
      policy:s.policy,queued:s.queue.length})),pending:this.pending.size};
  }
  #admit(publisher,seq,payload,edges){
    for(const edge of edges){
      const s=this.members.get(edge.id);
      if(!s||s.generation!==edge.generation)return fail('SUBSCRIPTION_GENERATION_CHANGED');
    }
    if(edges.some(edge=>{const s=this.members.get(edge.id);return s.policy==='RELIABLE'&&s.queue.length>=this.capacity;}))
      return {status:'WAIT_BACKPRESSURE',publisher,seq};
    const delivery={publisher,seq,payload};
    let dropped=0;
    for(const edge of edges){
      const s=this.members.get(edge.id);
      if(s.queue.length>=this.capacity){
        if(s.policy==='DROP_NEW'){dropped++;continue;}
        if(s.policy==='DROP_OLDEST'){s.queue.shift();dropped++;}
        if(s.policy==='LATEST'){dropped+=s.queue.length;s.queue=[];}
      }else if(s.policy==='LATEST'){dropped+=s.queue.length;s.queue=[];}
      s.queue.push({...delivery,generation:s.generation});
    }
    this.lastSeq.set(publisher,seq);
    return {status:'ACK',publisher,seq,dropped};
  }
  publish(publisher,seq,payload){
    if(this.closed)return fail('TOPIC_CLOSED');
    if(!idOk(publisher)||!Number.isSafeInteger(seq)||seq<1||
      typeof payload!=='string'||payload.length>2048)
      return fail('INVALID_PUBLICATION');
    if(this.pending.has(publisher))return fail('PUBLISHER_HAS_PENDING_PUBLICATION');
    if(seq!==(this.lastSeq.get(publisher)||0)+1)return fail('PUBLISHER_SEQUENCE_NOT_MONOTONIC');
    const edges=[...this.members].map(([id,s])=>({id,generation:s.generation}));
    const result=this.#admit(publisher,seq,payload,edges);
    if(result.status==='WAIT_BACKPRESSURE')this.pending.set(publisher,{seq,payload,edges});
    return result;
  }
  resume(publisher){
    const p=this.pending.get(publisher);
    if(!p)return fail('NO_PENDING_PUBLICATION');
    if(this.closed){this.pending.delete(publisher);return fail('TOPIC_CLOSED');}
    const result=this.#admit(publisher,p.seq,p.payload,p.edges);
    if(result.status!=='WAIT_BACKPRESSURE')this.pending.delete(publisher);
    return result;
  }
  cancel(publisher,seq){
    const p=this.pending.get(publisher);
    if(!p||p.seq!==seq)return fail('UNKNOWN_PENDING_PUBLICATION');
    this.pending.delete(publisher);
    return {status:'CANCELLED',publisher,seq}; // no ACK, no sequence advance
  }
  receive(id,generation){
    const s=this.members.get(id);
    if(!s||s.generation!==generation)return fail('STALE_SUBSCRIPTION');
    if(!s.queue.length)return {status:'EMPTY'};
    return {status:'DELIVERED',message:s.queue.shift()};
  }
}
