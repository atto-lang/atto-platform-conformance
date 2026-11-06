// Adversarial transactional checks for the SOURCE-FREE inverted reference.
// A green result here does not qualify an AttoLang compiler or native guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {compile_inverted_layout, InvertedReferenceStore} from '../src/inverted-layout-reference.mjs';

const single = compile_inverted_layout({
  Row: {kind:'inverted-struct', fields:{x:'i64'}}
}, 'Row');
const packed = compile_inverted_layout({
  Payload: {kind:'struct', fields:{v:'i64'}},
  Row: {kind:'inverted-struct', fields:{
    payload:{type:'Payload',mutable:true}, id:'i64'
  }}
}, 'Row');

function filledStore() {
  const store = new InvertedReferenceStore(packed,2);
  const one = store.push({payload:{v:1n},id:11n});
  const two = store.push({payload:{v:2n},id:12n});
  return {store,one,two};
}

test('proxy descriptor cannot reenter push and breach capacity-1 quota', () => {
  const store = new InvertedReferenceStore(single,1);
  let invoked = false;
  const row = new Proxy({x:1n}, {
    getOwnPropertyDescriptor(target,key) {
      if (!invoked) {
        invoked = true;
        store.push({x:2n});
      }
      return Object.getOwnPropertyDescriptor(target,key);
    }
  });
  assert.throws(()=>store.push(row),/reentrant/);
  assert.equal(store.length,0);
  const h=store.push({x:3n});
  assert.equal(store.length,1);
  assert.equal(store.get_field(h,'x'),3n);
  assert.throws(()=>store.push({x:4n}),/full/);
});

test('even a caught reentrant attempt cannot change the owner quota',()=>{
  const store = new InvertedReferenceStore(single,1);
  let rejected = false;
  const row = new Proxy({x:7n},{
    ownKeys(target) {
      try { store.push({x:99n}); }
      catch(e) { rejected = /reentrant/.test(String(e)); }
      return Reflect.ownKeys(target);
    }
  });
  assert.throws(()=>store.push(row),/tainted/);
  assert.equal(rejected,true);
  assert.equal(store.length,0);
  const h=store.push({x:8n});
  assert.equal(store.length,1);
  assert.equal(store.get_field(h,'x'),8n);
});

test('nested packed-value getter cannot swap-delete while set_field validates',()=>{
  const {store,one,two}=filledStore();
  let invoked=false;
  const payload=new Proxy({v:9n},{
    getOwnPropertyDescriptor(target,key) {
      if (!invoked) { invoked=true; store.erase_swap(two); }
      return Object.getOwnPropertyDescriptor(target,key);
    }
  });
  assert.throws(()=>store.set_field(one,'payload',payload),/reentrant/);
  assert.equal(store.length,2);
  assert.equal(store.get_field(one,'payload').v,1n);
  assert.equal(store.get_field(two,'payload').v,2n);
});

test('borrowed-column setter cannot close its own loan inside user descriptor',()=>{
  const {store,one}=filledStore();
  const loan=store.borrow_column('payload',true);
  let invoked=false;
  const payload=new Proxy({v:9n},{
    getOwnPropertyDescriptor(target,key) {
      if (!invoked) { invoked=true; loan.close(); }
      return Object.getOwnPropertyDescriptor(target,key);
    }
  });
  assert.throws(()=>loan.set(0,payload),/reentrant/);
  assert.equal(loan.get(0).v,1n);
  assert.throws(()=>store.set_field(one,'payload',{v:5n}),/loan/);
  loan.close();
  store.set_field(one,'payload',{v:5n});
  assert.equal(store.get_field(one,'payload').v,5n);
});

test('proxy ownKeys cannot close owner during aborted row admission',()=>{
  const store=new InvertedReferenceStore(single,1);
  const row=new Proxy({x:7n},{
    ownKeys(target) {
      store.close();
      return Reflect.ownKeys(target);
    }
  });
  assert.throws(()=>store.push(row),/reentrant/);
  assert.equal(store.length,0);
  const h=store.push({x:2n});
  assert.equal(store.get_field(h,'x'),2n);
});


test('caught nested erase taints packed field update and preserves row handles',()=>{
  const {store,one,two}=filledStore();
  let caught=false;
  const payload=new Proxy({v:99n},{
    getOwnPropertyDescriptor(target,key) {
      try { store.erase_swap(two); }
      catch(e) { caught=/reentrant/.test(String(e)); }
      return Object.getOwnPropertyDescriptor(target,key);
    }
  });
  assert.throws(()=>store.set_field(one,'payload',payload),/tainted/);
  assert.equal(caught,true);
  assert.equal(store.length,2);
  assert.equal(store.get_field(one,'payload').v,1n);
  assert.equal(store.get_field(two,'payload').v,2n);
  store.set_field(one,'payload',{v:3n});
  assert.equal(store.get_field(one,'payload').v,3n);
});

test('caught loan close taints borrowed update but does not release the loan',()=>{
  const {store,one}=filledStore();
  const loan=store.borrow_column('payload',true);
  let caught=false;
  const payload=new Proxy({v:9n},{
    getOwnPropertyDescriptor(target,key) {
      try { loan.close(); }
      catch(e) { caught=/reentrant/.test(String(e)); }
      return Object.getOwnPropertyDescriptor(target,key);
    }
  });
  assert.throws(()=>loan.set(0,payload),/tainted/);
  assert.equal(caught,true);
  assert.equal(loan.get(0).v,1n);
  assert.throws(()=>store.set_field(one,'payload',{v:9n}),/loan/);
  loan.close();
  store.set_field(one,'payload',{v:9n});
  assert.equal(store.get_field(one,'payload').v,9n);
});

test('caught owner-close attempt taints insertion without permanently closing owner',()=>{
  const store=new InvertedReferenceStore(single,1);
  let caught=false;
  const row=new Proxy({x:7n},{
    ownKeys(target) {
      try { store.close(); }
      catch(e) { caught=/reentrant/.test(String(e)); }
      return Reflect.ownKeys(target);
    }
  });
  assert.throws(()=>store.push(row),/tainted/);
  assert.equal(caught,true);
  assert.equal(store.length,0);
  const h=store.push({x:42n});
  assert.equal(store.get_field(h,'x'),42n);
});
