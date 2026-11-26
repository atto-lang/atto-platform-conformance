// HDL is an explicitly unsupported hosted durable-actor target.
// Assert target-specific denial, never count it as actor execution parity.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const [compiler]=process.argv.slice(2);
assert.ok(compiler&&process.argv.length===3,'one explicit HDL compiler module required');
const {compileSource,parseHardwareSource,HardwareSourceError}=await import(pathToFileURL(resolve(compiler)));
const fixture=readFileSync(new URL('../fixtures/actors/persistence/durable_counter_broker_v1.atto',import.meta.url),'utf8');
assert.ok(fixture.startsWith('define durable actor Counter'));
const cases=[];
for(const field of ['count','balance'])
  for(const mail of ['mail','event'])
    for(const prefix of ['define','define pub'])
      for(const kind of ['durable','persistent'])
        for(const gap of [' ','\t','\n',' /* schema */ ']){
          const source=fixture.replaceAll('count',field).replaceAll('mail',mail)
            .replace('define durable actor',prefix+' '+kind+gap+'actor');
          cases.push(source);
        }
assert.equal(new Set(cases).size,64);
let denials=0;
for(const source of cases)
  for(const compile of [parseHardwareSource,compileSource]){
    assert.throws(()=>compile(source),e=>e instanceof HardwareSourceError&&
      e.code==='HDL_DURABLE_ACTOR_UNSUPPORTED',source);
    denials++;
  }
assert.equal(denials,128);
const scalar='fnc pass(u8 durable):u8{return durable;}';
const rtl=compileSource(scalar).systemVerilog;
assert.match(rtl,/module ores_pass/);
for(const trivia of ['// define durable actor Counter\n','/* define persistent actor Counter */\n'])
  assert.equal(compileSource(trivia+scalar).systemVerilog,rtl);
console.log(JSON.stringify({status:'HDL_DURABLE_TARGET_DENIAL_PASS',sourceVariants:cases.length,
  denials,positiveControls:3,fixtureSha256:createHash('sha256').update(fixture).digest('hex'),
  durableActorExecution:false,diskRecoveryExecuted:false,fullDurableActorParity:false}));
