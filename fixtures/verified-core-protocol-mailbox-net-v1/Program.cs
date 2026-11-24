using System.Threading.Channels;
using Ores.Net.Runtime;
using Oreslang.Generated;

var timeout = TimeSpan.FromSeconds(15);
using var runtime = new ActorRuntime(new ActorRuntimeOptions
{
    MaxActors = 16,
    MailboxMessages = 64,
    DemandBackedActorHeaps = true,
    Dispatcher = new ActorDispatcherOptions
    {
        PrivateWorkers = 1,
        SharedWorkers = 1,
        UntrustedWorkers = 1,
        QueueCapacityPerDomain = 16,
        StealGraceMicroseconds = -1,
    },
});
var inbox = Channel.CreateBounded<ProtocolTurnReceipt>(64);
byte[]? firstReceipt = null;
ActorRef replies = runtime.Spawn(ActorKind.Shared, (_, bytes) =>
{
    firstReceipt ??= bytes.ToArray();
    if (!inbox.Writer.TryWrite(ProtocolTurnReceipt.Decode(bytes.Span)))
        throw new InvalidOperationException("Protocol receipts exceeded the test mailbox");
});

static void Require(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

var turns = new Dictionary<ActorRef, ulong>();
async Task Expect(ActorRef actor, ProtocolTurnStatus status, ushort source, ushort destination, Action send)
{
    send();
    var receipt = await inbox.Reader.ReadAsync().AsTask().WaitAsync(timeout);
    ulong turn = turns.GetValueOrDefault(actor) + 1;
    var expected = new ProtocolTurnReceipt(actor.Id, actor.Generation, turn, status, source, destination);
    Require(receipt == expected, $"Expected {expected}; received {receipt}");
    turns[actor] = turn;
}

var worker = Actor_Worker.SpawnRuntime(runtime, replies);
const ushort disconnected = Actor_Worker.State_Disconnected;
const ushort connecting = Actor_Worker.State_Connecting;
const ushort connected = Actor_Worker.State_Connected;
const ushort failed = Actor_Worker.State_Failed;

await Expect(worker, ProtocolTurnStatus.IllegalEdge, disconnected, disconnected,
    () => Actor_Worker.Send_connected(runtime, worker));
await Expect(worker, ProtocolTurnStatus.InvalidEnvelope, disconnected, disconnected,
    () => Actor_PaymentProcessor.Send_authorize(runtime, worker));
await Expect(worker, ProtocolTurnStatus.InvalidPayload, disconnected, disconnected,
    () => Actor_Worker.Send_connect(runtime, worker, 0));
await Expect(worker, ProtocolTurnStatus.InvalidPayload, disconnected, disconnected,
    () => Actor_Worker.Send_connect(runtime, worker, 60_001));

var copied = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
var capture = runtime.Spawn(ActorKind.Shared, (_, bytes) => copied.TrySetResult(bytes.ToArray()));
Actor_Worker.Send_connect(runtime, capture, 42);
byte[] encoded = await copied.Task.WaitAsync(timeout);
Console.WriteLine("frame " + Convert.ToHexString(encoded));
await runtime.DrainAndStop(capture).WaitAsync(timeout);
await Expect(worker, ProtocolTurnStatus.InvalidPayload, disconnected, disconnected,
    () => runtime.Send(worker, encoded.AsSpan(0, encoded.Length - 1)));
await Expect(worker, ProtocolTurnStatus.InvalidPayload, disconnected, disconnected,
    () => runtime.Send(worker, [.. encoded, 0]));
encoded[4] ^= 1;
await Expect(worker, ProtocolTurnStatus.InvalidEnvelope, disconnected, disconnected,
    () => runtime.Send(worker, encoded));

await Expect(worker, ProtocolTurnStatus.Committed, disconnected, connecting,
    () => Actor_Worker.Send_connect(runtime, worker, 1));
await Expect(worker, ProtocolTurnStatus.Committed, connecting, connected,
    () => Actor_Worker.Send_connected(runtime, worker));
await Expect(worker, ProtocolTurnStatus.Committed, connected, connecting,
    () => Actor_Worker.Send_connect(runtime, worker, 60_000));
await Expect(worker, ProtocolTurnStatus.Committed, connecting, failed,
    () => Actor_Worker.Send_fail(runtime, worker));
await Expect(worker, ProtocolTurnStatus.IllegalEdge, failed, failed,
    () => Actor_Worker.Send_connect(runtime, worker, 42));
await runtime.DrainAndStop(worker).WaitAsync(timeout);

var replacement = Actor_Worker.SpawnRuntime(runtime, replies);
Require(worker != replacement, "Replacement reused an old actor reference");
try
{
    Actor_Worker.Send_connect(runtime, worker, 42);
    throw new Exception("Retired actor reference admitted a message");
}
catch (InvalidOperationException failure) when (failure.Message.Contains("stale", StringComparison.Ordinal))
{
}
await Expect(replacement, ProtocolTurnStatus.IllegalEdge, disconnected, disconnected,
    () => Actor_Worker.Send_connected(runtime, replacement));
await Expect(replacement, ProtocolTurnStatus.Committed, disconnected, connecting,
    () => Actor_Worker.Send_connect(runtime, replacement, 42));
await runtime.DrainAndStop(replacement).WaitAsync(timeout);

var payment = Actor_PaymentProcessor.SpawnRuntime(runtime, replies);
const ushort pending = Actor_PaymentProcessor.State_Pending;
const ushort authorized = Actor_PaymentProcessor.State_Authorized;
const ushort captured = Actor_PaymentProcessor.State_Captured;
await Expect(payment, ProtocolTurnStatus.IllegalEdge, pending, pending,
    () => Actor_PaymentProcessor.Send_capture(runtime, payment));
await Expect(payment, ProtocolTurnStatus.Committed, pending, authorized,
    () => Actor_PaymentProcessor.Send_authorize(runtime, payment));
await Expect(payment, ProtocolTurnStatus.Committed, authorized, captured,
    () => Actor_PaymentProcessor.Send_capture(runtime, payment));
await runtime.DrainAndStop(payment).WaitAsync(timeout);

// Occupy the only private carrier so Stop can deterministically win against
// a queued transition. The stopped mailbox owns and discards that frame.
using var release = new ManualResetEventSlim();
var blocked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var blocker = runtime.Spawn(ActorKind.Private, (_, _) =>
{
    blocked.TrySetResult();
    Require(release.Wait(timeout), "Timed out releasing the test carrier");
});
var stopped = Actor_Worker.SpawnRuntime(runtime, replies);
Task retirement = runtime.ObserveTermination(stopped);
try
{
    runtime.Send(blocker, []);
    await blocked.Task.WaitAsync(timeout);
    Actor_Worker.Send_connect(runtime, stopped, 42);
    runtime.Stop(stopped);
}
finally
{
    release.Set();
}
await retirement.WaitAsync(timeout);
await runtime.DrainAndStop(blocker).WaitAsync(timeout);

var reset = Actor_ResetActor.SpawnRuntime(runtime, replies);
await Expect(reset, ProtocolTurnStatus.Committed, Actor_ResetActor.State_Waiting,
    Actor_ResetActor.State_Ready, () => Actor_ResetActor.Send_reset(runtime, reset));
await runtime.DrainAndStop(reset).WaitAsync(timeout);

var limits = Actor_LimitsActor.SpawnRuntime(runtime, replies);
const ushort waiting = Actor_LimitsActor.State_Waiting;
await Expect(limits, ProtocolTurnStatus.InvalidPayload, waiting, waiting,
    () => Actor_LimitsActor.Send_finish(runtime, limits, long.MinValue + 1, int.MinValue));
await Expect(limits, ProtocolTurnStatus.Committed, waiting, Actor_LimitsActor.State_Done,
    () => Actor_LimitsActor.Send_finish(runtime, limits, long.MinValue, int.MaxValue));
await runtime.DrainAndStop(limits).WaitAsync(timeout);

const int races = 24;
var concurrent = new Dictionary<ulong, (ActorRef Actor, bool Admitted)>();
for (int i = 0; i < races; i++)
{
    var racing = Actor_ResetActor.SpawnRuntime(runtime, replies);
    Task retired = runtime.ObserveTermination(racing);
    var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    Task<bool> send = Task.Run(async () =>
    {
        await start.Task;
        try
        {
            Actor_ResetActor.Send_reset(runtime, racing);
            return true;
        }
        catch (InvalidOperationException failure)
            when (failure.Message.Contains("stale", StringComparison.Ordinal))
        {
            return false;
        }
    });
    Task stop = Task.Run(async () =>
    {
        await start.Task;
        runtime.Stop(racing);
    });
    start.SetResult();
    await Task.WhenAll(send, stop, retired).WaitAsync(timeout);
    concurrent.Add(racing.Id, (racing, await send));
}
await runtime.DrainAndStop(replies).WaitAsync(timeout);
while (inbox.Reader.TryRead(out var receipt))
{
    Require(concurrent.Remove(receipt.ActorId, out var race) && race.Admitted,
        "Duplicate or non-admitted protocol turn published a receipt");
    Require(receipt.Generation == race.Actor.Generation && receipt.Turn == 1 &&
        receipt.Source == Actor_ResetActor.State_Waiting &&
        (receipt.Status == ProtocolTurnStatus.Committed && receipt.Destination == Actor_ResetActor.State_Ready ||
         receipt.Status == ProtocolTurnStatus.Interrupted && receipt.Destination == Actor_ResetActor.State_Waiting),
        $"Unlinearizable protocol turn/stop receipt: {receipt}");
}
Require(firstReceipt is not null, "No protocol receipt bytes reached the observer");
Console.WriteLine("receipt " + Convert.ToHexString(firstReceipt!));
Require(runtime.FaultedTurns == 0, $"Runtime faulted {runtime.FaultedTurns} protocol turns");
Console.WriteLine($"verified {turns.Values.Sum(n => (long)n)} live .NET protocol turn receipts and {races} stop races");
