import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NORMATIVE_SCHEMA_SHA256} from './verify-roundtrip.mjs';

const v2 = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('pinned V2 schemaHash is SHA-256 of published normative UTF-8 schema bytes', () => {
  const schema = readFileSync(resolve(v2, 'schemas/typed-pipeline-roundtrip.schema.json'));
  const digest = createHash('sha256').update(schema).digest('hex');
  assert.equal(digest, NORMATIVE_SCHEMA_SHA256);
  const fixture = JSON.parse(readFileSync(resolve(v2,'fixtures/valid-roundtrip.json'),'utf8'));
  for (const message of fixture.messages) {
    assert.equal(message.schemaHash, digest);
  }
});
