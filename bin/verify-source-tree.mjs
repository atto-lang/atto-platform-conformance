import {createHash} from 'node:crypto';

const OID = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Attest a GitHub recursive tree response against its *root* Git tree ID.
 * A blob SHA alone does not prove that its pathname and mode belonged to
 * the pinned source commit. No network calls or GitHub trust are required.
 * Input is the GitHub REST /git/trees/:sha?recursive=1 response.
 */
export function verifySourceTree(rootSha, listing) {
  if (typeof rootSha !== 'string' || !OID.test(rootSha) ||
      !listing || listing.truncated !== false ||
      !Array.isArray(listing.tree) || listing.sha !== rootSha) {
    throw Error('source tree root pin or inventory is invalid');
  }
  if (listing.tree.length > 3000) throw Error('source tree inventory is oversized');

  const items = new Map();
  const folded = new Set();
  const children = new Map([['', []]]);
  let totalBytes = 0, files = 0;
  for (const item of listing.tree) {
    if (!item || typeof item.path !== 'string' || item.path.length > 512 ||
        typeof item.sha !== 'string' || !OID.test(item.sha) ||
        !['tree','blob'].includes(item.type) ||
        !(item.type === 'tree' ? item.mode === '040000' :
          ['100644','100755'].includes(item.mode))) {
      throw Error('invalid source tree entry');
    }
    const parts = item.path.split('/');
    if (parts.some(p => !NAME.test(p) || p === '.' || p === '..' || p.toLowerCase() === '.git')) {
      throw Error('unsafe source tree path');
    }
    const key = item.path.toLowerCase();
    if (folded.has(key)) throw Error('duplicate or case-colliding source tree path');
    folded.add(key);
    items.set(item.path, item);
    if (item.type === 'tree') children.set(item.path, []);
    else {
      if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > 1048576) {
        throw Error('invalid source tree blob size');
      }
      files++;
      totalBytes += item.size;
      if (files > 750 || totalBytes > 41943040) throw Error('source tree exceeds mirror budget');
    }
  }
  if (!files) throw Error('source tree has no blobs');

  for (const [path, item] of items) {
    const index = path.lastIndexOf('/');
    const parent = index < 0 ? '' : path.slice(0, index);
    if (parent && items.get(parent)?.type !== 'tree') {
      throw Error('source tree has missing or non-tree parent');
    }
    children.get(parent)?.push(item);
  }

  const byDepth = [...children.keys()].sort((a,b)=>
    (b.split('/').length - a.split('/').length));
  for (const path of byDepth) {
    const entries = children.get(path);
    if (!Array.isArray(entries)) throw Error('missing source tree directory');
    const sortKey = x => Buffer.from(x.path.slice(path ? path.length+1 : 0) +
        (x.type === 'tree' ? '/' : ''), 'ascii');
    entries.sort((a,b)=>Buffer.compare(sortKey(a),sortKey(b)));
    const segments = [];
    for (const child of entries) {
      const name = child.path.slice(path ? path.length+1 : 0);
      if (name.includes('/')) throw Error('source tree has malformed descendants');
      const mode = child.type === 'tree' ? '40000' : child.mode;
      segments.push(Buffer.from(mode + ' ' + name + '\0', 'ascii'));
      segments.push(Buffer.from(child.sha, 'hex'));
    }
    const body = Buffer.concat(segments);
    const computed = createHash('sha1')
      .update('tree ' + body.length + '\0', 'ascii')
      .update(body).digest('hex');
    const expected = path === '' ? rootSha : items.get(path).sha;
    if (computed !== expected) throw Error('source tree SHA mismatch at ' + (path || '/'));
  }
  return Object.freeze({sourceTree: rootSha, files, bytes: totalBytes});
}
