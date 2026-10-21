// Source identity is necessary, not sufficient, for executed five-backend parity.
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat, open, realpath} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const BACKENDS = Object.freeze([
  "oreslang-source.java", "oreslang-source.llvm", "oreslang-source.net",
  "oreslang-source.wasm", "oreslang-source.forge"
]);
export const RELATIVE_FIXTURE = "contracts/v1/semantics/fixtures/add.ores";
export const EXACT_SOURCE = Buffer.from("pub fnc main(): int { return 40 + 2; }\n");
export const EXPECTED_GIT_BLOB = "015f8b0f79aafa796a148d2adeff1574e8d6c491";
export const PRECEDENCE_RELATIVE_FIXTURE = "contracts/v1/semantics/fixtures/precedence.ores";
export const PRECEDENCE_SOURCE = Buffer.from("pub fnc main(): int { return (2 + 3) * 8; }\n");
export const PRECEDENCE_GIT_BLOB = "2d09e697ad4eeac4ee263c3656b92998c67f0bfc";

function gitBlob(bytes) {
  const prefix = Buffer.from("blob " + bytes.length + "\0");
  return createHash("sha1").update(prefix).update(bytes).digest("hex");
}
function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode &&
    a.nlink === b.nlink && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
async function readSafeFixture(workspace, repository, fixtureName = "add.ores", expectedSize = EXACT_SOURCE.length) {
  const root = join(resolve(workspace), repository);
  let part = root;
  const parentSnapshot = [];
  for (const relative of ["", "contracts", "v1", "semantics", "fixtures"]) {
    if (relative) part = join(part, relative);
    const st = await lstat(part); // refuse symlinks at every source directory
    if (!st.isDirectory() || st.isSymbolicLink())
      throw Error("unsafe fixture directory: " + repository);
    parentSnapshot.push({path:part,dev:st.dev,ino:st.ino});
  }
  const file = join(part, fixtureName);
  // lstat alone cannot detect all parent path substitutions between checks.
  // A stable physical path and post-read parent identity are both required.
  if ((await realpath(file)) !== file)
    throw Error("fixture path escaped the expected physical checkout");
  // A malicious checkout can replace a source file with a FIFO. Opening a
  // FIFO read-only with blocking I/O may hang forever before fstat() runs.
  // O_NONBLOCK also prevents FIFO hangs if a path changes after lstat().
  // Path checks are still not an atomic authorization boundary.
  if (!Number.isInteger(constants.O_NOFOLLOW) ||
      !Number.isInteger(constants.O_NONBLOCK))
    throw Error("no-follow nonblocking file support required for source identity");
  const beforeOpen = await lstat(file);
  if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink())
    throw Error("fixture must be an ordinary regular file: " + repository);
  const handle = await open(file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink !== 1 || st.size !== expectedSize)
      throw Error("invalid scalar fixture size/type: " + repository);
    // Bind the pre-open path inode to the actual no-follow descriptor.
    if (!sameFile(beforeOpen, st))
      throw Error("fixture replaced before read: " + repository);
    const bytes = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw Error("short source read: " + repository);
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (!sameFile(st, after))
      throw Error("fixture changed during read: " + repository);
    if ((await realpath(file)) !== file)
      throw Error("fixture path changed during read: " + repository);
    const afterPath = await lstat(file);
    if (!afterPath.isFile() || !sameFile(after, afterPath))
      throw Error("fixture replaced during read: " + repository);
    for (const parent of parentSnapshot) {
      const now = await lstat(parent.path);
      if (!now.isDirectory() || now.isSymbolicLink() ||
          now.dev !== parent.dev || now.ino !== parent.ino)
        throw Error("fixture parent directory changed during read: " + repository);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function verifyFiveBackendSourceIdentity(workspace) {
  if (typeof workspace !== "string" || !workspace || workspace.includes("\0"))
    throw TypeError("workspace must be a nonempty directory path without NUL");
  const requestedWorkspace = resolve(workspace);
  const workspaceStat = await lstat(requestedWorkspace);
  if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink())
    throw Error("workspace must be a physical directory, not a symlink");
  // On macOS /var may be an alias of /private/var. Permit operating-system
  // ancestor aliases, but never follow symlinks inside the workspace tree.
  const physicalWorkspace = await realpath(requestedWorkspace);
  if (gitBlob(EXACT_SOURCE) !== EXPECTED_GIT_BLOB)
    throw Error("source contract Git blob pin is invalid");
  const files = [];
  for (const repository of BACKENDS) {
    const bytes = await readSafeFixture(physicalWorkspace, repository);
    const digest = gitBlob(bytes);
    if (digest !== EXPECTED_GIT_BLOB || !bytes.equals(EXACT_SOURCE))
      throw Error("five-backend scalar source mismatch: " + repository);
    files.push({repository, gitBlobSha: digest,
      sourceSha256: createHash("sha256").update(bytes).digest("hex")});
  }
  // No backend compiler, runner or native guest is invoked here.
  return {status: "SOURCE_IDENTITY_ONLY_NOT_EXECUTION", fixture: RELATIVE_FIXTURE,
    executionVerified: false, fixtureCount: files.length, files};
}

// Extension of the original add-only contract. This asserts two canonical
// identical source fixtures in each backend; it does NOT execute any compiler.
export async function verifyFiveBackendScalarPairSourceIdentity(workspace) {
  const addProof = await verifyFiveBackendSourceIdentity(workspace);
  if (gitBlob(PRECEDENCE_SOURCE) !== PRECEDENCE_GIT_BLOB)
    throw Error("precedence contract Git blob pin is invalid");
  const physicalWorkspace = await realpath(resolve(workspace));
  const precedenceFiles = [];
  for (const repository of BACKENDS) {
    const bytes = await readSafeFixture(
      physicalWorkspace, repository, "precedence.ores", PRECEDENCE_SOURCE.length);
    const digest = gitBlob(bytes);
    if (digest !== PRECEDENCE_GIT_BLOB || !bytes.equals(PRECEDENCE_SOURCE))
      throw Error("five-backend precedence source mismatch: " + repository);
    precedenceFiles.push({repository, gitBlobSha: digest,
      sourceSha256: createHash("sha256").update(bytes).digest("hex")});
  }
  return {status: "SOURCE_IDENTITY_ONLY_NOT_EXECUTION",
    executionVerified: false, parityCertified: false,
    fixtureCount: 2, backendCount: BACKENDS.length, sourceFileCount: 10,
    fixtures: [
      {path: RELATIVE_FIXTURE, gitBlobSha: EXPECTED_GIT_BLOB, files: addProof.files},
      {path: PRECEDENCE_RELATIVE_FIXTURE, gitBlobSha: PRECEDENCE_GIT_BLOB, files: precedenceFiles}
    ]};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || !process.argv[2].startsWith("--workspace=")) {
    console.error("usage: node src/five-backend-scalar.mjs --workspace=/path/to/private-sibling-checkouts");
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(await verifyFiveBackendSourceIdentity(
        process.argv[2].slice("--workspace=".length)), null, 2));
    } catch (err) {
      console.error("Five-backend scalar source identity failed: " + err.message);
      process.exitCode = 1;
    }
  }
}
