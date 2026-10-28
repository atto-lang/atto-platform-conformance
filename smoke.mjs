import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
assert.equal(readFileSync(new URL('./message.txt', import.meta.url),'utf8'),'hello-private-resume\n');
console.log('PASS 3-file guarded private resume real runner');
