/**
 * Batch 4 backend-neutral executable safety reference.
 * No Oreslang compiler/parser/runtime is implemented by this module.
 */
const fail = reason => { throw new Error('wave4: ' + reason); };
const check = (ok,reason) => { if (!ok) fail(reason); };
const record = v => v !== null && typeof v === 'object' &&
    !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const permitted = new Set(['string','number','boolean']);
const MAX_DEPTH=8, MAX_NODES=256;
function copyData(v,limit={nodes:0},depth=0){
  check(depth<=MAX_DEPTH && ++limit.nodes<=MAX_NODES,'payload depth/node quota');
  if (v===null) return null;
  if (permitted.has(typeof v)){
    check(typeof v!=='number'||Number.isSafeInteger(v),'nonportable numeric payload');
    check(typeof v!=='string'||Buffer.byteLength(v,'utf8')<=1024,'string quota');
    return v;
  }
  if(Array.isArray(v)){
    check(v.length<=64,'array quota');
    return Object.freeze(v.map(x=>copyData(x,limit,depth+1)));
  }
  check(record(v),'not an owned data value');
  const keys=Object.keys(v);
  check(keys.length<=64,'record quota');
  const o=Object.create(null);
  for(const key of keys){
    check(/^[a-zA-Z_][a-zA-Z_0-9]{0,63}$/.test(key)&&key!=='__proto__'&&key!=='constructor','invalid record key');
    Object.defineProperty(o,key,{value:copyData(v[key],limit,depth+1),writable:false,enumerable:true,configurable:false});
  }
  return Object.freeze(o);
}
function mutableCopy(v){if(Array.isArray(v))return v.map(mutableCopy);if(v && typeof v==='object'){const r=Object.create(null);for(const key of Object.keys(v))r[key]=mutableCopy(v[key]);return r;}return v;}
export function ownedData(value){return copyData(value);}
/** Single sealed state map. Changes are published atomically only after validation. */
export class StateDomain{
  #actors=new Map();#tokens=new WeakMap();
  define(id,defaults){check(typeof id==='string'&&id.length>0&&!this.#actors.has(id),'bad/duplicate actor');check(record(defaults),'state must be an aggregate');this.#actors.set(id,{value:copyData(defaults),version:0,writing:false,generation:1});}
  #actor(id){const a=this.#actors.get(id);check(a,'unknown actor');return a;}
  grant(id,capability){check(['read','write'].includes(capability),'invalid state capability');const a=this.#actor(id);const token=Object.freeze({});this.#tokens.set(token,{id,generation:a.generation,capability});return token;}
  #admit(id,token,need){const a=this.#actor(id),g=this.#tokens.get(token);check(g&&g.id===id&&g.generation===a.generation&&(g.capability==='write'||need==='read'),'foreign/stale/insufficient capability');return a;}
  read(id,token){const a=this.#admit(id,token,'read');return {value:a.value,version:a.version};}
  write(id,token,edit){const a=this.#admit(id,token,'write');check(!a.writing,'reentrant critical write');check(typeof edit==='function','edit must be synchronous callable');a.writing=true;
    try{const draft=mutableCopy(a.value);const out=edit(draft);check(!(out&&typeof out.then==='function'),'state loan crossed suspension');
      const next=copyData(draft);a.value=next;a.version++;return a.version;
    }finally{a.writing=false;}}
  retire(id){const a=this.#actor(id);a.generation++;a.value=Object.freeze(Object.create(null));a.version=0;}
}
/** Bounded, separately budgeted supervisor CONTROL; no user code runs inline. */
export class SupervisorControl{
 #children=new Map();#authority=new WeakMap();#data=[];#control=[];#seen=new Set();#maxData;#maxControl;
 constructor({maxData=2,maxControl=2}={}){check(Number.isInteger(maxData)&&maxData>0&&maxData<=64&&Number.isInteger(maxControl)&&maxControl>0&&maxControl<=64,'bad mailbox quotas');this.#maxData=maxData;this.#maxControl=maxControl;}
 register(id,parent){check(typeof id==='string'&&typeof parent==='string'&&id&&parent&&!this.#children.has(id),'bad child identity');this.#children.set(id,{parent,generation:1,terminal:false});const cap=Object.freeze({});this.#authority.set(cap,{id,parent,generation:1});return cap;}
 data(value){if(this.#data.length>=this.#maxData)return false;this.#data.push(copyData(value));return true;}
 terminate(child,parent,kind,cap){
  const a=this.#children.get(child),grant=this.#authority.get(cap);
  check(a&&a.parent===parent&&grant&&grant.id===child&&grant.parent===parent&&grant.generation===a.generation,'untrusted CONTROL source/parent/authority');
  check(['throw','raise','panic','cancel','host-fatal'].includes(kind),'invalid terminal cause');
  const key=child+'#'+a.generation;
  if(this.#seen.has(key))return false;
  // No notice loss: backpressure is explicit. Do not finalize until reserved slot is secured.
  if(this.#control.length>=this.#maxControl)return false;
  this.#seen.add(key);a.terminal=true;
  this.#control.push(Object.freeze({actor:child,parent,generation:a.generation,kind}));return true;
 }
 popControl(){return this.#control.shift()??null;}
 popData(){return this.#data.shift()??null;}
 get sizes(){return{data:this.#data.length,control:this.#control.length};}
 restart(child,parent,cap){const a=this.#children.get(child),grant=this.#authority.get(cap);check(a&&a.parent===parent&&a.terminal&&grant&&grant.id===child&&grant.parent===parent&&grant.generation===a.generation,'restart requires authenticated terminal child');a.generation++;a.terminal=false;const next=Object.freeze({});this.#authority.set(next,{id:child,parent,generation:a.generation});return next;}
}
/** A closed, narrow canonical MessagePack subset; not the production actor v2 ABI. */
export class StrictMessagePackFixture{
 #schemas=new Map();
 add(domain,variant,shape){
  check(typeof domain==='string'&&/^[a-zA-Z][a-zA-Z0-9_.-]{0,31}$/.test(domain),'bad schema domain');
  check(Number.isInteger(variant)&&variant>=1&&variant<=127,'bad variant tag');
  check(Array.isArray(shape)&&shape.length<=16&&shape.every(s=>['int','str','bool'].includes(s)),'invalid payload shape');
  const key=domain+'#'+variant;check(!this.#schemas.has(key),'schema redefinition');
  this.#schemas.set(key,[...shape]);
 }
 #shape(domain,variant,payload){
  const shape=this.#schemas.get(domain+'#'+variant);check(shape,'unknown MessagePack variant');
  check(Array.isArray(payload)&&payload.length===shape.length,'payload tuple arity');
  payload.forEach((v,i)=>check(shape[i]==='int'?Number.isSafeInteger(v)&&v>=-2147483648&&v<=2147483647:shape[i]==='str'?typeof v==='string'&&Buffer.byteLength(v,'utf8')<=31:typeof v==='boolean','wrong payload type'));
 }
 encode(domain,variant,payload){
  this.#shape(domain,variant,payload);
  const bytes=[0x94],push=v=>{
    if(typeof v==='number'){
      if(v>=0&&v<=127)bytes.push(v);
      else if(v>=-32&&v<0)bytes.push(256+v);
      else {const b=Buffer.allocUnsafe(5);b[0]=0xd2;b.writeInt32BE(v,1);bytes.push(...b);}
    }else if(typeof v==='string'){const b=Buffer.from(v,'utf8');check(b.length<=31,'string fixture limit');bytes.push(0xa0+b.length,...b);}
    else if(typeof v==='boolean')bytes.push(v?0xc3:0xc2);
    else if(Array.isArray(v)){check(v.length<=15,'tuple quota');bytes.push(0x90+v.length);v.forEach(push);}
    else fail('unsupported wire type');
  };
  push(domain);push(2);push(variant);push(payload);
  return Buffer.from(bytes);
 }
 decode(bytes){
  check(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=4096,'wire size/type');
  let i=0;const read=(depth=0)=>{
    check(depth<=4&&i<bytes.length,'truncated/deep MessagePack');
    const tag=bytes[i++];
    if(tag<=127)return tag;
    if(tag>=0xe0)return tag-256;
    if(tag===0xc2)return false;if(tag===0xc3)return true;
    if(tag===0xd2){check(i+4<=bytes.length,'short integer');const n=bytes.readInt32BE(i);i+=4;return n;}
    if(tag>=0xa0&&tag<=0xbf){const len=tag-0xa0;check(i+len<=bytes.length,'short string');const text=bytes.toString('utf8',i,i+len);check(Buffer.from(text,'utf8').equals(bytes.subarray(i,i+len)),'noncanonical UTF-8');i+=len;return text;}
    if(tag>=0x90&&tag<=0x9f){const len=tag-0x90;const values=[];for(let j=0;j<len;j++)values.push(read(depth+1));return values;}
    fail('noncanonical/unsupported MessagePack tag');
  };
  const envelope=read();check(i===bytes.length,'trailing wire bytes');
  check(Array.isArray(envelope)&&envelope.length===4,'invalid wire envelope');
  const [domain,version,variant,payload]=envelope;
  check(version===2,'wrong wire version');this.#shape(domain,variant,payload);
  check(this.encode(domain,variant,payload).equals(bytes),'noncanonical wire representation');
  return Object.freeze({domain,version,variant,payload:ownedData(payload)});
 }
}
/** Fair, bounded, owned-message channel/select simulation; not a guest scheduler. */
export class Channels{
 #states=new Map();#cursor=0;
 create(name,capacity=1){check(typeof name==='string'&&name.length>0&&!this.#states.has(name)&&Number.isInteger(capacity)&&capacity>0&&capacity<=64,'invalid channel');this.#states.set(name,{queue:[],capacity,closed:false});}
 send(name,value){const s=this.#states.get(name);check(s&&!s.closed,'closed/unknown channel');if(s.queue.length===s.capacity)return false;const owned=copyData(value);s.queue.push(owned);return true;}
 close(name){const s=this.#states.get(name);check(s,'unknown channel');s.closed=true;}
 receive(name){const s=this.#states.get(name);check(s,'unknown channel');return s.queue.length?{ready:true,value:s.queue.shift()}:{ready:false,closed:s.closed};}
 select(names){
  check(Array.isArray(names)&&names.length>0&&names.length<=32&&new Set(names).size===names.length,'bad selection');
  names.forEach(name=>check(this.#states.has(name),'unknown channel in select'));
  for(let count=0;count<names.length;count++){
    const idx=(this.#cursor+count)%names.length,hit=this.receiveIfReady(names[idx]);
    if(hit){this.#cursor=(idx+1)%names.length;return{selected:names[idx],...hit};}
  }
  return {ready:false};
 }
 receiveIfReady(name){const s=this.#states.get(name);if(s.queue.length)return{ready:true,value:s.queue.shift()};if(s.closed)return{ready:true,closed:true};return null;}
 nbSelect(names){const result=this.select(names);return Object.freeze({kind:'Future',status:result.ready?'settled':'pending',observation:result});}
}
/** Kernel readiness never runs guest code. Reactor completion is a scheduler-owned handoff. */
export class IoReactorModel{
 #ops=new WeakMap();#leases=new WeakMap();#ready=[];#next=1;#nextReactor=0;#busy=0;
 constructor({reactors=1,limit=32}={}){check(Number.isInteger(reactors)&&reactors>=1&&reactors<=4&&Number.isInteger(limit)&&limit>0&&limit<=1024,'bounded NIO settings');this.reactors=reactors;this.limit=limit;}
 submit(owner,generation,kind){
  check(typeof owner==='string'&&owner&&Number.isSafeInteger(generation)&&generation>0&&['read','write','accept'].includes(kind),'invalid I/O operation');
  check(this.#busy<this.limit,'operation quota');
  check(Number.isSafeInteger(this.#next+1),'I/O operation ID exhausted');
  const id=this.#next++,reactor=this.#nextReactor++%this.reactors;
  const token=Object.freeze({id,generation,owner,reactor});this.#ops.set(token,{token,state:'pending'});this.#busy++;return token;
 }
 #get(token){const op=this.#ops.get(token);check(op&&op.token===token,'untrusted or stale I/O completion');return op;}
 cancel(token){const op=this.#get(token);if(op.state!=='pending')return false;op.state='cancelled';this.#busy--;return true;}
 kernelComplete(token,result){
  const op=this.#get(token);
  if(op.state!=='pending')return false;
  if(this.#ready.length>=this.limit)return false;
  const message=copyData(result);op.state='completed';this.#busy--;
  this.#ready.push(Object.freeze({owner:token.owner,generation:token.generation,id:token.id,result:message}));return true;
 }
 grantActorLease(owner,generation){
  check(typeof owner==='string'&&owner&&Number.isSafeInteger(generation)&&generation>0,'invalid actor lease identity');
  const lease=Object.freeze({});this.#leases.set(lease,{owner,generation});return lease;
 }
 drainForActor(owner,generation,{lease}={}){
  const granted=this.#leases.get(lease);
  check(granted&&granted.owner===owner&&granted.generation===generation,'guest continuation requires actor execution lease');
  const events=[];
  this.#ready=this.#ready.filter(event=>{if(event.owner!==owner||event.generation!==generation)return true;events.push(event);return false;});
  return events;
 }
 retireGeneration(owner,generation){
  check(typeof owner==='string'&&Number.isSafeInteger(generation),'bad retired generation');
  const initial=this.#ready.length;
  this.#ready=this.#ready.filter(event=>event.owner!==owner||event.generation!==generation);
  return initial-this.#ready.length;
 }
 get stats(){return Object.freeze({outstanding:this.#busy,pendingCompletions:this.#ready.length,reactors:this.reactors});}
}
/** ActorGroup membership is not supervision ownership or public mailbox authority. */
export class ActorGroupModel {
 #creator;#members=new Set();#caps=new WeakMap();#epoch=1;#closed=false;#limit;
 constructor(creator,{capacity=8}={}){
  check(typeof creator==='string'&&creator.length>0&&Number.isSafeInteger(capacity)&&capacity>0&&capacity<=64,'bad group constructor');
  this.#creator=creator;this.#members.add(creator);this.#limit=capacity;
 }
 #manager(id){check(id===this.#creator,'only creator manages group');check(!this.#closed,'group closed');}
 issue(manager){this.#manager(manager);const cap=Object.freeze({});this.#caps.set(cap,{epoch:this.#epoch});return cap;}
 rotate(manager){this.#manager(manager);this.#epoch++;return this.issue(manager);}
 join(actor,cap,{running=false}={}){
  check(running&&typeof actor==='string'&&actor,'requires live actor self');
  const proof=this.#caps.get(cap);
  check(proof&&proof.epoch===this.#epoch&&!this.#closed,'forged/stale group permit');
  if(this.#members.has(actor))return false;
  check(this.#members.size<this.#limit,'group membership quota');
  this.#members.add(actor);return true;
 }
 leave(actor,{running=false}={}){check(running&&this.#members.has(actor),'not an executing member');return this.#members.delete(actor);}
 close(manager){check(manager===this.#creator,'only creator can close');this.#closed=true;this.#epoch++;this.#members.clear();}
 get size(){return this.#members.size;}
 get closed(){return this.#closed;}
}
