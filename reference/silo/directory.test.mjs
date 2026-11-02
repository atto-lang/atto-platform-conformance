import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySiloDirectory } from './directory.mjs';

const id = (tenant, key='cart') => ({tenant, namespace:'commerce', actor_type:'cart', key:{kind:'string',value:key}});
const iso = (tenant, isolate, max_actors=2, extras={}) => ({
  tenant_id:tenant, isolate_id:isolate, max_actors, isolation_mode:'actor-local',
  capabilities:[], ...extras
});
const node = (node_id, backend, region, isolates) => ({ node_id, backend, region, isolates });
function cluster() {
  const d = new InMemorySiloDirectory();
  d.register_node(node('node-a-boot1','java','us-east',[
    iso('tenant-a','tenant-a-a'), iso('tenant-b','tenant-b-a')]));
  d.register_node(node('node-b-boot1','llvm','us-west',[
    iso('tenant-a','tenant-a-b'), iso('tenant-c','tenant-c-b')]));
  return d;
}
const rejects = (fn,code) => assert.throws(fn, error => error?.code === code);

test('OresVM nodes have different per-tenant isolates; actors stay within matching tenant', () => {
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a'), b=d.make_trusted_tenant_context('tenant-b');
  const ra=d.activate_actor(a,id('tenant-a','first'));
  const rb=d.activate_actor(b,id('tenant-b','first'));
  assert.equal(ra.node_id,'node-a-boot1');
  assert.equal(ra.isolate_id,'tenant-a-a');
  assert.equal(rb.isolate_id,'tenant-b-a');
  assert.notEqual(ra.isolate_id,rb.isolate_id);
  rejects(()=>d.route_actor(b,id('tenant-a','first')),'WRONG_TENANT');
});

test('tenant spans multiple silos without moving actors to another tenant isolate',()=>{
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a');
  const one=d.activate_actor(a,id('tenant-a','1'));
  const two=d.activate_actor(a,id('tenant-a','2'));
  assert.notEqual(one.node_id,two.node_id);
  assert.equal(two.tenant_id,'tenant-a');
  assert.equal(d.snapshot().active_actors,2);
});

test('forged context and forged ActorId tenant cannot route or activate',()=>{
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a');
  rejects(()=>d.activate_actor({tenant_id:'tenant-a'},id('tenant-a')),'UNAUTHENTICATED');
  rejects(()=>d.activate_actor(a,id('tenant-b')),'WRONG_TENANT');
  const route=d.activate_actor(a,id('tenant-a'));
  rejects(()=>d.validate_delivery({},id('tenant-a'),route),'UNAUTHENTICATED');
  rejects(()=>d.validate_delivery(a,id('tenant-a'),{...route,tenant_id:'tenant-b'}),'STALE_OR_FORGED_ROUTE');
});

test('duplicate tenant isolates and cross-tenant isolate reuse are forbidden',()=>{
  const d=new InMemorySiloDirectory();
  rejects(()=>d.register_node(node('n','java','us-east',[
    iso('tenant-a','aa'),iso('tenant-a','bb')])), 'DUPLICATE_TENANT_ISOLATE');
  rejects(()=>d.register_node(node('n','java','us-east',[
    iso('tenant-a','same'),iso('tenant-b','same')])), 'ISOLATE_REUSED_ACROSS_TENANTS');
});

test('node reboot may not silently reuse a previous node incarnation',()=>{
  const d=cluster();
  rejects(()=>d.register_node(node('node-a-boot1','java','us-east',[iso('tenant-a','new')])), 'NODE_ID_REUSE');
  d.fail_node('node-a-boot1');
  rejects(()=>d.register_node(node('node-a-boot1','java','us-east',[iso('tenant-a','new')])), 'NODE_ID_REUSE');
});

test('node failure invalidates stale route, reactivation increases epoch and fences directory delivery',()=>{
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a'), identity=id('tenant-a','shared');
  const old=d.activate_actor(a,identity,{backend:'java'});
  d.fail_node('node-a-boot1');
  rejects(()=>d.route_actor(a,identity),'ACTOR_NOT_ACTIVE');
  const next=d.activate_actor(a,identity,{backend:'llvm'});
  assert.equal(next.node_id,'node-b-boot1');
  assert.equal(next.epoch,old.epoch+1);
  assert.equal(next.actor_ref,old.actor_ref);
  rejects(()=>d.validate_delivery(a,identity,old),'STALE_OR_FORGED_ROUTE');
  assert.equal(d.validate_delivery(a,identity,next),true);
});

test('placement uses hard backend/region/capability filters, never falls back across tenant',()=>{
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a');
  rejects(()=>d.activate_actor(a,id('tenant-a'),{backend:'llvm',region:'us-east'}),'NO_COMPATIBLE_TENANT_ISOLATE');
  rejects(()=>d.activate_actor(a,id('tenant-a'),{capabilities:['gpu']}),'NO_COMPATIBLE_TENANT_ISOLATE');
  const route=d.activate_actor(a,id('tenant-a'),{region:'us-west'});
  assert.equal(route.node_id,'node-b-boot1');
});

