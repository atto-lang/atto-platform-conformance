/* Backend-neutral executable reference policy. Not a compiler or guest runtime. */
export const BACKENDS=Object.freeze(['java','llvm','net','wasm','forge']);
export const SEVERITY=Object.freeze({normal:0,throw:1,raise:2,panic:3,cancel:4,host_fatal:5});
const assert=(condition,msg)=>{if(!condition)throw new Error('wave3: '+msg)};
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;

/** All defers are attempted in reverse order, then finally, even after a failed cleanup. */
export function unwind({primary={kind:'normal',detail:''},deferred=[],finallyAction}={}) {
 assert(plain(primary)&&Object.hasOwn(SEVERITY,primary.kind),'unknown primary exit');
 assert(Array.isArray(deferred)&&deferred.length<=64&&deferred.every(x=>typeof x==='function'),'invalid defer stack');
 assert(finallyAction===undefined||typeof finallyAction==='function','invalid finally');
 const attempted=[],suppressed=[];let winner=Object.freeze({...primary});
 function perform(label,action){
  attempted.push(label);
  try{ const value=action();assert(value===undefined,'cleanup must not replace return value'); }
  catch(e){
   const f=plain(e)&&Object.hasOwn(SEVERITY,e.kind)?{kind:e.kind,detail:String(e.detail??'')}: {kind:'host_fatal',detail:'unclassified cleanup failure'};
   if(SEVERITY[f.kind]>SEVERITY[winner.kind]){if(winner.kind!=='normal')suppressed.push(winner);winner=Object.freeze(f);}
   else if(suppressed.length<64)suppressed.push(Object.freeze(f));
  }
 }
 for(let i=deferred.length-1;i>=0;i--)perform('defer:'+i,deferred[i]);
 if(finallyAction)perform('finally',finallyAction);
 return Object.freeze({terminal:winner,attempted:Object.freeze(attempted),suppressed:Object.freeze(suppressed)});
}

/** Validate full transitive dependency closure, not only direct imports. */
export function validateLibraryGraph(units,root,{profile='freestanding'}={}){
 assert(['freestanding','embedded-rtos','hosted'].includes(profile),'invalid target profile');
 assert(plain(units)&&Object.keys(units).length>0&&Object.keys(units).length<=256,'invalid library graph');
 assert(typeof root==='string'&&Object.hasOwn(units,root),'unknown entry library');
 const visited=new Set(),active=new Set(),order=[];
 const allowed={freestanding:new Set(['core']), 'embedded-rtos':new Set(['core','hal']),hosted:new Set(['core','hal','std'])}[profile];
 function dfs(id){
  assert(Object.hasOwn(units,id),'unresolved dependency '+id);
  assert(!active.has(id),'dependency cycle '+id);
  if(visited.has(id))return;
  const u=units[id];assert(plain(u)&&['core','hal','std'].includes(u.layer)&&Array.isArray(u.deps)&&u.deps.length<=64,'invalid unit');
  assert(allowed.has(u.layer),'forbidden '+u.layer+' in '+profile);
  if(u.layer==='core')assert(u.deps.every(child=>units[child]?.layer==='core'),'core imports host/platform library');
  if(u.layer==='hal')assert(u.deps.every(child=>['core','hal'].includes(units[child]?.layer)),'HAL depends on std');
  assert(new Set(u.deps).size===u.deps.length,'duplicate dependencies');
  active.add(id);
  for(const dep of u.deps){assert(typeof dep==='string'&&dep!=='__proto__','invalid dependency name');dfs(dep);}
  active.delete(id);visited.add(id);order.push(id);
 }
 dfs(root);
 return Object.freeze({profile,root,closure:Object.freeze(order),freestanding:profile==='freestanding'});
}

