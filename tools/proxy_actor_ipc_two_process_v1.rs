//! SOURCE_ONLY real OS-process IPC transport oracle for Atto proxy actor design.
//! This spawns an independent Rust server process. It is NOT a compiled Atto
//! actor, not a production event loop, not TLS, and not cryptographic auth.
#![forbid(unsafe_code)]
#![cfg(unix)]
use std::fs;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::net::{UnixListener, UnixStream};
use std::process::{Child, Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use std::thread;
use std::time::Duration;

const VERSION: u8 = 1;
const HELLO: u8 = 10;
const WELCOME: u8 = 11;
const SEND: u8 = 1;
const ADMITTED: u8 = 2;
const PROCESSED: u8 = 3;
const REJECTED: u8 = 4;
const MAX_FRAME: usize = 256;
const CAP: u64 = 0x55aa77dd;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Frame {
    version: u8,
    kind: u8,
    tenant: u64,
    target: u64,
    incarnation: u64,
    message_id: u64,
    attempt: u64,
    capability: u64,
    value: i64,
}
impl Frame {
    fn hello() -> Self {
        Self { version: VERSION, kind: HELLO, tenant: 7, target: 42,
            incarnation: 9, message_id: 100, attempt: 1,
            capability: CAP, value: 0 }
    }
    fn kind(mut self, kind: u8) -> Self { self.kind = kind; self }
}
fn write_frame(stream: &mut dyn Write, frame: Frame) -> io::Result<()> {
    let mut bytes = Vec::with_capacity(58);
    bytes.push(frame.version);
    bytes.push(frame.kind);
    for x in [frame.tenant, frame.target, frame.incarnation,
        frame.message_id, frame.attempt, frame.capability] {
        bytes.extend_from_slice(&x.to_be_bytes());
    }
    bytes.extend_from_slice(&frame.value.to_be_bytes());
    assert_eq!(bytes.len(), 58);
    stream.write_all(&(bytes.len() as u32).to_be_bytes())?;
    stream.write_all(&bytes)
}
fn read_frame(stream: &mut dyn Read) -> io::Result<Frame> {
    let mut len = [0u8; 4];
    stream.read_exact(&mut len)?;
    let len = u32::from_be_bytes(len) as usize;
    if len != 58 || len > MAX_FRAME {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "bounded frame rejected"));
    }
    let mut b = [0u8; 58];
    stream.read_exact(&mut b)?;
    let mut offset = 2;
    let mut next = || {
        let mut x = [0u8; 8];
        x.copy_from_slice(&b[offset..offset + 8]);
        offset += 8;
        u64::from_be_bytes(x)
    };
    let tenant = next();
    let target = next();
    let incarnation = next();
    let message_id = next();
    let attempt = next();
    let capability = next();
    let value = next() as i64;
    Ok(Frame { version: b[0], kind: b[1], tenant, target,
        incarnation, message_id, attempt, capability, value })
}
fn authorized(f: Frame, actor_incarnation: u64) -> bool {
    f.version == VERSION && f.tenant == 7 && f.target == 42 &&
        f.incarnation == actor_incarnation && f.capability == CAP &&
        f.attempt != 0
}
fn serve_one(stream: &mut (impl Read + Write), mode: &str) -> io::Result<()> {
    let actor_incarnation = if mode == "new_incarnation" { 10 } else { 9 };
    let hello = read_frame(stream)?;
    if hello.kind != HELLO || !authorized(hello, actor_incarnation) {
        write_frame(stream, hello.kind(REJECTED))?;
        return Ok(());
    }
    let mut welcome = hello.kind(WELCOME);
    welcome.value = i64::from(std::process::id());
    write_frame(stream, welcome)?;
    let request = match read_frame(stream) {
        Ok(r) => r,
        Err(e) if mode == "oversized" && e.kind() == io::ErrorKind::InvalidData => {
            return Ok(()); // No forged success for an oversized envelope.
        }
        Err(e) => return Err(e),
    };
    if request.kind != SEND || !authorized(request, actor_incarnation) ||
        request.message_id != hello.message_id || request.attempt != hello.attempt {
        write_frame(stream, request.kind(REJECTED))?;
        return Ok(());
    }
    // Test-double for destination mailbox enqueue: allocation happens in B
    // rather than in a forwarding proxy in A. No guest runtime is involved.
    let mut mailbox = std::collections::VecDeque::with_capacity(1);
    mailbox.push_back(request.value);
    if mode == "drop_before_ack" { return Ok(()); }
    let mut admitted = request.kind(ADMITTED);
    admitted.value = i64::from(std::process::id());
    if mode == "forged_ack" { admitted.message_id += 1; }
    write_frame(stream, admitted)?;
    if mode == "crash_after_admit" { return Ok(()); }
    let value = mailbox.pop_front().expect("admitted mailbox item");
    write_frame(stream, Frame { value: value + 10, ..request.kind(PROCESSED) })
}
fn server_entrypoint() -> io::Result<()> {
    let mode = std::env::var("ATTO_IPC_CHILD_MODE").expect("child mode");
    let endpoint = std::env::var("ATTO_IPC_CHILD_ENDPOINT").expect("child endpoint");
    let transport = std::env::var("ATTO_IPC_CHILD_TRANSPORT").expect("child transport");
    match transport.as_str() {
        "unix" => {
            let _ = fs::remove_file(&endpoint);
            let listener = UnixListener::bind(&endpoint)?;
            let (mut stream, _) = listener.accept()?;
            stream.set_read_timeout(Some(Duration::from_secs(4)))?;
            stream.set_write_timeout(Some(Duration::from_secs(4)))?;
            let result = serve_one(&mut stream, &mode);
            drop(stream);
            drop(listener);
            let _ = fs::remove_file(&endpoint);
            result
        }
        "tcp" => {
            // Loopback ONLY: NO TLS / network authentication.
            let listener = TcpListener::bind(&endpoint)?;
            let (mut stream, _) = listener.accept()?;
            stream.set_read_timeout(Some(Duration::from_secs(4)))?;
            stream.set_write_timeout(Some(Duration::from_secs(4)))?;
            serve_one(&mut stream, &mode)
        }
        _ => Err(io::Error::new(io::ErrorKind::InvalidInput, "bad transport")),
    }
}
#[test]
#[ignore = "invoked only in an independent child OS process"]
fn child_process_endpoint() {
    if std::env::var_os("ATTO_IPC_CHILD_MODE").is_some() {
        server_entrypoint().expect("child endpoint transport");
    }
}
#[derive(Clone, Copy)]
enum Transport { Unix, Tcp }
fn spawn_server(transport: Transport, mode: &str) -> (Child, String) {
    let unique = SystemTime::now().duration_since(UNIX_EPOCH)
        .expect("clock").as_nanos();
    let endpoint = match transport {
        Transport::Unix => format!("/tmp/atto-ipc-{}-{unique}.sock", std::process::id()),
        Transport::Tcp => {
            let socket = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = socket.local_addr().unwrap().to_string();
            drop(socket);
            addr
        }
    };
    let child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "child_process_endpoint", "--ignored", "--nocapture"])
        .env("ATTO_IPC_CHILD_MODE", mode)
        .env("ATTO_IPC_CHILD_ENDPOINT", &endpoint)
        .env("ATTO_IPC_CHILD_TRANSPORT", match transport {
            Transport::Unix => "unix", Transport::Tcp => "tcp",
        })
        .stdout(Stdio::null()).stderr(Stdio::piped())
        .spawn().expect("start second process");
    (child, endpoint)
}
fn connect(child: &mut Child, transport: Transport, endpoint: &str) -> Box<dyn ReadWrite> {
    for _ in 0..120 {
        let attempt: io::Result<Box<dyn ReadWrite>> = match transport {
            Transport::Unix => UnixStream::connect(endpoint)
                .map(|s| Box::new(s) as Box<dyn ReadWrite>),
            Transport::Tcp => TcpStream::connect(endpoint)
                .map(|s| Box::new(s) as Box<dyn ReadWrite>),
        };
        if let Ok(s) = attempt { return s; }
        if let Some(status) = child.try_wait().unwrap() {
            panic!("child exited before IPC connection: {status}");
        }
        thread::sleep(Duration::from_millis(15));
    }
    panic!("second process IPC endpoint never bound");
}
trait ReadWrite: Read + Write {}
impl<T: Read + Write> ReadWrite for T {}
fn handshake(stream: &mut dyn ReadWrite, hello: Frame) -> Frame {
    write_frame(stream, hello).unwrap();
    read_frame(stream).unwrap()
}
fn request(stream: &mut dyn ReadWrite, request: Frame) -> io::Result<Frame> {
    write_frame(stream, request)?;
    read_frame(stream)
}
fn assert_correlated(receipt: Frame, request: Frame, stage: u8) {
    assert_eq!(receipt.kind, stage);
    assert_eq!(receipt.version, request.version);
    assert_eq!(receipt.tenant, request.tenant);
    assert_eq!(receipt.target, request.target);
    assert_eq!(receipt.incarnation, request.incarnation);
    assert_eq!(receipt.message_id, request.message_id);
    assert_eq!(receipt.attempt, request.attempt);
    assert_eq!(receipt.capability, request.capability);
}
fn join(mut child: Child, endpoint: &str) {
    let status = child.wait().unwrap();
    let _ = fs::remove_file(endpoint);
    assert!(status.success(), "IPC child failed: {status}");
}
#[test]
fn uds_real_child_actor_host_mailbox_ack_and_processing() {
    let (mut child, addr) = spawn_server(Transport::Unix, "success");
    let mut s = connect(&mut child, Transport::Unix, &addr);
    let welcome = handshake(&mut *s, Frame::hello());
    assert_eq!(welcome.kind, WELCOME);
    assert_eq!(welcome.value, i64::from(child.id()));
    assert_ne!(child.id(), std::process::id());
    let mut msg = Frame::hello().kind(SEND);
    msg.value = 32;
    let ack = request(&mut *s, msg).unwrap();
    assert_correlated(ack, msg, ADMITTED);
    assert_eq!(ack.value, i64::from(child.id()));
    let completed = read_frame(&mut *s).unwrap();
    assert_correlated(completed, msg, PROCESSED);
    assert_eq!(completed.value, 42);
    drop(s);
    join(child, &addr);
}
#[test]
fn tcp_loopback_real_child_process_not_tls_or_remote_security_proof() {
    let (mut child, addr) = spawn_server(Transport::Tcp, "success");
    let mut s = connect(&mut child, Transport::Tcp, &addr);
    assert_eq!(handshake(&mut *s, Frame::hello()).kind, WELCOME);
    let mut msg = Frame::hello().kind(SEND);
    msg.value = 50;
    assert_correlated(request(&mut *s, msg).unwrap(), msg, ADMITTED);
    let processed = read_frame(&mut *s).unwrap();
    assert_correlated(processed, msg, PROCESSED);
    assert_eq!(processed.value, 60);
    drop(s);
    join(child, &addr);
}
#[test]
fn wrong_tenant_and_capability_rejected_during_connection() {
    for change in 0..2 {
        let (mut child, addr) = spawn_server(Transport::Unix, "success");
        let mut s = connect(&mut child, Transport::Unix, &addr);
        let mut hello = Frame::hello();
        if change == 0 { hello.tenant += 1; } else { hello.capability ^= 1; }
        assert_eq!(handshake(&mut *s, hello).kind, REJECTED);
        drop(s);
        join(child, &addr);
    }
}
#[test]
fn wrong_protocol_version_rejected_no_downgrade() {
    let (mut child, addr) = spawn_server(Transport::Unix, "success");
    let mut s = connect(&mut child, Transport::Unix, &addr);
    let mut hello = Frame::hello();
    hello.version = 2;
    assert_eq!(handshake(&mut *s, hello).kind, REJECTED);
    drop(s);
    join(child, &addr);
}
#[test]
fn stale_incarnation_after_restart_cannot_retarget_actor() {
    let (mut child, addr) = spawn_server(Transport::Unix, "new_incarnation");
    let mut s = connect(&mut child, Transport::Unix, &addr);
    assert_eq!(handshake(&mut *s, Frame::hello()).kind, REJECTED);
    drop(s);
    join(child, &addr);
}
#[test]
fn wrong_target_after_authenticated_connection_rejected() {
    let (mut child, addr) = spawn_server(Transport::Unix, "success");
    let mut s = connect(&mut child, Transport::Unix, &addr);
    assert_eq!(handshake(&mut *s, Frame::hello()).kind, WELCOME);
    let mut wrong = Frame::hello().kind(SEND);
    wrong.target = 41;
    assert_eq!(request(&mut *s, wrong).unwrap().kind, REJECTED);
    drop(s);
    join(child, &addr);
}
#[test]
fn crossed_correlation_ack_is_not_accepted_as_destination_receipt() {
    let (mut child, addr) = spawn_server(Transport::Unix, "forged_ack");
    let mut s = connect(&mut child, Transport::Unix, &addr);
    assert_eq!(handshake(&mut *s, Frame::hello()).kind, WELCOME);
    let msg = Frame::hello().kind(SEND);
    let ack = request(&mut *s, msg).unwrap();
    assert_eq!(ack.kind, ADMITTED);
    assert_ne!(ack.message_id, msg.message_id);
    // A correct client must reject the mismatch; no success recorded.
    assert!(std::panic::catch_unwind(|| assert_correlated(ack, msg, ADMITTED)).is_err());
    drop(s);
    join(child, &addr);
}
#[test]
fn reset_before_ack_is_indeterminate_not_rejected() {
    let (mut child, addr) = spawn_server(Transport::Unix, "drop_before_ack");
    let mut s = connect(&mut child, Transport::Unix, &addr);
    assert_eq!(handshake(&mut *s, Frame::hello()).kind, WELCOME);
    let msg = Frame::hello().kind(SEND);
    assert!(request(&mut *s, msg).is_err(), "ambiguous lost ACK must not be success");
    drop(s);
    join(child, &addr);
}
#[test]
fn crash_after_mailbox_ack_does_not_claim_processed() {
    let (mut child, addr) = spawn_server(Transport::Unix, "crash_after_admit");
    let mut s = connect(&mut child, Transport::Unix, &addr);
    assert_eq!(handshake(&mut *s, Frame::hello()).kind, WELCOME);
    let msg = Frame::hello().kind(SEND);
    assert_correlated(request(&mut *s, msg).unwrap(), msg, ADMITTED);
    assert!(read_frame(&mut *s).is_err(), "no process success without committed turn");
    drop(s);
    join(child, &addr);
}
#[test]
fn bound_check_rejects_oversized_frame_before_allocation() {
    let (mut child, addr) = spawn_server(Transport::Unix, "oversized");
    let mut s = connect(&mut child, Transport::Unix, &addr);
    assert_eq!(handshake(&mut *s, Frame::hello()).kind, WELCOME);
    s.write_all(&((MAX_FRAME + 1) as u32).to_be_bytes()).unwrap();
    assert!(read_frame(&mut *s).is_err(), "oversize must not receive success");
    drop(s);
    join(child, &addr);
}
