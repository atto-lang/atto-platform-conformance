#!/usr/bin/env node
// Source-identity gate only. This program NEVER compiles or executes a guest.
import {createHash} from "node:crypto";
import {lstatSync, readFileSync, realpathSync} from "node:fs";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(here, "..");
const IDS = ["java", "llvm", "wasm", "net", "forge"];
const PRS = [2460, 1312, 275, 345, 177];
const SOURCE = "contracts/atto-source-v1/add.atto";
const BLOB = "015f8b0f79aafa796a148d2adeff1574e8d6c491";

function safeFile(root, rel) {
  if (typeof rel !== "string" || isAbsolute(rel) || rel.split("/").some(
      part => part === "" || part === "." || part === ".."))
    throw Error("source contract path must be a canonical relative path");
  const parts = rel.split("/");
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    const info = lstatSync(current);
    if (info.isSymbolicLink())
      throw Error("symlinked Atto source contract path is forbidden");
  }
  if (!lstatSync(current).isFile()) throw Error("source contract is not a regular file");
  if (relative(root, current).startsWith(".." + sep))
    throw Error("source contract escaped repository root");
  return current;
}

function exactKeys(object, keys, label) {
  if (!object || Array.isArray(object) || typeof object !== "object" ||
      Object.keys(object).join("|") !== keys.join("|"))
    throw Error(label + " has unknown, missing or reordered fields");
}

export function verifyAttoSourceV1(directory = defaultRoot) {
  const root = resolve(directory);
  if (realpathSync(root) !== root) throw Error("contract root must be physical");
  const contractPath = safeFile(root, "contracts/atto-source-v1/contract.json");
  const raw = readFileSync(contractPath, "utf8");
  const contract = JSON.parse(raw);
  // A duplicate JSON key vanishes under JSON.parse; requiring an exact
  // canonical serialization detects duplicates and arbitrary textual drift.
  if (raw !== JSON.stringify(contract, null, 2) + "\n")
    throw Error("noncanonical or duplicate-key source parity manifest");
  exactKeys(contract, ["schema","source","backends","promotion"], "root manifest");
  if (contract.schema !== "attolang.source-parity.v1") throw Error("invalid parity schema");
  exactKeys(contract.source, ["path","git_blob_sha1","expected_exit_status"], "source");
  if (contract.source.path !== SOURCE || contract.source.git_blob_sha1 !== BLOB ||
      contract.source.expected_exit_status !== 42)
    throw Error("canonical .atto fixture identity or expected result changed");
  const path = safeFile(root, SOURCE);
  const bytes = readFileSync(path);
  const blob = createHash("sha1").update("blob " + bytes.length + "\0")
    .update(bytes).digest("hex");
  if (blob !== BLOB || bytes.toString("utf8") !==
      "pub fnc main(): int { return 40 + 2; }\n")
    throw Error("canonical Atto source bytes differ from reviewed Git blob");

  if (!Array.isArray(contract.backends) || contract.backends.length !== IDS.length)
    throw Error("five backend entries are mandatory");
  for (let i = 0; i < IDS.length; i++) {
    const record = contract.backends[i];
    exactKeys(record, ["id","repository","pr","fixture_path"], "backend");
    const expectedId = IDS[i];
    if (record.id !== expectedId ||
        record.repository !== "ores-truffle-oreslang/oreslang-source." + expectedId ||
        record.pr !== PRS[i] ||
        record.fixture_path !== "contracts/atto-parity-v1/add.atto")
      throw Error("noncanonical backend identity or fixture path");
  }
  exactKeys(contract.promotion, ["requires","source_only_not_execution"], "promotion");
  if (!Array.isArray(contract.promotion.requires) ||
      contract.promotion.requires.length !== 6 ||
      !contract.promotion.requires.every(x => typeof x === "string" && x.length > 0) ||
      contract.promotion.source_only_not_execution !== true)
    throw Error("missing source-only versus execution evidence boundary");
  return {blob, backendCount:IDS.length, sourceOnly:true};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyAttoSourceV1();
    console.log("ATTO_SOURCE_CORPUS_V1_SOURCE_ONLY_PASS " +
      "blob=" + result.blob + " backends=" + result.backendCount);
  } catch (error) {
    console.error("ATTO_SOURCE_CORPUS_V1_FAIL: " + error.message);
    process.exitCode = 1;
  }
}