/** Reference authority: opaque minted local handles, never a serializable remote credential. */
export class LocalActorRegistry {
 #issuer=new WeakMap();#slots=new Map();#next=0;
 constructor({capacity=16,mailboxCapacity=8}={}){
  assert(Number.isSafeInteger(capacity)&&capacity>0&&capacity<=65536,'bad capacity');
  assert(Number.isSafeInteger(mailboxCapacity)&&mailboxCapacity>0&&mailboxCapacity<=65536,'bad mailbox capacity');
  this.capacity=capacity;this.mailboxCapacity=mailboxCapacity;
 }
 #lookup(ref){
  assert(ref!==null&&typeof ref==='object'&&this.#issuer.has(ref),'foreign or forged actor reference');
  const key=this.#issuer.get(ref),slot=this.#slots.get(key.id);
  assert(slot?.alive&&slot.generation===key.generation,'stale actor incarnation');
  return slot;
 }
 spawn(){
  let id;
  for(let x=1;x<=this.#next;x++)if(!this.#slots.get(x).alive){id=x;break;}
  if(!id){assert(this.#slots.size<this.capacity,'actor capacity exhausted');id=++this.#next;}
  const old=this.#slots.get(id);
  const generation=old?old.generation+1:1;
  assert(Number.isSafeInteger(generation),'generation overflow');
  this.#slots.set(id,{generation,alive:true,mail:[]});
  const handle=Object.freeze({toJSON(){throw new TypeError('local ActorRef is not wire-serializable');}});
  this.#issuer.set(handle,{id,generation});return handle;
 }
 send(ref,payload){
  const slot=this.#lookup(ref);
  assert(slot.mail.length<this.mailboxCapacity,'mailbox full');
  assert(typeof payload==='number'&&Number.isSafeInteger(payload),'only local scalar messages in reference model');
  slot.mail.push(payload);return slot.mail.length;
 }
 read(ref){const slot=this.#lookup(ref);return slot.mail.shift()??null;}
 stop(ref){const slot=this.#lookup(ref);slot.mail.length=0;slot.alive=false;}
}

/** Compile-time hook authority reference only. */
export function actorHookPolicy({name='receive',declaredIn='HiddenActorBase',implementedIn='UserActor',caller='user',operation='call',visibility='private',abstract=true,overrideVisibility='private',valueArity=1,inlineSelf=false}={}){
 assert(name==='receive','only the reserved receive hook is modeled');
 assert(typeof declaredIn==='string'&&declaredIn.length>0&&typeof implementedIn==='string'&&implementedIn.length>0,'invalid hook owner');
 assert(visibility==='private'&&abstract===true&&overrideVisibility==='private','hook authority or visibility widening');
 assert(Number.isSafeInteger(valueArity)&&valueArity>=0&&valueArity<=16,'invalid value arity');
 assert(['call','reference','override'].includes(operation),'unsupported hook operation');
 if(operation==='override')return Object.freeze({allowed:true,slot:name+'/'+valueArity,receiver:inlineSelf?'explicit-erased':'implicit'});
 assert(operation!=='reference','hook method references forbidden');
 assert(caller==='trusted-hidden-base'&&declaredIn==='HiddenActorBase','only declaring trusted superclass can invoke');
 return Object.freeze({allowed:true,slot:name+'/'+valueArity,receiver:inlineSelf?'explicit-erased':'implicit'});
}

/** Single native lane; unfinished logical message lifetimes may coexist. */
export class SingleFlightModel {
 #actors=new Map();
 constructor({maxOutstanding=3,maxReady=8}={}){assert(Number.isSafeInteger(maxOutstanding)&&maxOutstanding>0&&maxOutstanding<=64,'bad lifetime bound');assert(Number.isSafeInteger(maxReady)&&maxReady>0&&maxReady<=64,'bad ready bound');this.maxOutstanding=maxOutstanding;this.maxReady=maxReady;}
 create(id){assert(typeof id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(id)&&!this.#actors.has(id),'invalid/duplicate actor');this.#actors.set(id,{next:1,active:null,lifetimes:new Map(),ready:[]});}
 #a(id){const a=this.#actors.get(id);assert(a,'unknown actor');return a;}
 send(id){const a=this.#a(id);assert(a.lifetimes.size<this.maxOutstanding,'too many outstanding messages');assert(a.ready.length<this.maxReady,'ready queue full');const ticket=a.next++;a.lifetimes.set(ticket,'ready');a.ready.push(ticket);return ticket;}
 enter(id,carrier){const a=this.#a(id);assert(a.active===null,'parallel guest execution denied');assert(typeof carrier==='string'&&carrier.length>0,'invalid carrier');const ticket=a.ready.shift();assert(ticket!==undefined,'nothing ready');assert(a.lifetimes.get(ticket)==='ready','ready state mismatch');a.lifetimes.set(ticket,'running');a.active={ticket,carrier};return ticket;}
 suspend(id,ticket){const a=this.#a(id);assert(a.active!==null&&a.active.ticket===ticket,'not active turn');a.active=null;a.lifetimes.set(ticket,'suspended');}
 resume(id,ticket){const a=this.#a(id);assert(a.lifetimes.get(ticket)==='suspended','double or illegal resume');assert(a.ready.length<this.maxReady,'ready queue full');a.lifetimes.set(ticket,'ready');a.ready.push(ticket);}
 finish(id,ticket){const a=this.#a(id);assert(a.active!==null&&a.active.ticket===ticket,'not active turn');a.active=null;a.lifetimes.delete(ticket);}
 cancel(id,ticket){const a=this.#a(id);assert(a.lifetimes.has(ticket),'unknown ticket');assert(a.active?.ticket!==ticket,'cannot retire currently running turn inline');a.lifetimes.delete(ticket);a.ready=a.ready.filter(t=>t!==ticket);}
 snapshot(id){const a=this.#a(id);return Object.freeze({active:a.active&&{...a.active},outstanding:a.lifetimes.size,ready:[...a.ready],states:[...a.lifetimes.entries()]});}
}
