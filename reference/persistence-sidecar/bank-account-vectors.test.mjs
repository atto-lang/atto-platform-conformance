import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {apply_bank_event,validate_bank_command} from './bank-account-reference.mjs';

const vectors=JSON.parse(readFileSync(new URL('./bank-account-vectors.v1.json',import.meta.url),'utf8'));

test('bank-account portable golden events use stable command hashes and deterministic balances',()=>{
  assert.equal(vectors.schema_version,1);
  assert.equal(vectors.status,'PROPOSED_HOST_ORACLE_NOT_GUEST_EXECUTION');
  let state=vectors.initial_state;
  let version=0;
  const ids=new Map();
  for(const step of vectors.steps){
    const command=validate_bank_command(step.command);
    const digest=createHash('sha256').update(JSON.stringify([command.kind,command.amount_cents])).digest('hex');
    assert.equal(step.event.command_hash,digest);
    assert.equal(step.event.kind,command.kind==='deposit'?'money_deposited':'money_withdrawn');
    state=apply_bank_event(state,step.event);
    version++;
    assert.equal(state.balance_cents,step.expected_balance_cents);
    assert.equal(ids.has(step.operation_id),false);
    ids.set(step.operation_id,{hash:digest,version});
  }
  for(const retry of vectors.retries){
    const command=validate_bank_command(retry.command);
    const digest=createHash('sha256').update(JSON.stringify([command.kind,command.amount_cents])).digest('hex');
    const saved=ids.get(retry.operation_id);
    if(retry.expected_error){assert.notEqual(saved.hash,digest);assert.equal(retry.expected_error,'OP_ID_CONFLICT');}
    else {assert.equal(saved.hash,digest);assert.equal(saved.version,retry.expected_version);
      assert.equal(state.balance_cents,retry.expected_final_balance_cents);}
  }
  for(const rejection of vectors.rejections){
    const command=validate_bank_command(rejection.command);
    assert.equal(command.kind,'withdraw');
    assert.ok(state.balance_cents < command.amount_cents);
    assert.equal(rejection.expected_error,'INSUFFICIENT_FUNDS');
    assert.equal(state.balance_cents,rejection.expected_final_balance_cents);
  }
  for(const backend of ['java','llvm','net','wasm','forge'])
    assert.equal(vectors.native_backend_execution[backend],'NOT_EXECUTED');
  assert.equal(version,3);
});
