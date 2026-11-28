import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Independent HOST-ONLY model. No parser, type, ownership or guest proof.
function bind(formals, operands, defaults=[]) {
 const result = new Array(formals.length), seen = new Set(), order = [];
 let next=0, named=false;
 function put(value,label) {
   let slot;
   if(label !== undefined){named=true;slot=formals.indexOf(label);if(slot<0)throw Error("unknown-parameter");}
   else {if(named)throw Error("positional-after-named");slot=next++;if(slot>=formals.length)throw Error("arity");}
   if(seen.has(slot))throw Error("duplicate-parameter");
   seen.add(slot);result[slot]=value;order.push(slot);
 }
 for(const o of operands){
   const value=o.evaluate();
   if(o.kind==="tuple"){for(const element of value)put(element);}
   else if(o.kind==="record"){for(const [label,field] of value)put(field,label);}
   else if(o.kind==="positional")put(value);
   else if(o.kind==="named")put(value,o.label);
   else throw Error("unsupported");
 }
 for(let i=0;i<formals.length;i++)if(!seen.has(i)){if(!defaults.includes(i))throw Error("missing-parameter");}
 return {result,order};
}
function* permutations(xs){if(!xs.length){yield [];return;}for(let i=0;i<xs.length;i++)for(const tail of permutations(xs.filter((_,j)=>i!==j)))yield [xs[i],...tail];}
function exercise(assert) {
 const operand=(kind,value,label)=>({kind,label,evaluate:()=>value});
 let count=0;
 const formals=["a","b","c","d","e","f"];
 for(const fields of permutations(formals)){
   const entries=fields.map((label,i)=>[label,i]);
   const pairs=fields.map((label,i)=>({get key(){throw Error("tuple key accessed");},value:i,label}));
   const tuple=bind(formals,[operand("tuple",pairs)]);
   assert.deepEqual(tuple.order,[0,1,2,3,4,5]);for(let i=0;i<6;i++)assert.equal(tuple.result[i],pairs[i]);
   const record=bind(formals,[operand("record",entries)]);
   assert.deepEqual(record.order,fields.map(x=>formals.indexOf(x)));
   for(let i=0;i<6;i++)assert.equal(record.result[i],fields.indexOf(formals[i]));
   count++;
 }
 const p={key:"a",value:4},q={key:"a",value:2};
 const whole=bind(["x","y"],[operand("tuple",[p,q])]);assert.equal(whole.result[0],p);assert.equal(whole.result[1],q);
 const recordPair=bind(["a"],[operand("record",[["a",p]])]);assert.equal(recordPair.result[0],p);
 const nested=[1,2];assert.equal(bind(["a"],[operand("tuple",[nested])]).result[0],nested);
 let trace=[];
 const x={kind:"record",evaluate(){trace.push("b");return [["b",2]];}},y={kind:"record",evaluate(){trace.push("a");return [["a",4]];}};
 assert.deepEqual(bind(["a","b"],[x,y]).result,[4,2]);assert.deepEqual(trace,["b","a"]);
 assert.deepEqual(bind(["a","b"],[operand("named",4,"a"),operand("tuple",[]),operand("named",2,"b")]).result,[4,2]);
 for(const [ops,error] of [
  [[operand("named",4,"a"),operand("tuple",[]),operand("tuple",[q])],"positional-after-named"],
  [[operand("positional",4),operand("record",[["a",2]])],"duplicate-parameter"],
  [[operand("record",[["z",4]])],"unknown-parameter"],
  [[operand("record",[["a",4],["a",2]])],"duplicate-parameter"],
  [[operand("tuple",[1,2,3])],"arity"],
  [[operand("tuple",[1])],"missing-parameter"],
  [[operand("unsupported",[])],"unsupported"]
 ])assert.throws(()=>bind(["a","b"],ops),{message:error});
 return count;
}
test('720 permutations and adversarial binding controls',()=>assert.equal(exercise(assert),720));
test('guest inventory remains unexecuted',()=>{
 const m=JSON.parse(readFileSync(new URL('../conformance/tuple-record-call-spread-v2.json',import.meta.url),'utf8'));
 assert.equal(m.status,'TARGET_NOT_EXECUTED');assert.equal(Object.keys(m.backendRoles).length,11);
 assert.ok(Object.values(m.backendRoles).every(x=>x==='NOT_EXECUTED'));
 assert.equal(new Set(m.cases.map(x=>x.id)).size,m.cases.length);assert.equal(m.cases.length,33);
 for(const c of m.cases){assert.ok(c.source.includes('pub fnc main'));if(c.expected.kind==='semantic-rejection')assert.equal(c.expected.artifact,false);else assert.equal(c.expected.kind,'return-i64');}
});
