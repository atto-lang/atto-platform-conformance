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

test('TypeSpec-emitted root schema agrees with normative V2 on structural mutations', () => {
  const root = resolve(here, 'typespec/tsp-output');
  assert.ok(existsSync(root), 'TypeSpec compiler emission missing');
  const files=[];
  const walk=dir=>{
    for(const item of readdirSync(dir,{withFileTypes:true})) {
      if(item.isDirectory()) walk(join(dir,item.name));
      else if(item.name.endsWith('.json')) files.push(join(dir,item.name));
    }
  };
  walk(root);
  const generated = files.map(file=>({file, schema:JSON.parse(readFileSync(file,'utf8'))}));
  const rootEntry=generated.find(e=>e.file.endsWith('/ThreeActorRoundTripV2.json'));
  assert.ok(rootEntry, 'TypeSpec did not emit ThreeActorRoundTripV2.json');
  // Add all emitted models: the TypeSpec emitter uses external $ref paths
  // for named nested models. Ajv resolves these from their model $id values.
  const emitted = new Ajv2020({strict:false,allErrors:true});
  for(const {file,schema} of generated) {
    emitted.addSchema(schema, file.slice(file.lastIndexOf('/')+1));
  }
  const generatedValidator = emitted.getSchema(rootEntry.schema.$id ||
      rootEntry.file.slice(rootEntry.file.lastIndexOf('/')+1));
  assert.ok(generatedValidator,
    'generated root schema has no resolvable TypeSpec model identity');
  const base=json('fixtures/valid-roundtrip.json');
  const mutations=[
    ['unchanged positive fixture', t=>t],
    ['additional root property', t=>{t.unexpected=true;}],
    ['additional envelope property', t=>{t.messages[0].unexpected=true;}],
    ['additional signed payload property', t=>{t.messages[0].payload.unexpected=true;}],
    ['missing pipeline id', t=>{delete t.pipelineId;}],
    ['empty pipeline id', t=>{t.pipelineId='';}],
    ['too many route actors', t=>{t.route.push(structuredClone(t.route[0]));}],
    ['missing message', t=>{t.messages.pop();}],
    ['noninteger incarnation', t=>{t.route[0].incarnation=1.5;}],
    ['negative incarnation', t=>{t.route[0].incarnation=-1;}],
    ['invalid schema hash', t=>{t.messages[0].schemaHash='bad';}],
    ['wrong direction enum', t=>{t.messages[0].direction='sideways';}],
    ['number instead of decimal string', t=>{t.messages[0].payload.i64Decimal=42;}],
    ['noncanonical minus zero', t=>{t.messages[0].payload.i64Decimal='-0';}]
  ];
  for(const [name,mutate] of mutations) {
    const value=structuredClone(base);
    mutate(value);
    const normative=validate(value);
    const generatedResult=generatedValidator(value);
    assert.equal(generatedResult,normative,
      'TypeSpec JSON Schema differs from normative structural contract: '+name+
      ' | emitted errors='+JSON.stringify(generatedValidator.errors));
  }
});
