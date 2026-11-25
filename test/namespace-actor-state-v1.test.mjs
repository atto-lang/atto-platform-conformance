// Source-free namespace actor state reference; NOT an Atto parser, borrow checker or guest runtime.
import test from "node:test";
import assert from "node:assert/strict";

function link(sourceSet) {
  const fail = reason => { throw Error(reason); };
  if (sourceSet?.manifestVerified !== true || !sourceSet.packageId ||
      !Array.isArray(sourceSet.units) || sourceSet.units.length === 0)
    fail("manifest-verified closed source set required");
  const identities = new Set(), actors = new Map(), schemas = new Map(), methods = new Map();
  const identity = (ns, name) => JSON.stringify([sourceSet.packageId, ns, name]);
  for (const unit of sourceSet.units) {
    if (!unit.id || identities.has(unit.id) || !unit.namespace) fail("duplicate/invalid source unit");
    identities.add(unit.id);
    for (const actor of unit.actors || []) {
      const id = identity(unit.namespace, actor.name);
      if (!actor.name || actors.has(id) || actor.extends) fail("duplicate/unsupported actor identity or unproved inheritance");
      if (!Array.isArray(actor.implements)) fail("actor contract list missing");
      actors.set(id, actor);
    }
  }
  for (const unit of sourceSet.units) {
    for (const schema of unit.states || []) {
      const id = identity(unit.namespace, schema.actor);
      if (!actors.has(id)) fail("foreign/unknown state target");
      if (schemas.has(id) || schema.public || !schema.fields?.length) fail("duplicate, public, or empty schema");
      const fields = new Set();
      for (const field of schema.fields) {
        if (!field.name || fields.has(field.name) || field.mutable !== true) fail("duplicate/invalid state field");
        fields.add(field.name);
        const kind = {int:"number",bool:"boolean",string:"string"}[field.type];
        if (!kind || typeof field.initial !== kind ||
            (field.type === "int" && !Number.isSafeInteger(field.initial)))
          fail("unproved initializer or state type");
      }
      schemas.set(id, schema);
    }
    for (const method of unit.methods || []) {
      const id = identity(unit.namespace, method.actor), actor = actors.get(id);
      if (!actor || !method.name || !Array.isArray(method.params) || !method.returnType)
        fail("unknown actor receiver or invalid signature");
      if (method.visibility !== "public" && method.visibility !== "private") fail("unknown visibility");
      if (method.visibility === "public" && !actor.public) fail("public method on private actor");
      if (method.name === "init" &&
          (method.visibility !== "private" || method.params.length || method.returnType !== "void"))
        fail("init is private void one-shot lifecycle");
      if (["handle_state","tear_down","on_panic","on_raise"].includes(method.name))
        fail("reserved runtime entrypoint");
      const slot = JSON.stringify([id,method.name,method.params.length]);
      if (methods.has(slot)) fail("duplicate method slot");
      methods.set(slot,method);
    }
  }
  const contracts = new Map((sourceSet.contracts || []).map(c=>[c.name,c]));
  for (const [id,actor] of actors) for (const name of actor.implements) {
    const contract = contracts.get(name);
    if (!contract || !contract.forActor || !contract.verified || !Array.isArray(contract.methods))
      fail("unverified actor-only nominal contract");
    for (const required of contract.methods) {
      const actual = methods.get(JSON.stringify([id,required.name,required.params.length]));
      const sig = x => JSON.stringify([x.params,x.returnType,x.visibility,!!x.suspends,x.effects||[]]);
      if (!actual || actual.visibility !== "public" || sig(actual) !== sig(required))
        fail("missing or mismatched exact method contract witness");
    }
  }
  return {actors:actors.size,schemas:schemas.size,methods:methods.size};
}

function sealedScalarRegion(defaults) {
  const initial = {...defaults}, state = {...defaults}, keys = Object.keys(initial);
  if (!keys.length || Object.values(initial).some(v=>v===null || !["string","number","boolean"].includes(typeof v)))
    throw Error("only scalar values supported");
  let generation=1, readers=0, writer=false, retiring=false, retired=false;
  return Object.freeze({
    generation:()=>generation,
    status:()=>({generation,readers,writer,retiring,retired}),
    loan(mode, expectedGeneration, callback) {
      if (retired || retiring || expectedGeneration !== generation) throw Error("stale actor generation");
      if (!["read","write"].includes(mode) || typeof callback !== "function") throw Error("forged mode/callback");
      if (writer || (mode==="write" && readers)) throw Error("conflicting loan");
      if (mode==="read") readers++; else writer=true;
      let active=true;
      const view = new Proxy(Object.create(null), {
        get(_t,k) {
          if (!active) throw Error("revoked loan");
          if (!Object.hasOwn(state,k)) throw Error("unknown field");
          return state[k];
        },
        set(_t,k,v) {
          if (!active) throw Error("revoked loan");
          if (mode==="read") throw Error("read is immutable");
          if (!Object.hasOwn(state,k) || typeof v!==typeof initial[k] ||
              (typeof v==="number"&&!Number.isSafeInteger(v))) throw Error("invalid mutation");
          state[k]=v; return true;
        },
        ownKeys(){throw Error("state reflection forbidden");},
        getOwnPropertyDescriptor(){throw Error("state reflection forbidden");}
      });
      try {
        const result=callback(view);
        if (result === view || (result!==null && (typeof result==="object" || typeof result==="function")))
          throw Error("only detached scalar results allowed");
        return result;
      } finally {
        active=false;
        if (mode==="read") readers--; else writer=false;
        if (retiring && !readers && !writer) retired=true;
      }
    },
    retire(){retiring=true;if (!readers&&!writer) retired=true;},
    reactivate(){
      if (!retired || writer || readers) throw Error("prior activation not drained");
      generation++;retiring=false;retired=false;
      for (const name of keys) state[name]=initial[name];
      return generation;
    }
  });
}

