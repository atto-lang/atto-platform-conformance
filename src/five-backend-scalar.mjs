// Source identity is necessary, not sufficient, for executed five-backend parity.
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat, open} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const BACKENDS = Object.freeze([
  "oreslang-source.java", "oreslang-source.llvm", "oreslang-source.net",
  "oreslang-source.wasm", "oreslang-source.forge"
]);
export const RELATIVE_FIXTURE = "contracts/v1/semantics/fixtures/add.ores";
export const EXACT_SOURCE = Buffer.from("pub fnc main(): int { return 40 + 2; }\n");
export const EXPECTED_GIT_BLOB = "015f8b0f79aafa796a148d2adeff1574e8d6c491";

function gitBlob(bytes) {
  const prefix = Buffer.from("blob " + bytes.length + "\0");
  return createHash("sha1").update(prefix).update(bytes).digest("hex");
}
async function readSafeFixture(workspace, repository) {
  const root = join(resolve(workspace), repository);
  let part = root;
  for (const relative of ["", "contracts", "v1", "semantics", "fixtures"]) {
    if (relative) part = join(part, relative);
    const st = await lstat(part); // refuse symlinks at every source directory
    if (!st.isDirectory() || st.isSymbolicLink())
      throw Error("unsafe fixture directory: " + repository);
  }
  const file = join(part, "add.ores");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size !== EXACT_SOURCE.length)
      throw Error("invalid scalar fixture size/type: " + repository);
    const bytes = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw Error("short source read: " + repository);
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ino !== st.ino)
      throw Error("fixture changed during read: " + repository);
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function verifyFiveBackendSourceIdentity(workspace) {
  if (gitBlob(EXACT_SOURCE) !== EXPECTED_GIT_BLOB)
    throw Error("source contract Git blob pin is invalid");
  const files = [];
  for (const repository of BACKENDS) {
    const bytes = await readSafeFixture(workspace, repository);
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
