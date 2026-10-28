import assert from 'node:assert/strict';
const domain = 'private-source-fixture';
assert.equal(domain, 'private-source-fixture');
assert.equal(2 * 21, 42);
console.log('PASS private mirror exact-tree source fixture executed under Node');