test('isolates enforce independent bounded actor counts',()=>{
  const d=new InMemorySiloDirectory();
  d.register_node(node('n1','llvm','us-east',[iso('tenant-a','ia',1),iso('tenant-b','ib',1)]));
  const a=d.make_trusted_tenant_context('tenant-a'), b=d.make_trusted_tenant_context('tenant-b');
  d.activate_actor(a,id('tenant-a','one'));
  rejects(()=>d.activate_actor(a,id('tenant-a','two')),'NO_COMPATIBLE_TENANT_ISOLATE');
  assert.equal(d.activate_actor(b,id('tenant-b','one')).tenant_id,'tenant-b');
  assert.equal(d.snapshot().active_actors,2);
});

test('draining node rejects new activation while continuing existing route',()=>{
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a');
  const old=d.activate_actor(a,id('tenant-a','on-a'),{backend:'java'});
  d.drain_node('node-a-boot1');
  assert.equal(d.route_actor(a,id('tenant-a','on-a')).epoch,old.epoch);
  rejects(()=>d.activate_actor(a,id('tenant-a','new'),{backend:'java'}),'NO_COMPATIBLE_TENANT_ISOLATE');
  d.passivate_actor(a,id('tenant-a','on-a'));
  rejects(()=>d.validate_delivery(a,id('tenant-a','on-a'),old),'STALE_OR_FORGED_ROUTE');
});

test('hard realtime and unverified untrusted/protected modes fail closed',()=>{
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a');
  rejects(()=>d.activate_actor(a,id('tenant-a'),{hard_realtime:true}),'DYNAMIC_ACTIVATION_FORBIDDEN_IN_HARD_RT');
  rejects(()=>d.activate_actor(a,id('tenant-a'),{isolation_mode:'untrusted'}),'ISOLATION_NOT_VERIFIED');
  rejects(()=>d.activate_actor(a,id('tenant-a'),{isolation_mode:'actor-protected'}),'ISOLATION_NOT_VERIFIED');
});

test('reactivation after passivation increments epoch while keeping logical actor ref',()=>{
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a'), identity=id('tenant-a','same');
  const one=d.activate_actor(a,identity);
  d.passivate_actor(a,identity);
  const two=d.activate_actor(a,identity);
  assert.equal(one.actor_ref,two.actor_ref);
  assert.equal(two.epoch,one.epoch+1);
  rejects(()=>d.validate_delivery(a,identity,one),'STALE_OR_FORGED_ROUTE');
});

test('identity getters are snapshotted once across tenant and lookup key',()=>{
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a');
  let reads=0;
  const dynamic={tenant:'tenant-a',namespace:'commerce',actor_type:'cart',
    get key(){reads++;return {kind:'string',value:reads===1?'real':'poison'};}};
  d.activate_actor(a,dynamic);
  assert.equal(reads,1);
  assert.equal(d.route_actor(a,id('tenant-a','real')).epoch,1);
  rejects(()=>d.route_actor(a,id('tenant-a','poison')),'ACTOR_NOT_ACTIVE');
});

test('bounded global active actors and node counts fail before mutation',()=>{
  const d=new InMemorySiloDirectory({max_nodes:1,max_actors:1});
  d.register_node(node('n1','java','us-east',[iso('tenant-a','ia',5)]));
  rejects(()=>d.register_node(node('n2','java','us-east',[iso('tenant-a','ib')])), 'NODE_QUOTA');
  const a=d.make_trusted_tenant_context('tenant-a');
  d.activate_actor(a,id('tenant-a','one'));
  rejects(()=>d.activate_actor(a,id('tenant-a','two')),'ACTOR_QUOTA');
  assert.equal(d.snapshot().active_actors,1);
});

test('noncanonical actor identity rejected, no partial activation',()=>{
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a');
  rejects(()=>d.activate_actor(a,id('tenant-a','\ud800')),'INVALID_ACTOR_ID');
  assert.equal(d.snapshot().active_actors,0);
});

test('resolve_or_activate_actor: cold lookup is lazy, idempotent and capacity-safe', () => {
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a'), key=id('tenant-a','on-demand');
  assert.equal(d.snapshot().active_actors,0);
  const first=d.resolve_or_activate_actor(a,key);
  const second=d.resolve_or_activate_actor(a,key);
  assert.deepEqual(second,first);
  assert.equal(d.snapshot().active_actors,1);
  rejects(()=>d.activate_actor(a,key),'ALREADY_ACTIVE');
  assert.equal(d.snapshot().active_actors,1);
});

