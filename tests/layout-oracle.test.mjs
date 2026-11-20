import test from "node:test";
import assert from "node:assert/strict";
import { LayoutOracle } from "../src/layout-oracle.mjs";

for (const layout of ["aos","soa","aosoa","soaos"]) {
  test(layout + ": generational handles, updates and slot reuse", () => {
    const store=new LayoutOracle(["x","y"],layout,2);
    const a=store.insert({x:40,y:2});
    const b=store.insert({x:1,y:3});
    assert.deepEqual(store.read(a),{x:40,y:2});
    store.write(a,"x",41);
    assert.deepEqual(store.read(a),{x:41,y:2});
    store.remove(a);
    assert.throws(()=>store.read(a),/stale/);
    const c=store.insert({x:5,y:6});
    assert.equal(c.slot,a.slot);
    assert.notEqual(c.generation,a.generation);
    assert.deepEqual(store.read(b),{x:1,y:3});
    assert.deepEqual(store.read(c),{x:5,y:6});
  });
}
test("all layout snapshots preserve the same logical values",()=>{
  const s=new LayoutOracle(["x","y"],"aos",2);
  const a=s.insert({x:1,y:2}), b=s.insert({x:3,y:4}), c=s.insert({x:5,y:6});
  assert.deepEqual(s.snapshot(),[{x:1,y:2},{x:3,y:4},{x:5,y:6}]);
  s.convert("soa"); assert.deepEqual(s.snapshot(),{x:[1,3,5],y:[2,4,6]});
  s.convert("aosoa"); assert.deepEqual(s.snapshot(),[{x:[1,3],y:[2,4]},{x:[5],y:[6]}]);
  s.convert("soaos"); assert.deepEqual(s.snapshot(),[[{x:1,y:2},{x:3,y:4}],[{x:5,y:6}]]);
  assert.deepEqual(s.read(a),{x:1,y:2});
  assert.deepEqual(s.read(b),{x:3,y:4});
  assert.deepEqual(s.read(c),{x:5,y:6});
});
test("reject malformed schemas, rows and stale handles",()=>{
  assert.throws(()=>new LayoutOracle(["x","x"],"soa"));
  assert.throws(()=>new LayoutOracle(["x"],"bad"));
  const s=new LayoutOracle(["x"],"soa");
  assert.throws(()=>s.insert({y:1}));
  const h=s.insert({x:2});
  assert.throws(()=>s.write(h,"missing",0));
  s.remove(h);
  assert.throws(()=>s.remove(h),/stale/);
});
