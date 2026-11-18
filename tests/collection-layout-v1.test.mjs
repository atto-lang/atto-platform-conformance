import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../contracts/collection-layout-v1');
const data = JSON.parse(readFileSync(resolve(root, 'cases.json'), 'utf8'));
test('collection layout v1 is a non-promoting fixture registry', () => {
    assert.equal(data.schema, 'atto.collection-layout.v1');
    assert.equal(data.maturity, 'TARGET_NOT_EXECUTED');
    assert.equal(data.cases.length, 11);
    assert.ok(Object.keys(data.backends).length >= 5);
    for (const status of Object.values(data.backends)) {
        assert.equal(status, 'NOT_EXECUTED');
    }
    const ids = new Set();
    const files = new Set();
    let guests = 0, negatives = 0;
    for (const entry of data.cases) {
        assert.equal(entry.status, 'NOT_EXECUTED');
        assert.match(entry.id, /^[a-z][a-z0-9-]*$/);
        assert.equal(ids.has(entry.id), false);
        ids.add(entry.id);
        assert.match(entry.fixture, /^fixtures\/[a-z0-9-]+\.atto$/);
        assert.equal(files.has(entry.fixture), false);
        files.add(entry.fixture);
        const path = resolve(root, entry.fixture);
        assert.equal(lstatSync(path).isSymbolicLink(), false);
        const source = readFileSync(path, 'utf8');
        assert.ok(source.includes('layout') || entry.id === 'aos-default');
        assert.ok(source.length >= 20 && source.length <= 65536);
        if (entry.kind === 'guest') {
            assert.equal(Number.isInteger(entry.expected.return_int), true);
            guests++;
        } else {
            assert.equal(entry.kind, 'compile_reject');
            assert.equal(typeof entry.expected.diagnostic_class, 'string');
            negatives++;
        }
    }
    assert.equal(guests, 5);
    assert.equal(negatives, 6);
});