test('portable logical ActorRef reactivates after passivation with a new fenced route', () => {
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a'), key=id('tenant-a','shopping-cart');
  const first=d.resolve_or_activate_actor(a,key,{backend:'java'});
  d.passivate_actor(a,key);
  const second=d.resolve_or_activate_ref(a,first.actor_ref,{backend:'llvm'});
  assert.equal(second.actor_ref,first.actor_ref);
  assert.equal(second.epoch,first.epoch+1);
  assert.equal(second.node_id,'node-b-boot1');
  rejects(()=>d.validate_delivery(a,key,first),'STALE_OR_FORGED_ROUTE');
  assert.equal(d.validate_delivery(a,key,second),true);
});

test('ActorRef token grants no tenant authority and malformed references fail closed', () => {
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a'),
    b=d.make_trusted_tenant_context('tenant-b');
  const first=d.resolve_or_activate_actor(a,id('tenant-a','cart'));
  rejects(()=>d.resolve_or_activate_ref(b,first.actor_ref),'WRONG_TENANT');
  rejects(()=>d.resolve_or_activate_ref({},first.actor_ref),'UNAUTHENTICATED');
  for (const token of ['', 'oa1_!!!!', first.actor_ref+'=', 'oa1_A']) {
    rejects(()=>d.resolve_or_activate_ref(a,token),'INVALID_ACTOR_REF');
  }
  assert.equal(d.snapshot().active_actors,1);
});

test('active virtual ActorRef cannot override placement hard filters', () => {
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a'), key=id('tenant-a','fixed');
  const route=d.resolve_or_activate_actor(a,key,{backend:'java',region:'us-east'});
  for (const options of [
    {backend:'llvm'}, {region:'us-west'}, {capabilities:['gpu']}
  ]) rejects(()=>d.resolve_or_activate_ref(a,route.actor_ref,options),'INCOMPATIBLE_ACTIVE_PLACEMENT');
  assert.deepEqual(d.route_actor(a,key),route);
  assert.equal(d.snapshot().active_actors,1);
});

test('lazy resolve snapshots a mutable actor identity exactly once even on active route', () => {
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a');
  const key=id('tenant-a','first-read');
  d.resolve_or_activate_actor(a,key);
  let reads=0;
  const adversarial={tenant:'tenant-a',namespace:'commerce',actor_type:'cart',
    get key(){reads++;return {kind:'string',value:reads===1?'first-read':'wrong'};}};
  assert.equal(d.resolve_or_activate_actor(a,adversarial).epoch,1);
  assert.equal(reads,1);
  assert.equal(d.snapshot().active_actors,1);
});

test('no advertised tenant-protected descriptor can bypass unverified isolation', () => {
  const d=new InMemorySiloDirectory(), a=d.make_trusted_tenant_context('tenant-a');
  d.register_node(node('unproven','java','us-east',[
    iso('tenant-a','t',2,{isolation_mode:'tenant-protected'})
  ]));
  rejects(()=>d.activate_actor(a,id('tenant-a','first'),{isolation_mode:'tenant-protected'}),'ISOLATION_NOT_VERIFIED');
  rejects(()=>d.resolve_or_activate_actor(a,id('tenant-a','first'),{isolation_mode:'tenant-protected'}),'ISOLATION_NOT_VERIFIED');
  rejects(()=>d.resolve_or_activate_actor(a,id('tenant-a','second')),'NO_COMPATIBLE_TENANT_ISOLATE');
  assert.equal(d.snapshot().active_actors,0);
});

test('lazy resolution preserves hard-RT and actor quota rejection', () => {
  const d=new InMemorySiloDirectory({max_actors:1});
  d.register_node(node('n','java','us-east',[iso('tenant-a','ia',5)]));
  const a=d.make_trusted_tenant_context('tenant-a');
  const first=d.resolve_or_activate_actor(a,id('tenant-a','one'));
  rejects(()=>d.resolve_or_activate_ref(a,first.actor_ref,{hard_realtime:true}),'DYNAMIC_ACTIVATION_FORBIDDEN_IN_HARD_RT');
  assert.deepEqual(d.resolve_or_activate_ref(a,first.actor_ref),first);
  rejects(()=>d.resolve_or_activate_actor(a,id('tenant-a','two')),'ACTOR_QUOTA');
  assert.equal(d.snapshot().active_actors,1);
});

test('failure invalidates old incarnation; stable ref lazily selects alternate node', () => {
  const d=cluster(), a=d.make_trusted_tenant_context('tenant-a'), key=id('tenant-a','failover');
  const old=d.resolve_or_activate_actor(a,key,{backend:'java'});
  d.fail_node('node-a-boot1');
  const next=d.resolve_or_activate_ref(a,old.actor_ref);
  assert.equal(next.backend,'llvm');
  assert.equal(next.actor_ref,old.actor_ref);
  assert.equal(next.epoch,old.epoch+1);
  rejects(()=>d.validate_delivery(a,key,old),'STALE_OR_FORGED_ROUTE');
});
