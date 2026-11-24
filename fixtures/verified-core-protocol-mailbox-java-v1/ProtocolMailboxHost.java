import dev.oreslang.runtime.ActorRuntime;
import dev.oreslang.runtime.ActorRuntime.ActorRef;
import dev.oreslang.runtime.IsolatePolicy;
import dev.oreslang.runtime.ProtocolActorMir;
import dev.oreslang.runtime.ProtocolActorMir.Receipt;
import dev.oreslang.runtime.ProtocolActorMir.Status;
import dev.oreslang.runtime.SharedCodeImageStore;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class ProtocolMailboxHost {
    private static final int TIMEOUT = 15;
    private static final int RACES = 24;
    private int receiptCount;
    private boolean printedReceipt;

    private record ActorProgram(ProtocolActorMir.Plan plan, SharedCodeImageStore.CodeImage image) {
        static ActorProgram read(SharedCodeImageStore store, String source) throws Exception {
            var plan = ProtocolActorMir.lower(Files.readString(Path.of(source)));
            return new ActorProgram(plan, store.publish(source, plan.program()));
        }

        ActorRef<Object> spawn(ActorRuntime runtime, String actorName) throws Exception {
            var ref = plan.spawn(runtime, image, actorName);
            ref.ready().get(TIMEOUT, TimeUnit.SECONDS);
            return ref;
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
    }

    private void expect(ActorRef<Object> actor, Status status, int before, int after, byte[] payload)
            throws Exception {
        actor.send(payload);
        var step = actor.outputs().next().get(TIMEOUT, TimeUnit.SECONDS);
        require(!step.done() && step.value().actorId().equals(actor.id()), "missing or foreign actor output");
        var receipt = Receipt.decode(step.value().value());
        require(receipt.status() == status && receipt.source() == before && receipt.destination() == after
                        && receipt.turn() == step.value().sequence() + 1,
                "unexpected protocol receipt " + receipt);
        receiptCount++;
        if (!printedReceipt) {
            var list = (List<?>) step.value().value();
            var bytes = new byte[list.size()];
            for (int i = 0; i < bytes.length; i++) bytes[i] = (Byte) list.get(i);
            System.out.println("receipt " + HexFormat.of().withUpperCase().formatHex(bytes));
            printedReceipt = true;
        }
    }

    private static void drain(ActorRef<?> actor) throws Exception {
        actor.gracefulStop().get(TIMEOUT, TimeUnit.SECONDS);
        require(actor.outputs().next().get(TIMEOUT, TimeUnit.SECONDS).done(), "unexpected extra protocol receipt");
    }

    private void run(String[] args) throws Exception {
        var dispatcher = new ActorRuntime.DispatcherConfig(1, 1, 16, 16);
        try (var store = new SharedCodeImageStore(); var runtime = new ActorRuntime(IsolatePolicy.developer(), dispatcher)) {
            var connection = ActorProgram.read(store, args[0]);
            var payment = ActorProgram.read(store, args[1]);
            var standalone = ActorProgram.read(store, args[2]);
            try {
                ActorProgram.read(store, args[3]);
                throw new IllegalStateException("effectful handler received protocol code authority");
            } catch (RuntimeException rejected) {
                if (!rejected.getMessage().contains("E_PROTOCOL_TRANSITION:")) throw rejected;
            }

            var worker = connection.spawn(runtime, "Worker");
            int disconnected = connection.plan().stateOrdinal("Worker", "Disconnected");
            int connecting = connection.plan().stateOrdinal("Worker", "Connecting");
            int connected = connection.plan().stateOrdinal("Worker", "Connected");
            int failed = connection.plan().stateOrdinal("Worker", "Failed");
            byte[] accept = connection.plan().encode("Worker", "connected");
            byte[] fail = connection.plan().encode("Worker", "fail");
            var connect = connection.plan().encode("Worker", "connect", 42);
            System.out.println("frame " + HexFormat.of().withUpperCase().formatHex(connect));
            expect(worker, Status.ILLEGAL_EDGE, disconnected, disconnected, accept);
            expect(worker, Status.INVALID_ENVELOPE, disconnected, disconnected,
                    payment.plan().encode("PaymentProcessor", "authorize"));
            expect(worker, Status.INVALID_PAYLOAD, disconnected, disconnected,
                    connection.plan().encode("Worker", "connect", 0));
            expect(worker, Status.INVALID_PAYLOAD, disconnected, disconnected,
                    connection.plan().encode("Worker", "connect", 60_001));
            expect(worker, Status.INVALID_PAYLOAD, disconnected, disconnected, Arrays.copyOf(connect, connect.length - 1));
            expect(worker, Status.INVALID_PAYLOAD, disconnected, disconnected, Arrays.copyOf(connect, connect.length + 1));
            byte[] badVersion = connect.clone();
            badVersion[4] ^= 1;
            expect(worker, Status.INVALID_ENVELOPE, disconnected, disconnected, badVersion);
            expect(worker, Status.COMMITTED, disconnected, connecting, connection.plan().encode("Worker", "connect", 1));
            expect(worker, Status.COMMITTED, connecting, connected, accept);
            expect(worker, Status.COMMITTED, connected, connecting, connection.plan().encode("Worker", "connect", 60_000));
            expect(worker, Status.COMMITTED, connecting, failed, fail);
            expect(worker, Status.ILLEGAL_EDGE, failed, failed, connect);
            drain(worker);

            var replacement = connection.spawn(runtime, "Worker");
            require(!replacement.id().equals(worker.id()), "fresh spawn reused a retired actor reference");
            try {
                worker.send(connect);
                throw new IllegalStateException("retired actor admitted a message");
            } catch (ActorRuntime.ActorTerminatedException retired) {
                // A fresh spawn grants no authority to the old reference.
            }
            expect(replacement, Status.ILLEGAL_EDGE, disconnected, disconnected, accept);
            expect(replacement, Status.COMMITTED, disconnected, connecting, connect);
            drain(replacement);

            var processor = payment.spawn(runtime, "PaymentProcessor");
            int pending = payment.plan().stateOrdinal("PaymentProcessor", "Pending");
            int authorized = payment.plan().stateOrdinal("PaymentProcessor", "Authorized");
            int captured = payment.plan().stateOrdinal("PaymentProcessor", "Captured");
            var capture = payment.plan().encode("PaymentProcessor", "capture");
            expect(processor, Status.ILLEGAL_EDGE, pending, pending, capture);
            expect(processor, Status.COMMITTED, pending, authorized, payment.plan().encode("PaymentProcessor", "authorize"));
            expect(processor, Status.COMMITTED, authorized, captured, capture);
            drain(processor);

            var blocked = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            var target = connection.spawn(runtime, "Worker");
            ActorRef<Object> blocker = runtime.spawnPrivateTrusted(context -> (value, turn) -> {
                blocked.countDown();
                require(release.await(TIMEOUT, TimeUnit.SECONDS), "timed out releasing private carrier");
            });
            try (var controller = Executors.newVirtualThreadPerTaskExecutor()) {
                try {
                    blocker.send(1L);
                    require(blocked.await(TIMEOUT, TimeUnit.SECONDS), "test carrier did not start");
                    target.send(connect);
                    var stopped = controller.submit(target::stop);
                    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT);
                    while (target.isAlive() && System.nanoTime() < deadline) Thread.sleep(1);
                    require(!target.isAlive(), "STOP did not fence the queued turn");
                    release.countDown();
                    stopped.get(TIMEOUT, TimeUnit.SECONDS);
                } finally {
                    release.countDown();
                }
            }
            target.done().get(TIMEOUT, TimeUnit.SECONDS);
            require(target.outputs().next().get(TIMEOUT, TimeUnit.SECONDS).done(), "queued STOP published a protocol output");
            drain(blocker);

            var actor = standalone.spawn(runtime, "ResetActor");
            int waiting = standalone.plan().stateOrdinal("ResetActor", "Waiting");
            int ready = standalone.plan().stateOrdinal("ResetActor", "Ready");
            var reset = standalone.plan().encode("ResetActor", "reset");
            expect(actor, Status.COMMITTED, waiting, ready, reset);
            drain(actor);

            var limits = standalone.spawn(runtime, "LimitsActor");
            int limitWaiting = standalone.plan().stateOrdinal("LimitsActor", "Waiting");
            int done = standalone.plan().stateOrdinal("LimitsActor", "Done");
            expect(limits, Status.INVALID_PAYLOAD, limitWaiting, limitWaiting,
                    standalone.plan().encode("LimitsActor", "finish", Long.MIN_VALUE + 1, Integer.MIN_VALUE));
            expect(limits, Status.COMMITTED, limitWaiting, done,
                    standalone.plan().encode("LimitsActor", "finish", Long.MIN_VALUE, Integer.MAX_VALUE));
            drain(limits);

            try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
                for (int i = 0; i < RACES; i++) {
                    var racing = standalone.spawn(runtime, "ResetActor");
                    var start = new CountDownLatch(1);
                    var send = workers.submit(() -> {
                        start.await();
                        try {
                            racing.send(reset);
                            return true;
                        } catch (ActorRuntime.ActorTerminatedException stopped) {
                            return false;
                        }
                    });
                    var stop = workers.submit(() -> { start.await(); racing.stop(); return null; });
                    start.countDown();
                    boolean admitted = send.get(TIMEOUT, TimeUnit.SECONDS);
                    stop.get(TIMEOUT, TimeUnit.SECONDS);
                    racing.done().get(TIMEOUT, TimeUnit.SECONDS);
                    var step = racing.outputs().next().get(TIMEOUT, TimeUnit.SECONDS);
                    if (!step.done()) {
                        var receipt = Receipt.decode(step.value().value());
                        require(admitted && receipt.turn() == 1 && receipt.source() == waiting
                                        && (receipt.status() == Status.COMMITTED && receipt.destination() == ready
                                            || receipt.status() == Status.INTERRUPTED && receipt.destination() == waiting),
                                "unlinearizable protocol turn/stop receipt " + receipt);
                        require(racing.outputs().next().get(TIMEOUT, TimeUnit.SECONDS).done(), "duplicate protocol receipt");
                    }
                }
            }
            System.out.println("verified " + receiptCount + " live Java protocol turn receipts and " + RACES + " stop races");
        }
    }

    public static void main(String[] args) throws Exception {
        new ProtocolMailboxHost().run(args);
    }
}
