// Read one untrusted receipt/manifest as a bounded, stable, regular file.
// Never follow a leaf symlink or open a FIFO/device as part of verification.
import {constants, openSync, fstatSync, readSync, closeSync} from 'node:fs';
import {parseStrictGithubJson} from './dop-github-api-v1.mjs';

export function readDopEvidenceJsonFile(path, limit = 65536) {
  if (!(typeof path === 'string' || path instanceof URL) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 1048576)
    throw new TypeError('invalid-evidence-file-argument');
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK))
    throw new Error('evidence-no-follow-unavailable');
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > limit)
      throw new Error('invalid-evidence-file');
    const bytes = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < bytes.length) {
      const n = readSync(fd, bytes, count, bytes.length - count, null);
      if (n === 0) break;
      count += n;
    }
    const after = fstatSync(fd);
    if (!after.isFile() || before.size !== count || after.size !== before.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
        before.ino !== after.ino || before.dev !== after.dev)
      throw new Error('evidence-file-changed');
    if (count > limit) throw new Error('evidence-file-over-budget');
    let value;
    try {
      const source = new TextDecoder('utf-8', {fatal:true}).decode(bytes.subarray(0, count));
      value = parseStrictGithubJson(source);
    } catch (error) {
      if (error?.message?.startsWith('github-')) throw error;
      throw new Error('evidence-invalid-json');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw new Error('evidence-not-object');
    return value;
  } catch (error) {
    if (error?.code === 'ELOOP') throw new Error('evidence-leaf-symlink');
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
