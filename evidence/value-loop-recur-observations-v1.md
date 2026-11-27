# Partial value-loop execution observations

The exact stateless single-break fixture is recorded for four independent compiler families: Rust, JavaScript, Java/GraalVM JVM and native LLVM (O0/O2). Rust native and Wasm compiler hosts are one family. Java and LLVM focused guest gates passed; their broader failures were reproduced on exact unchanged baselines. Java Native Image is not certified. These case-specific historical receipts do not modify the prospective 28-case manifest or certify full parity. .NET, Forge, Cranelift and independent Wasm are still unqualified here.