const GOOD = {
  manifestVerified:true,
  packageId:"example@1.0.0",
  units:[
    {id:"src/header.atto",namespace:"foo",actors:[{name:"Foo",public:true,implements:["ActorXYZ"]}]},
    {id:"src/state.atto",namespace:"foo",states:[{actor:"Foo",fields:[{name:"x",type:"int",initial:5,mutable:true}]}]},
    {id:"src/methods.atto",namespace:"foo",methods:[
      {actor:"Foo",name:"bar",visibility:"public",params:[],returnType:"void",effects:[],suspends:false},
      {actor:"Foo",name:"get_x",visibility:"public",params:[],returnType:"int",effects:[],suspends:false}
    ]}
  ],
  contracts:[{name:"ActorXYZ",verified:true,forActor:true,methods:[
    {name:"bar",visibility:"public",params:[],returnType:"void",effects:[],suspends:false}
  ]}]
};

test("positive: manifest-scoped actor, state, method and actor contract across three source units",()=>{
  assert.deepEqual(link(GOOD),{actors:1,schemas:1,methods:2});
});
const badCases=[
  ["missing provenance",m=>{m.manifestVerified=false;}],
  ["duplicate actor",m=>{m.units[0].actors.push({...m.units[0].actors[0]});}],
  ["duplicate state",m=>{m.units[2].states=structuredClone(m.units[1].states);}],
  ["foreign namespace",m=>{m.units[1].namespace="elsewhere";}],
  ["unknown actor",m=>{m.units[1].states[0].actor="Impostor";}],
  ["duplicate state field",m=>{m.units[1].states[0].fields.push({...m.units[1].states[0].fields[0]});}],
  ["invalid scalar initializer",m=>{m.units[1].states[0].fields[0].initial="5";}],
  ["mutable composite not proven",m=>{m.units[1].states[0].fields[0].type="Map";}],
  ["private actor public method",m=>{m.units[0].actors[0].public=false;}],
  ["duplicate external slot",m=>{m.units[2].methods.push({...m.units[2].methods[0]});}],
  ["contract targets class",m=>{m.contracts[0].forActor=false;}],
  ["contract never witnessed",m=>{m.contracts[0].verified=false;}],
  ["signature wrong return type",m=>{m.units[2].methods[0].returnType="int";}],
  ["inherited slot not proven",m=>{m.units[0].actors[0].extends="Base";}],
  ["public initializer",m=>{m.units[2].methods.push({actor:"Foo",name:"init",visibility:"public",params:[],returnType:"void"});}],
  ["init returning raw receiver",m=>{m.units[2].methods.push({actor:"Foo",name:"init",visibility:"private",params:[],returnType:"f"});}],
  ["spoof sealed handle_state",m=>{m.units[2].methods.push({actor:"Foo",name:"handle_state",visibility:"private",params:[],returnType:"void"});}]
];
for(const [label,change] of badCases) test("reject: "+label,()=>{
  const m=structuredClone(GOOD);change(m);assert.throws(()=>link(m));
});
test("read/read permitted, write excluded, read immutable, and no reflection",()=>{
  const r=sealedScalarRegion({x:5}),g=r.generation();let saved;
  r.loan("read",g,s=>{
    saved=s;
    r.loan("read",g,t=>assert.equal(t.x,5));
    assert.throws(()=>r.loan("write",g,t=>{t.x=8;}));
    assert.throws(()=>{s.x=10;});
    assert.throws(()=>Object.keys(s));
  });
  assert.throws(()=>saved.x);
  r.loan("write",g,s=>{s.x=9;});
  assert.equal(r.loan("read",g,s=>s.x),9);
  assert.throws(()=>r.loan("untrusted",g,s=>s.x));
});
test("throw unwinds, stale view revoked, object/loan results rejected",()=>{
  const r=sealedScalarRegion({x:5}),g=r.generation();let escaped;
  assert.throws(()=>r.loan("write",g,s=>{escaped=s;throw Error("fault");}));
  assert.throws(()=>escaped.x);
  assert.throws(()=>r.loan("read",g,s=>s));
  assert.throws(()=>r.loan("read",g,s=>({x:s.x})));
  assert.equal(r.status().readers,0);
  assert.equal(r.status().writer,false);
});
test("STOP drains physically, rejects arrivals, restarts with new epoch and initial state",()=>{
  const r=sealedScalarRegion({x:5}),g=r.generation();
  r.loan("write",g,s=>{
    s.x=42;r.retire();
    assert.equal(r.status().retired,false);
    assert.throws(()=>r.loan("read",g,t=>t.x));
  });
  assert.equal(r.status().retired,true);
  assert.throws(()=>r.loan("read",g,t=>t.x));
  const next=r.reactivate();
  assert.equal(next,g+1);
  assert.throws(()=>r.loan("write",g,t=>{t.x=1;}));
  assert.equal(r.loan("read",next,t=>t.x),5);
});
