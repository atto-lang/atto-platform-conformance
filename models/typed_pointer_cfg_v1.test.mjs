import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTypedPointerCfg as verify} from './typed_pointer_cfg_v1.mjs';
const type={id:'point',size:16,align:8,fields:2,copy:false};
const alloc={op:'alloc',store:'s',type:'point',size:16,align:8};
const o=(op,fields={})=>({op,...fields});
const begin=o('begin',{store:'s'}),init0=o('init',{store:'s',field:0}),init1=o('init',{store:'s',field:1}),commit=o('commit',{store:'s'}),destroy=o('destroy',{store:'s'}),free=o('free',{store:'s'});
const slot=o('slot',{slot:'p',type:'point'}),bind=o('bind',{slot:'p',store:'s'}),detach=o('detach',{slot:'p'}),end=o('end_slot',{slot:'p'});
const loan=o('loan',{slot:'p',loan:'l',mutable:false}),endLoan=o('end_loan',{loan:'l'});
const live=[alloc,begin,init0,init1,commit],good=[...live,slot,bind,loan,endLoan,detach,destroy,begin,init0,init1,commit,bind,detach,end,destroy,free];
const make=(ops)=>({actor:'a',types:[type],entry:'entry',blocks:[{id:'entry',ops,next:[]}]});
const check=(ops)=>verify(make(ops));
const reject=(ops)=>assert.throws(()=>check(ops),/E_TYPED_POINTER_CFG/);
test('construct, bind, borrow, detach, destroy and reconstruct',()=>assert.deepEqual(check(good),{blocks:1,exits:1}));
test('constructor rollback before publication',()=>assert.equal(check([alloc,begin,init0,o('rollback_field',{store:'s',field:0}),o('abort',{store:'s'}),free]).exits,1));
test('reject invalid lifecycle operations',()=>{
 for(const ops of [
 [alloc,begin,init0,commit], [alloc,begin,init1], [alloc,begin,init0,init0],
 [alloc,begin,init0,o('abort',{store:'s'})], [alloc,begin,init0,o('rollback_field',{store:'s',field:1})],
 [...live,free], [...live,destroy,destroy,free], [...live,destroy,free,free],
 [...live,slot,bind,destroy], [...live,slot,bind,bind], [...live,slot,bind,loan,detach],
 [...live,slot,bind,o('copy_read',{slot:'p'})], [...live,slot,bind,o('suspend')],
 [...live,slot,bind,o('loan',{slot:'p',loan:'l',mutable:true})],
 [...live,slot,bind,o('send',{slot:'p'})], [...live,slot,{...bind,actor:'other'}],
 [{...alloc,align:4}], [alloc,free,alloc], [...live,slot,bind,detach,detach],
 [...live,slot,bind,end], [alloc,begin,o('suspend')], [...live,slot,bind,loan,o('end_loan',{loan:'missing'})],
 ])reject(ops);
});
test('immutable loan excludes exclusive write and vice versa',()=>{
 reject([...live,slot,bind,loan,o('loan',{slot:'p',loan:'w',mutable:true,exclusive:true})]);
 reject([...live,slot,bind,o('loan',{slot:'p',loan:'w',mutable:true,exclusive:true}),loan]);
 assert.equal(check([...live,slot,bind,o('loan',{slot:'p',loan:'w',mutable:true,exclusive:true}),o('end_loan',{loan:'w'}),detach,end,destroy,free]).exits,1);
});
test('CFG admits identical joins and rejects asymmetric cleanup',()=>{
 const p={actor:'a',types:[type],entry:'entry',blocks:[{id:'entry',ops:[...live,slot,bind],next:['left','right']},{id:'left',ops:[loan,endLoan],next:['join']},{id:'right',ops:[],next:['join']},{id:'join',ops:[detach,end,destroy,free],next:[]}]};
 assert.deepEqual(verify(p),{blocks:4,exits:1});
 p.blocks[1].ops=[loan];assert.throws(()=>verify(p),/E_TYPED_POINTER_CFG/);
});
test('CFG rejects missing or unreachable blocks',()=>{
 const p=make([]);p.blocks[0].next=['missing'];assert.throws(()=>verify(p),/E_TYPED_POINTER_CFG/);
 p.blocks[0].next=[];p.blocks.push({id:'unused',ops:[],next:[]});assert.throws(()=>verify(p),/E_TYPED_POINTER_CFG/);
});
