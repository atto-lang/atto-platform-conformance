#!/usr/bin/env node
// Consume all six source-local platform inventories without promoting evidence.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

export const platforms = Object.freeze({
  mobile: {targetClass:"mobile-native", upstreams:["oreslang-source.llvm","oreslang-target-profiles"]},
  desktop: {targetClass:"desktop-native", upstreams:["oreslang-source.llvm","oreslang-target-profiles"]},
  embedded: {targetClass:"freestanding-mcu", upstreams:["oreslang-source.llvm","oreslang-target-profiles"]},
  iot: {targetClass:"iot-gateway", upstreams:["oreslang-platform.embedded","oreslang-source.llvm"]},
  fpga: {targetClass:"fpga", upstreams:["oreslang-source.hdl"]},
  asic: {targetClass:"asic", upstreams:["oreslang-source.hdl"]}
});
const hex64 = /^[0-9a-f]{64}$/;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(path.join(root, "contracts/platform-capabilities-v1.json"), "utf8"));
const shapeKeys = ["claims","evidence","integrationSha256","platform","repository","role","schema","targetClass","upstreams"];
const claimKeys = ["compilerGuest","physicalHardware","releaseAuthorized","targetExecuted"];
const sortedEqual = (left,right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const isPlain = value => value !== null && typeof value === "object" &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function checkRegistry() {
  if (contract.schemaVersion !== 1 || contract.contract !== "oreslang.platform-capability/1" ||
      !sortedEqual(Object.keys(contract.platforms || {}), Object.keys(platforms)))
    throw new Error("platform registry mismatch");
  for (const [name,entry] of Object.entries(platforms)) {
    const actual = contract.platforms[name];
    if (actual?.repository !== "ores-truffle-oreslang/oreslang-platform." + name ||
        actual?.targetClass !== entry.targetClass)
      throw new Error("platform registry identity mismatch: " + name);
  }
}

export function verifyInventory(value) {
  const errors = [];
  if (!isPlain(value)) return {ok:false,errors:["inventory must be an object"]};
  if (!sortedEqual(Object.keys(value), shapeKeys))
    errors.push("inventory keys do not match v1");
  if (value.schema !== "oreslang.platform-inventory/1")
    errors.push("unsupported inventory schema");
  if (typeof value.platform !== "string" || !Object.hasOwn(platforms, value.platform))
    return {ok:false,errors:[...errors,"unknown platform"]};
  const spec = platforms[value.platform];
  if (value.repository !== "ores-truffle-oreslang/oreslang-platform." + value.platform)
    errors.push("repository identity mismatch");
  if (value.targetClass !== spec.targetClass)
    errors.push("target class mismatch");
  if (typeof value.integrationSha256 !== "string" || !hex64.test(value.integrationSha256))
    errors.push("missing or invalid integration manifest digest");
  if (value.role !== "host" || value.evidence !== "not-attested")
    errors.push("inventories cannot attest execution");
  if (!Array.isArray(value.upstreams) ||
      JSON.stringify(value.upstreams) !== JSON.stringify(spec.upstreams))
    errors.push("upstream edges do not match source registry");
  if (!isPlain(value.claims) || !sortedEqual(Object.keys(value.claims), claimKeys) ||
      claimKeys.some(key => value.claims[key] !== false))
    errors.push("inventories must explicitly deny execution and release claims");
  return {ok:errors.length === 0, errors};
}

export function verifyBundle(inventories) {
  checkRegistry();
  const errors = [];
  if (!Array.isArray(inventories) || inventories.length !== Object.keys(platforms).length)
    return {ok:false,errors:["exactly six platform inventories required"]};
  const seen = new Set();
  for (const [index, item] of inventories.entries()) {
    const result = verifyInventory(item);
    for (const issue of result.errors) errors.push("item " + index + ": " + issue);
    if (typeof item?.platform === "string") {
      if (seen.has(item.platform)) errors.push("duplicate platform: " + item.platform);
      seen.add(item.platform);
    }
  }
  for (const name of Object.keys(platforms))
    if (!seen.has(name)) errors.push("missing platform: " + name);
  return {ok:errors.length === 0,errors};
}

function readBoundedJson(filename) {
  const st = fs.lstatSync(filename, {bigint:true});
  if (!st.isFile() || st.nlink !== 1n || st.size > 16384n)
    throw new Error("inventory must be a bounded, singly linked regular file");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd, {bigint:true});
    if (!before.isFile() || before.nlink !== 1n || st.dev !== before.dev ||
        st.ino !== before.ino || st.size !== before.size)
      throw new Error("inventory file changed before read");
    const buffer = Buffer.alloc(16385);
    let used = 0;
    while (used < buffer.length) {
      const read = fs.readSync(fd,buffer,used,buffer.length-used,null);
      if (read === 0) break;
      used += read;
    }
    const after = fs.fstatSync(fd, {bigint:true});
    if (used > 16384 || before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
        BigInt(used) !== before.size)
      throw new Error("inventory file changed or exceeds byte budget");
    const raw = buffer.subarray(0,used).toString("utf8");
    const value = JSON.parse(raw);
    if (raw !== JSON.stringify(value,null,2) + "\n")
      throw new Error("noncanonical inventory JSON (duplicate or hidden keys)");
    return value;
  } finally {
    fs.closeSync(fd);
  }
}

export function verifyFiles(files) {
  if (!Array.isArray(files) || files.length !== 6)
    return {ok:false,errors:["expected exactly six inventory filenames"]};
  return verifyBundle(files.map(readBoundedJson));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = verifyFiles(process.argv.slice(2));
    if (!result.ok) {
      for (const reason of result.errors) console.error("platform inventory: " + reason);
      process.exitCode = 1;
    } else {
      console.log("platform inventory: PASS (declarations only; no execution or release attestation)");
    }
  } catch (error) {
    console.error("platform inventory: " + error.message);
    process.exitCode = 1;
  }
}
