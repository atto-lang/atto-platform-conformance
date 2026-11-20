import {types} from 'node:util';
/* Wave 5: bounded, host-only model of actor-owned memory capabilities.
   NOT a heap allocator or compiled Oreslang guest representation. */
const fail = reason => {throw new Error('wave5-memory: '+reason)};
const ensure=(ok,msg)=>{if(!ok)fail(msg)};
const maxDepth=12,maxNodes=512;
function cloneData(input,depth=0,counter={n:0}){
 ensure(depth<=maxDepth&&++counter.n<=maxNodes,'data depth/node budget');
 ensure(!types.isProxy(input),'proxy data cannot acquire actor heap authority');
 if(input===null||typeof input==='boolean'||typeof input==='string')return input;
 if(typeof input==='number'){ensure(Number.isSafeInteger(input),'portable integer required');return input}
 if(Array.isArray(input)){
  ensure(Object.getPrototypeOf(input)===Array.prototype&&input.length<=64&&
   Reflect.ownKeys(input).length===input.length+1,'dense plain array required');
  const copy=[];
  for(let i=0;i<input.length;i++){
   const d=Object.getOwnPropertyDescriptor(input,String(i));
   ensure(d&&Object.hasOwn(d,'value'),'array getters/setters cannot acquire actor heap authority');
   copy.push(cloneData(d.value,depth+1,counter));
  }
  return Object.freeze(copy);
 }
 ensure(input&&typeof input==='object'&&(Object.getPrototypeOf(input)===Object.prototype||Object.getPrototypeOf(input)===null),'only detached records');
 const keys=Object.keys(input);ensure(keys.length<=64&&Reflect.ownKeys(input).length===keys.length,'record fields/symbol quota');
 const record=Object.create(null);
 for(const key of keys){
  ensure(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(key)&&key!=='constructor'&&key!=='__proto__','unsafe record key');
  const d=Object.getOwnPropertyDescriptor(input,key);
  ensure(d&&Object.hasOwn(d,'value'),'getters/setters cannot acquire actor heap authority');
  Object.defineProperty(record,key,{value:cloneData(d.value,depth+1,counter),enumerable:true});
 }
 return Object.freeze(record);
}
export class ActorMemoryAuthority {
 #actors=new Map();#identity=new WeakMap();#handles=new WeakMap();#readViews=new WeakMap();
 constructor({maxActors=32,maxBlocksPerActor=1024,maxTotalBytes=1<<20}={}){
  ensure(Number.isInteger(maxActors)&&maxActors>0&&maxActors<=1024,'actor count bound');
  ensure(Number.isInteger(maxBlocksPerActor)&&maxBlocksPerActor>0&&maxBlocksPerActor<=16384,'block bound');
  ensure(Number.isSafeInteger(maxTotalBytes)&&maxTotalBytes>0&&maxTotalBytes<=1<<29,'global byte bound');
  this.maxActors=maxActors;this.maxBlocksPerActor=maxBlocksPerActor;this.maxTotalBytes=maxTotalBytes;
 }
 #resolve(cap){
  const id=this.#identity.get(cap);
  ensure(id&&this.#actors.get(id.name)===id&&id.alive,'forged/stale actor authority');
  return id;
 }
 #handle(actor,handle){
  const h=this.#handles.get(handle);
  ensure(h&&h.actor===actor&&h.generation===actor.generation&&h.alive,'foreign/stale memory block');
  return h;
 }
 #used(){return [...this.#actors.values()].reduce((n,a)=>n+a.bytes,0)}
 createActor(name,quota=65536){
  ensure(typeof name==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(name),'invalid actor name');
  ensure(Number.isSafeInteger(quota)&&quota>=1&&quota<=this.maxTotalBytes,'actor budget');
  ensure(!this.#actors.get(name)?.alive&&[...this.#actors.values()].filter(a=>a.alive).length<this.maxActors,'actor exists/capacity');
  const prev=this.#actors.get(name);
  const actor={name,generation:prev?prev.generation+1:1,quota,bytes:0,blocks:new Set(),alive:true};
  ensure(Number.isSafeInteger(actor.generation),'generation overflow');
  this.#actors.set(name,actor);
  const cap=Object.freeze({});this.#identity.set(cap,actor);return cap;
 }
 allocate(cap,value){
  const actor=this.#resolve(cap);ensure(actor.blocks.size<this.maxBlocksPerActor,'block count');
  const data=cloneData(value);const encoded=JSON.stringify(data);
  const charge=Math.max(1,Buffer.byteLength(encoded,'utf8'));
  ensure(actor.bytes+charge<=actor.quota&&this.#used()+charge<=this.maxTotalBytes,'actor/global quota');
  const handle=Object.freeze({});const h={actor,generation:actor.generation,data,charge,alive:true};
  actor.blocks.add(h);actor.bytes+=charge;this.#handles.set(handle,h);return handle;
 }
 read(cap,handle){const actor=this.#resolve(cap);return this.#handle(actor,handle).data}
 drop(cap,handle){const actor=this.#resolve(cap),h=this.#handle(actor,handle);h.alive=false;actor.blocks.delete(h);actor.bytes-=h.charge;return true}
 copyTo(fromCap,toCap,handle){
  const from=this.#resolve(fromCap),to=this.#resolve(toCap),h=this.#handle(from,handle);
  return this.allocate(toCap,h.data);
 }
 snapshotFor(cap,handle,otherCap){
  const from=this.#resolve(cap),to=this.#resolve(otherCap);const h=this.#handle(from,handle);
  const view=Object.freeze({});this.#readViews.set(view,{owner:from,ownerGeneration:from.generation,reader:to,readerGeneration:to.generation,handle:h});
  return view;
 }
 readSnapshot(readerCap,view){
  const reader=this.#resolve(readerCap),v=this.#readViews.get(view);
  ensure(v&&v.reader===reader&&v.readerGeneration===reader.generation&&v.owner.alive&&v.owner.generation===v.ownerGeneration&&v.handle.alive,'expired/foreign shared snapshot');
  return v.handle.data;
 }
 retire(cap){
  const actor=this.#resolve(cap);
  for(const h of actor.blocks)h.alive=false;
  actor.blocks.clear();actor.bytes=0;actor.alive=false;actor.generation++;
 }
 stats(cap){const a=this.#resolve(cap);return Object.freeze({bytes:a.bytes,blocks:a.blocks.size,generation:a.generation})}
}
