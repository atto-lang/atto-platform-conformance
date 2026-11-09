import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const manifest=JSON.parse(await readFile(
  new URL("../contracts/v1/actor-pubsub/qos-pg-monitor-extension.source-only.json",import.meta.url),"utf8"));

test("pubsub extension declares independent QoS and pg monitor authority",()=>{
  assert.equal(manifest.schema,"attolang.actor_pubsub.qos_pg_monitor.source_only.v1");
  assert.equal(manifest.status,"SOURCE_ONLY_NOT_EXECUTED");
  assert.equal(manifest.compatibility.original_vectors,"PS001-PS026");
  assert.equal(manifest.compatibility.new_keywords,false);
  assert.equal(manifest.topic_policies.RELIABLE.sequence_on_reject,false);
  assert.equal(manifest.topic_policies.LOSSY.full,"PER_RECIPIENT_DROP");
  assert.equal(manifest.topic_policies.LATEST.subscription_capacity,1);
  assert.equal(manifest.group_monitor.snapshot_and_register,"ATOMIC");
  assert.equal(manifest.group_monitor.separate_from_topic_and_supervisor_control,true);
  assert.equal(manifest.group_monitor.overflow,"FAIL_CLOSED_UNTIL_ATOMIC_RESYNC");
  assert.equal(manifest.group_monitor.distributed_provider,"NOT_IMPLEMENTED");
});

test("all backend guest/runtime/AOT statuses remain explicitly fail closed",()=>{
  assert.deepEqual(Object.keys(manifest.backend_status).sort(),
    ["java","llvm","wasm","net","forge","cranelift"].sort());
  for(const [backend,status] of Object.entries(manifest.backend_status)){
    assert.equal(status.compiler_lowering,"NOT_VERIFIED",backend);
    assert.equal(status.guest_execution,"NOT_EXECUTED",backend);
    assert.equal(status.race_tests,"NOT_EXECUTED",backend);
    assert.equal(status.native_aot,"NOT_VERIFIED",backend);
  }
  assert.equal(manifest.source_export,"DENIED_CROSS_ORG_DURING_ACTIVE_INCIDENT_HOLD");
});
