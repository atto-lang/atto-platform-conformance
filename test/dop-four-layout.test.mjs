import test from 'node:test';

import { FourLayoutOracle } from '../verification/dop-four-layout-reference.mjs';

// This verifies the contract oracle, not generated Oreslang guest code.

function check(condition, description) { if (!condition) throw new Error("four-layout check: " + description); }

function reject(operation, description) {
  let failed = false;
  try { operation(); } catch { failed = true; }
  check(failed, description);
}

function runChecks() {
  const fields = ["x", "y", "vx", "vy"];
  const configs = [
    {layout:"aos"},{layout:"soa"},{layout:"aosoa",tileWidth:4},
    {layout:"aosoa",tileWidth:8},{layout:"soaos",groups:[["x","y"],["vx","vy"]]}
  ];
  for (const length of [0, 1, 3, 4, 5, 8, 17, 129]) {
    for (const config of configs) {
      const store = new FourLayoutOracle({owner:"actor-7/incarnation-2",fields,capacity:length,...config});
      const handles = [];
      for (let i = 0; i < length; ++i) {
        handles.push(store.push({x:i, y:-i, vx:i===2?-0:i+0.25, vy:i===4?NaN:i*3}));
      }
      check(store.count === length, "count "+config.layout);
      for (let i = 0; i < length; ++i) {
        check(Object.is(store.read(handles[i],"x"),i), "x roundtrip");
        check(Object.is(store.read(handles[i],"vx"),i===2?-0:i+0.25), "signed zero roundtrip");
        check(Object.is(store.read(handles[i],"vy"),i===4?NaN:i*3), "NaN roundtrip");
      }
      reject(() => store.push({x:1,y:2,vx:3,vy:4}), "capacity");
      if (length >= 2) {
        const dead = handles[0], surviving = handles[length-1];
        store.eraseSwap(dead);
        reject(() => store.read(dead,"x"), "stale deletion");
        check(store.read(surviving,"x")===length-1, "swap-delete stable handle");
        const replacement = store.push({x:91,y:92,vx:93,vy:94});
        reject(() => store.read(dead,"x"), "slot recycling ABA");
        check(store.read(replacement,"x")===91, "replacement");
      }
      for (const target of configs) {
        store.convert(target.layout, target.tileWidth===undefined?
          (target.groups?{groups:target.groups}:{}) : {tileWidth:target.tileWidth});
        check(store.count===length, "conversion count");
        if (length >= 2) check(store.read(handles[length-1],"x")===length-1, "conversion stable ID");
      }
      store.retire();
      if (length) reject(() => store.read(handles[length-1],"x"), "retirement");
    }
  }
  const s = new FourLayoutOracle({owner:"a",fields,capacity:8,layout:"soaos",groups:[["x","y"],["vx","vy"]]});
  const h=s.push({x:1,y:2,vx:3,vy:4});
  check(s.address(1,"x").element===2 && s.address(1,"y").element===3,"SoAoS subrecord strides");
  const aosoa = new FourLayoutOracle({owner:"a",fields,capacity:8,layout:"aosoa",tileWidth:4});
  check(aosoa.address(1,"x").element===1 && aosoa.address(1,"y").element===5,"AoSoA tiles");
  check(s.address(1,"x").element!==aosoa.address(1,"x").element,"SoAoS is not AoSoA");
  const loanX=s.borrow(["x"],"write"), loanY=s.borrow(["y"],"write");
  loanX.write(h,"x",10);loanY.write(h,"y",20);
  check(loanX.read(h,"x")===10 && loanY.read(h,"y")===20,"disjoint write loans");
  reject(()=>s.borrow(["x"],"read"),"write/read collision");
  reject(()=>s.read(h,"x"),"read outside write loan");
  reject(()=>s.write(h,"x",11),"write outside loan");
  reject(()=>loanX.write(h,"y",20),"field escalation");
  reject(()=>s.convert("aos"),"loan blocks conversion");
  reject(()=>s.eraseSwap(h),"loan blocks compaction");
  loanX.release();loanY.release();
  reject(()=>loanX.read(h,"x"),"released loan revocation");
  check(s.read(h,"x")===10,"loan teardown");
  reject(()=>s.read({...h},"x"),"forged metadata must not issue handle");
  const foreign=new FourLayoutOracle({owner:"a",fields,capacity:2,layout:"aos"});
  reject(()=>foreign.read(h,"x"),"same owner but foreign memory domain");
  reject(()=>new FourLayoutOracle({owner:"a",fields,capacity:2,layout:"soaos",groups:[["x","y"],["y","vx","vy"]]}),"duplicate groups");
  reject(()=>new FourLayoutOracle({owner:"a",fields,capacity:2,layout:"soaos",groups:[["x","y"],["vx"]]}),"missing groups");
  reject(()=>new FourLayoutOracle({owner:"a",fields,capacity:2,layout:"aosoa",tileWidth:0}),"zero tile width");
  reject(()=>new FourLayoutOracle({owner:"a",fields,capacity:2,layout:"aosoa",tileWidth:1025}),"large tile width");
  reject(()=>new FourLayoutOracle({owner:"a",fields,capacity:1000001,layout:"aos"}),"bounded oracle");
  reject(()=>new FourLayoutOracle({owner:"a",fields,capacity:1,layout:"unknown"}),"unknown layout");
  const empty=new FourLayoutOracle({owner:"a",fields,capacity:0,layout:"aosoa",tileWidth:8});
  check(empty.count===0,"empty tile store");
  reject(()=>empty.address(0,"x"),"padded tails not live rows");
  s.retire();
  reject(()=>s.push({x:1,y:2,vx:3,vy:4}),"retired actor domain");
  const dangerousFields = ["__proto__", "constructor"];
  const grouped = new FourLayoutOracle({
    owner:"special",fields:dangerousFields,capacity:2,layout:"soaos",groups:[dangerousFields]
  });
  const special = grouped.push(Object.fromEntries([["__proto__", 4],["constructor", 5]]));
  check(grouped.read(special,"__proto__")===4 && grouped.read(special,"constructor")===5,
    "field names cannot collide with object prototypes");
  reject(()=>grouped.address(0,"toString"),"inherited property must not be a field");
  reject(()=>grouped.address(0,"hasOwnProperty"),"inherited method must not be a field");

  const transactional = new FourLayoutOracle({owner:"tx",fields,capacity:1,layout:"soa"});
  const badRecord = Object.fromEntries([["x", 1],["y", 2],["vx", 3],["vy", 4]]);
  Object.defineProperty(badRecord,"vx",{
    enumerable:true,get(){ throw new Error("getter failed"); }
  });
  reject(()=>transactional.push(badRecord),"row getter throw");
  check(transactional.count===0,"failed getter did not publish a partially inserted row");
  const valid = transactional.push({x:1,y:2,vx:3,vy:4});
  check(transactional.read(valid,"vx")===3,"failed insert must not burn capacity");
  return true;
}

test('AoS/SoA/AoSoA/SoAoS layouts, field loans, stable handles, invalidation and tails', runChecks);

