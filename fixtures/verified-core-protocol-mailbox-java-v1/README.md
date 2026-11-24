# Verified Core Java protocol mailbox conformance

Run from an `atto-platform-conformance` checkout with Maven and Java 25.

```sh
node bin/verify-verified-core-protocol-mailbox-java.mjs ../atto-source.java java mvn ../atto-common-source
```

The runner compiles the Java frontend and runtime, then lowers the shared Atto actor sources into code-image-bound executors. The host sends binary frames through actual private actor mailboxes and reads the runtime-owned output streams. It tests both content and lifecycle behavior and compares the request and receipt framing with the shared codec.
