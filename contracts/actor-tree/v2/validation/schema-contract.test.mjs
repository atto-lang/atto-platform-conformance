import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

// AJV is installed in the pinned TypeSpec workspace, not its sibling tests.
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requirePinned = createRequire(resolve(here,'typespec/package.json'));
const Ajv2020 = requirePinned('ajv/dist/2020.js');
const json = (p) => JSON.parse(readFileSync(resolve(here,p),'utf8'));
const schema = json('schemas/typed-pipeline-roundtrip.schema.json');
const validate = new Ajv2020({strict:true,allErrors:true}).compile(schema);

test('signed-i64 pipeline fixture conforms to normative Draft 2020-12 schema', () => {
  const value=json('fixtures/valid-roundtrip.json');
  assert.ok(validate(value), JSON.stringify(validate.errors));
});
for (const [name, mutate] of [
  ['number in place of decimal string', t => t.messages[0].payload.i64Decimal = 12],
  ['negative zero', t => t.messages[0].payload.i64Decimal = '-0'],
  ['leading zero', t => t.messages[0].payload.i64Decimal = '012'],
  ['wrong hash size', t => t.messages[0].schemaHash = 'f'.repeat(16)],
  ['unexpected field', t => t.messages[0].payload.extra = 1],
  ['missing message', t => t.messages.pop()],
  ['foreign route length', t => t.route.push({...t.route[0], actorId:'D'})],
]) {
  test('normative JSON Schema rejects ' + name, () => {
    const value=json('fixtures/valid-roundtrip.json');mutate(value);
    assert.equal(validate(value),false,name);
  });
}

test('pinned TypeSpec compiler emits V2 wire model schemas', () => {
  const output=resolve(here,'typespec/tsp-output');
  assert.ok(existsSync(output), 'TypeSpec emission was not run');
  const names=[];
  const walk=dir=>{
    for(const d of readdirSync(dir,{withFileTypes:true})) {
      if(d.isDirectory()) walk(join(dir,d.name));
      else if(d.name.endsWith('.json')) names.push(d.name);
    }
  };
  walk(output);
  for(const name of ['ThreeActorRoundTripV2','TypedPipelineEnvelopeV2','TaggedSignedI64V2']) {
    assert.ok(names.some(x=>x.includes(name)), 'missing emitted schema '+name);
  }
});
