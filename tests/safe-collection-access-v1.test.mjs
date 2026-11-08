import test from "node:test";
import assert from "node:assert/strict";
import { CollectionLoanModel, MAX_DENSE_LENGTH } from "../contracts/v1/safe-collection-access-v1/reference.mjs";
const A = "actor-A", B = "actor-B";
const c = (p = {}) => new CollectionLoanModel({ length: 2, ...p });
const takeSome = o => { assert.equal(o.variant, "Some"); return o.value; };
const denied = (f, code) => assert.throws(f, e => e?.code === code);
test("bounded reads and misses yield Some/None, not a sentinel", () => {
  const m = c();
  for (const i of [-1, 2, -999n, 0xffff_ffffn, (1n << 63n) - 1n])
    assert.equal(m.get(A, i).variant, "None");
  assert.equal(m.loanCount, 0);
  for (const i of [0, 1, 0n, 1n]) {
    const loan = takeSome(m.get(A, i));
    assert.equal(m.useRead(A, loan), Number(i));
    m.release(A, loan);
  }
  assert.equal(m.loanCount, 0);
});
test("empty collection get/getMut/pop all return None", () => {
  const m = c({length:0});
  assert.equal(m.get(A, 0).variant, "None");
  assert.equal(m.getMut(A, 0).variant, "None");
  assert.equal(m.pop(A).variant, "None");
});
test("checked indexing is bounded and never undefined behavior", () => {
  const m = c();
  assert.equal(m.checkedIndex(A, 1n), 1);
  for (const i of [-1,2,0xffff_ffffn]) denied(() => m.checkedIndex(A,i),"E_INDEX_BOUNDS");
  for (const i of [NaN,Infinity,0.25,"0",null,9007199254740992])
    denied(() => m.get(A,i),"E_INDEX_TYPE");
});
test("READ/READ is permitted, READ/WRITE conflicts until all loans end", () => {
  const m = c(), r1 = takeSome(m.get(A,0)), r2 = takeSome(m.get(A,1));
  denied(() => m.getMut(A,0),"E_LOAN_CONFLICT");
  m.release(A,r1);
  denied(() => m.getMut(A,0),"E_LOAN_CONFLICT");
  m.release(A,r2);
  const w = takeSome(m.getMut(A,0));
  assert.equal(m.useWrite(A,w),0);
  m.release(A,w);
});
test("WRITE excludes READ and WRITE; READ lacks mutation rights", () => {
  const m = c(), w = takeSome(m.getMut(A,0));
  denied(() => m.get(A,1),"E_LOAN_CONFLICT");
  denied(() => m.getMut(A,1),"E_LOAN_CONFLICT");
  m.release(A,w);
  const r = takeSome(m.get(A,0));
  denied(() => m.useWrite(A,r),"E_LOAN_READ_ONLY");
  m.release(A,r);
});
test("forged, revoked and double-released loans are invalid", () => {
  const m = c(), r = takeSome(m.get(A,0));
  denied(() => m.useRead(A,{...r}),"E_STALE_LOAN");
  denied(() => m.release(A,{...r}),"E_STALE_LOAN");
  m.release(A,r);
  denied(() => m.useRead(A,r),"E_STALE_LOAN");
  denied(() => m.release(A,r),"E_STALE_LOAN");
});
test("no reallocation, removal or growth under a live loan", () => {
  for (const op of ["get","getMut"]) {
    const m = c(), r = takeSome(m[op](A,0));
    const old = [m.length,m.capacity,m.epoch];
    denied(() => m.push(A),"E_LOAN_CONFLICT");
    denied(() => m.pop(A),"E_LOAN_CONFLICT");
    denied(() => m.reserve(A,4),"E_LOAN_CONFLICT");
    assert.deepEqual([m.length,m.capacity,m.epoch],old);
    m.release(A,r);
    m.reserve(A,4);
    assert.equal(m.capacity,4);
  }
});
test("reserve without relocation preserves live reads", () => {
  const m = c({capacity:4}), r = takeSome(m.get(A,0)), epoch = m.epoch;
  m.reserve(A,4);
  m.reserve(A,2);
  assert.equal(m.epoch,epoch);
  assert.equal(m.useRead(A,r),0);
  m.release(A,r);
});
test("pop returns an owned Some; empty returns None", () => {
  const m = c({length:0,capacity:0}), old = m.epoch;
  m.push(A);
  assert.equal(m.length,1);
  assert.ok(m.epoch > old);
  assert.deepEqual(takeSome(m.pop(A)),{movedElementAt:0});
  assert.equal(m.pop(A).variant,"None");
});
test("32-bit dense capacity overflows reject transactionally", () => {
  const m = c({length:MAX_DENSE_LENGTH,capacity:MAX_DENSE_LENGTH});
  const old=[m.length,m.capacity,m.epoch];
  denied(() => m.push(A),"E_COLLECTION_CAPACITY");
  denied(() => m.reserve(A,0xffff_ffff),"E_COLLECTION_CAPACITY");
  assert.deepEqual([m.length,m.capacity,m.epoch],old);
});
test("owned copy is opt-in; no accidental move-only duplication", () => {
  denied(() => c().getCopy(A,0),"E_COPY_REQUIRED");
  const m = c({copyable:true});
  assert.deepEqual(takeSome(m.getCopy(A,1)),{ownedCopyOfIndex:1});
  assert.equal(m.getCopy(A,2).variant,"None");
  assert.equal(m.loanCount,0);
});
test("read-only view cannot make mutable backing Share", () => {
  denied(() => c().immutableShare(A),"E_SHARE_NOT_FROZEN");
  const m=c({immutable:true});
  assert.equal(m.immutableShare(A).immutable,true);
  denied(() => m.getMut(A,0),"E_IMMUTABLE");
  denied(() => m.push(A),"E_IMMUTABLE");
  denied(() => m.pop(A),"E_IMMUTABLE");
});
test("loan does not survive suspension or escape via Option", () => {
  const m=c(), r=takeSome(m.get(A,0));
  denied(() => m.suspend(A),"E_LOAN_SUSPEND");
  denied(() => m.escapeLoan(A,r),"E_LOAN_ESCAPE");
  m.release(A,r);
  m.suspend(A);
});
test("foreign actor access never bypasses owner identity", () => {
  const m=c();
  denied(() => m.get(B,0),"E_ACTOR_ISOLATION");
  denied(() => m.getMut(B,0),"E_ACTOR_ISOLATION");
  denied(() => m.checkedIndex(B,0),"E_ACTOR_ISOLATION");
  const r=takeSome(m.get(A,0));
  denied(() => m.useRead(B,r),"E_ACTOR_ISOLATION");
  denied(() => m.release(B,r),"E_ACTOR_ISOLATION");
  m.release(A,r);
});
test("rt take requires no live loan and fences previous actor", () => {
  const m=c(), r=takeSome(m.get(A,0));
  denied(() => m.moveOwner(A,B),"E_LOAN_CONFLICT");
  m.release(A,r);
  const generation=m.generation;
  m.moveOwner(A,B);
  assert.ok(m.generation>generation);
  denied(() => m.get(A,0),"E_ACTOR_ISOLATION");
  const newRead=takeSome(m.get(B,1));
  m.release(B,newRead);
});
test("immutable owner can move; immutable referent cannot mutate", () => {
  const m=c({immutable:true});
  m.moveOwner(A,B);
  assert.equal(takeSome(m.get(B,0)).kind,"READ");
  denied(() => m.push(B),"E_IMMUTABLE");
});
test("retiring an actor with live loans is denied", () => {
  const m=c(), r=takeSome(m.get(A,0));
  denied(() => m.retire(A),"E_LOAN_CONFLICT");
  m.release(A,r);
  m.retire(A);
  denied(() => m.get(A,0),"E_OWNER_RETIRED");
  denied(() => m.pop(A),"E_OWNER_RETIRED");
});
