// Artifact-digest evidence, deliberately weaker than independent source-to-binary attestation.
import {readFile, lstat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {isAbsolute, delimiter, resolve} from "node:path";

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const roles = {
  java: new Set(["compiler-jar", "launcher", "classpath-file", "runtime-dependency", "runtime-runner"]),
  llvm: new Set(["compiler-native", "runtime-runner"]),
};
const requirements = {
  java: ["compiler-jar", "launcher", "classpath-file", "runtime-dependency", "runtime-runner"],
  llvm: ["compiler-native", "runtime-runner"],
};

export function validatePins(pins) {
  if (pins?.schemaVersion !== 1 || !pins.backends ||
      Object.keys(pins.backends).sort().join(",") !== "java,llvm") throw Error("invalid pinned source registry");
  for (const backend of ["java", "llvm"]) {
    const p = pins.backends[backend];
    if (!SHA40.test(p?.sourceCommit || "") || !SHA40.test(p?.sourceInputTree || "")) {
      throw Error("invalid pinned " + backend + " source identity");
    }
  }
  return pins;
}

export async function digestFile(path) {
  if (typeof path !== "string" || !isAbsolute(path)) throw Error("artifact path must be absolute");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
    throw Error("artifact must be a nonempty regular file: " + path);
  }
  const data = await readFile(path);
  return {sha256:createHash("sha256").update(data).digest("hex"), bytes:data.length};
}

export async function buildEvidence({backend, pins, paths, classpathFile, toolchain}) {
  validatePins(pins);
  if (!roles[backend] || typeof toolchain !== "string" || !toolchain.trim()) throw Error("invalid backend/toolchain");
  const requested = [...Object.entries(paths || {}).map(([role,path])=>({role,path}))];
  if (backend === "java") {
    const cpFile = classpathFile;
    if (!cpFile) throw Error("missing dependency classpath");
    requested.push({role:"classpath-file",path:cpFile});
    const classpath = (await readFile(cpFile,"utf8")).trim().split(delimiter).filter(Boolean);
    if (!classpath.length) throw Error("Java runtime dependency list empty");
    for (const path of classpath) requested.push({role:"runtime-dependency",path:resolve(path)});
  }
  const artifacts=[];
  for (const item of requested) {
    const dig=await digestFile(item.path);
    artifacts.push({...item,...dig});
  }
  const pin = pins.backends[backend];
  const report={schemaVersion:1,backend,sourceCommit:pin.sourceCommit,sourceInputTree:pin.sourceInputTree,
    toolchain,artifacts,claimsIndependentAttestation:false,claimsReproducibleBuild:false};
  await verifyBuildEvidence(report,pins);
  return report;
}

export async function verifyBuildEvidence(report,pins) {
  validatePins(pins);
  const backend=report?.backend;
  if (report?.schemaVersion !== 1 || !roles[backend] ||
      report.sourceCommit !== pins.backends[backend].sourceCommit ||
      report.sourceInputTree !== pins.backends[backend].sourceInputTree ||
      typeof report.toolchain !== "string" || !report.toolchain.trim() ||
      report.claimsIndependentAttestation !== false || report.claimsReproducibleBuild !== false ||
      !Array.isArray(report.artifacts)) throw Error("invalid/unpinned build provenance report");
  const roleCounts=new Map(), physical=new Set();
  for (const a of report.artifacts) {
    if (!roles[backend].has(a?.role) || typeof a.path !== "string" || !isAbsolute(a.path) ||
        !SHA64.test(a.sha256 || "") || !Number.isSafeInteger(a.bytes) || a.bytes <= 0 ||
        physical.has(a.path)) throw Error("invalid, duplicated or unsupported build artifact");
    physical.add(a.path);
    roleCounts.set(a.role,(roleCounts.get(a.role)||0)+1);
    const actual=await digestFile(a.path);
    if (a.sha256 !== actual.sha256 || a.bytes !== actual.bytes)
      throw Error("build artifact hash mismatch: " + a.role);
  }
  for (const role of requirements[backend]) {
    if (!roleCounts.get(role)) throw Error("missing required build artifact: " + role);
  }
  for (const [role,count] of roleCounts) {
    if (role!=="runtime-dependency" && count!==1) throw Error("duplicate singleton artifact role: " + role);
  }
  // All runtime-dependency paths must be listed in the actually hashed classpath file.
  if (backend==="java") {
    const cp=report.artifacts.find(x=>x.role==="classpath-file");
    const entries=(await readFile(cp.path,"utf8")).trim().split(delimiter).filter(Boolean).map(resolve);
    const included=report.artifacts.filter(x=>x.role==="runtime-dependency").map(x=>x.path);
    if (new Set(entries).size!==entries.length || entries.length!==included.length ||
        entries.some((p,i)=>p!==included[i])) throw Error("unverified Java dependency classpath membership");
  }
  return {status:"PINNED_ARTIFACT_DIGESTS_VERIFIED",backend,artifacts:report.artifacts.length,
    sourceCommit:report.sourceCommit,sourceInputTree:report.sourceInputTree,
    certifiesIndependentAttestation:false,certifiesReproducibility:false};
}
