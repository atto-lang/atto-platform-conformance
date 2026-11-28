import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

function modelApply(formals, kind, entries) {
 if(kind!=="Tuple"&&kind!=="Record")throw Error("unsupported shape");
 if(entries.length!==formals.length)throw Error("arity");
 const slots=Array(formals.length), seen=new Set();
 if(kind==="Record"&&(formals.some(x=>typeof x!=="string"||x===""||x==="_"||x.startsWith("$"))||new Set(formals).size!==formals.length))throw Error("unavailable formal names");
 entries.forEach((entry,i)=>{const slot=kind==="Tuple"?i:formals.indexOf(entry[0]);if(slot<0)throw Error("unknown name");if(seen.has(slot))throw Error("duplicate");seen.add(slot);slots[slot]=kind==="Tuple"?entry:entry[1];});
 return slots;
}

function verifyModel(apply) {
 let checks=0;const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error("model mismatch: "+JSON.stringify([a,b]));checks++;};
 const rejects=(f,msg)=>{try{f();}catch(e){eq(e.message,msg);return;}throw Error("expected rejection");};
 const perms=a=>a.length===0?[[]]:a.flatMap((x,i)=>perms(a.filter((_,j)=>i!==j)).map(p=>[x,...p]));
 for(const formals of perms(["a","b","c","d"])) for(const fields of perms(["a","b","c","d"])) {
   eq(apply(formals,"Record",fields.map((k,i)=>[k,i])),formals.map(k=>fields.indexOf(k)));
   eq(apply(formals,"Tuple",fields),fields);
 }
 const a={key:"same",value:4}, b={key:"same",value:2};eq(apply(["x","y"],"Tuple",[a,b]),[a,b]);eq(apply(["x"],"Record",[["x",a]]),[a]);eq(apply([],"Tuple",[]),[]);eq(apply([],"Record",[]),[]);
 rejects(()=>apply(["x"],"Record",[["z",4]]),"unknown name");rejects(()=>apply(["x","y"],"Record",[["x",4],["x",2]]),"duplicate");rejects(()=>apply(["x","y"],"Record",[["x",4]]),"arity");rejects(()=>apply([""],"Record",[["",4]]),"unavailable formal names");rejects(()=>apply(["x","x"],"Record",[["x",4],["x",2]]),"unavailable formal names");rejects(()=>apply(["x"],"Array",[4]),"unsupported shape");eq(apply([""],"Tuple",[42]),[42]);
 return checks;
}

test('static independent host slot model; NOT compiler execution',()=>assert.equal(verifyModel(modelApply),1163));
test('guest inventory is non-promoting, unique, and paired',()=>{const f=JSON.parse(readFileSync(new URL('../conformance/callable-tuple-record-apply-v1.json',import.meta.url),'utf8'));assert.equal(f.status,'TARGET_NOT_EXECUTED');assert.ok(Object.values(f.backendRoles).every(x=>x==='NOT_EXECUTED'));assert.equal(f.cases.length,25);assert.equal(new Set(f.cases.map(x=>x.id)).size,f.cases.length);for(const c of f.cases){assert.ok(c.source.includes('pub fnc main()'));if(c.expected.kind==='semantic-reject-no-artifact'){assert.ok(c.expected.reason);assert.ok(f.cases.some(p=>p.id===c.expected.matchedPositive&&p.expected.kind==='return-i64'));}else assert.match(c.expected.decimal,/^-?\\d+$/);}});
