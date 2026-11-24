#define _POSIX_C_SOURCE 200809L

#include "oreslang/runtime/SourceActorBootstrap.h"

#include <assert.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

extern uint64_t oreslang_protocol_spawn_Worker(void);
extern uint64_t oreslang_protocol_spawn_PaymentProcessor(void);
extern uint64_t oreslang_protocol_spawn_ResetActor(void);
extern uint64_t oreslang_protocol_spawn_LimitsActor(void);
extern int oreslang_protocol_send_6_Worker_connect(OresSourceActorId, int32_t);
extern int oreslang_protocol_send_6_Worker_connected(OresSourceActorId);
extern uint64_t oreslang_protocol_encode_6_Worker_connect(uint8_t*, uint64_t, int32_t);
extern uint64_t oreslang_protocol_encode_6_Worker_connected(uint8_t*, uint64_t);
extern uint64_t oreslang_protocol_encode_6_Worker_fail(uint8_t*, uint64_t);
extern uint64_t oreslang_protocol_encode_16_PaymentProcessor_authorize(uint8_t*, uint64_t);
extern uint64_t oreslang_protocol_encode_16_PaymentProcessor_capture(uint8_t*, uint64_t);
extern uint64_t oreslang_protocol_encode_10_ResetActor_reset(uint8_t*, uint64_t);
extern uint64_t oreslang_protocol_encode_11_LimitsActor_finish(uint8_t*, uint64_t, int64_t, int32_t);

enum { Committed = 1, IllegalEdge, InvalidPayload, InvalidEnvelope, Interrupted };
enum { Connected, Connecting, Disconnected, Failed };
enum { Authorized, Cancelled, Captured, Pending, Rejected };

typedef struct { OresSourceActorId id; uint64_t turns; } Actor;

static unsigned checks;

static uint64_t u64(const uint8_t* bytes) {
    uint64_t value = 0;
    for (unsigned i = 0; i < 8; ++i) value |= (uint64_t)bytes[i] << (8 * i);
    return value;
}

static void print_hex(const char* name, const uint8_t* bytes, size_t size) {
    printf("%s ", name);
    for (size_t i = 0; i < size; ++i) printf("%02X", bytes[i]);
    putchar('\n');
}

static void expect(Actor* actor, unsigned status, unsigned source, unsigned destination) {
    uint8_t receipt[ORES_SOURCE_PROTOCOL_RECEIPT_SIZE];
    assert(!oreslang_source_actor_try_pop_protocol_receipt_id(actor->id, receipt, sizeof(receipt) - 1));
    for (unsigned attempt = 0; ; ++attempt) {
        if (oreslang_source_actor_try_pop_protocol_receipt_id(actor->id, receipt, sizeof(receipt))) break;
        assert(attempt < 10000);
        const struct timespec delay = {0, 1000000};
        nanosleep(&delay, NULL);
    }
    assert(memcmp(receipt, "ATPR\1", 5) == 0);
    assert(u64(receipt + 5) == actor->id);
    assert(u64(receipt + 13) == 1);
    assert(u64(receipt + 21) == ++actor->turns);
    assert(receipt[29] == status && receipt[30] == source && receipt[31] == 0 &&
           receipt[32] == destination && receipt[33] == 0);
    if (checks++ == 0) print_hex("receipt", receipt, sizeof(receipt));
}

static void submit(Actor* actor, uint8_t* frame, uint64_t length,
                   unsigned status, unsigned source, unsigned destination) {
    assert(oreslang_source_actor_try_send_protocol_id(actor->id, frame, length));
    /* The DATA callback must consume its own copy. */
    if (length) memset(frame, 0, (size_t)length);
    expect(actor, status, source, destination);
}

static pthread_mutex_t blocker_gate = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t blocker_changed = PTHREAD_COND_INITIALIZER;
static unsigned blockers_entered;
static int release_blockers;

static void blocker_init(OresActorI64Heap* heap, uint64_t domain, uint64_t epoch) {
    (void)heap;
    (void)domain;
    (void)epoch;
}

static int64_t block_carrier(OresActorI64Heap* heap, uint64_t domain, uint64_t epoch, int64_t payload) {
    (void)heap;
    (void)domain;
    (void)epoch;
    assert(!pthread_mutex_lock(&blocker_gate));
    ++blockers_entered;
    assert(!pthread_cond_broadcast(&blocker_changed));
    while (!release_blockers) assert(!pthread_cond_wait(&blocker_changed, &blocker_gate));
    assert(!pthread_mutex_unlock(&blocker_gate));
    return payload;
}

static void test_stopped_queue(void) {
    enum { CarrierCount = 4, MailboxCapacity = 128 };
    OresSourceActorId blockers[CarrierCount];
    Actor stopped = {oreslang_protocol_spawn_Worker(), 0};
    for (size_t i = 0; i < CarrierCount; ++i)
        blockers[i] = oreslang_source_actor_spawn_id(blocker_init, block_carrier, 1);
    for (size_t i = 0; i < CarrierCount; ++i)
        assert(oreslang_source_actor_try_send_id(blockers[i], 0));

    struct timespec deadline;
    assert(timespec_get(&deadline, TIME_UTC) == TIME_UTC);
    deadline.tv_sec += 10;
    assert(!pthread_mutex_lock(&blocker_gate));
    while (blockers_entered != CarrierCount)
        assert(!pthread_cond_timedwait(&blocker_changed, &blocker_gate, &deadline));

    uint8_t frame[64], receipt[ORES_SOURCE_PROTOCOL_RECEIPT_SIZE];
    const uint64_t size = oreslang_protocol_encode_6_Worker_connect(frame, sizeof(frame), 42);
    assert(size == 47);
    for (size_t i = 0; i < MailboxCapacity; ++i)
        assert(oreslang_source_actor_try_send_protocol_id(stopped.id, frame, size));
    assert(!oreslang_source_actor_try_send_protocol_id(stopped.id, frame, size));
    assert(oreslang_source_actor_try_request_stop_id(stopped.id));
    assert(!oreslang_source_actor_try_send_protocol_id(stopped.id, frame, size));
    assert(!oreslang_source_actor_try_pop_protocol_receipt_id(stopped.id, receipt, sizeof(receipt)));

    release_blockers = 1;
    assert(!pthread_cond_broadcast(&blocker_changed));
    assert(!pthread_mutex_unlock(&blocker_gate));
    oreslang_source_actor_join_done_id(stopped.id);
    for (size_t i = 0; i < CarrierCount; ++i) oreslang_source_actor_stop_id(blockers[i]);
}

static void test_stop_races(void) {
    for (unsigned round = 0; round < 24; ++round) {
        Actor actor = {oreslang_protocol_spawn_Worker(), 0};
        uint8_t frame[64], receipt[ORES_SOURCE_PROTOCOL_RECEIPT_SIZE];
        const uint64_t size = oreslang_protocol_encode_6_Worker_connect(frame, sizeof(frame), 42);
        assert(oreslang_source_actor_try_send_protocol_id(actor.id, frame, size));
        assert(oreslang_source_actor_try_request_stop_id(actor.id));
        assert(!oreslang_source_actor_try_send_protocol_id(actor.id, frame, size));
        if (oreslang_source_actor_try_pop_protocol_receipt_id(actor.id, receipt, sizeof(receipt))) {
            assert(receipt[30] == Disconnected && u64(receipt + 21) == 1);
            assert((receipt[29] == Committed && receipt[32] == Connecting) ||
                   (receipt[29] == Interrupted && receipt[32] == Disconnected));
        }
        oreslang_source_actor_join_done_id(actor.id);
        assert(!oreslang_source_actor_try_pop_protocol_receipt_id(actor.id, receipt, sizeof(receipt)));
    }
}

int main(void) {
    uint8_t frame[192] = {0};
    const size_t capacity = sizeof(frame);
    uint64_t size = oreslang_protocol_encode_6_Worker_connect(frame, capacity, 42);
    assert(size == 47);
    print_hex("frame", frame, size);
    assert(oreslang_protocol_encode_6_Worker_connect(frame, size - 1, 42) == 0);

    Actor worker = {oreslang_protocol_spawn_Worker(), 0};
    assert(worker.id && !oreslang_source_actor_try_send_id(worker.id, 1));
    size = oreslang_protocol_encode_6_Worker_connected(frame, capacity);
    submit(&worker, frame, size, IllegalEdge, Disconnected, Disconnected);
    size = oreslang_protocol_encode_16_PaymentProcessor_authorize(frame, capacity);
    submit(&worker, frame, size, InvalidEnvelope, Disconnected, Disconnected);
    size = oreslang_protocol_encode_6_Worker_connect(frame, capacity, 0);
    submit(&worker, frame, size, InvalidPayload, Disconnected, Disconnected);
    size = oreslang_protocol_encode_6_Worker_connect(frame, capacity, 60001);
    submit(&worker, frame, size, InvalidPayload, Disconnected, Disconnected);
    size = oreslang_protocol_encode_6_Worker_connect(frame, capacity, 42);
    submit(&worker, frame, size - 1, InvalidPayload, Disconnected, Disconnected);
    size = oreslang_protocol_encode_6_Worker_connect(frame, capacity, 42);
    submit(&worker, frame, capacity, InvalidPayload, Disconnected, Disconnected);
    size = oreslang_protocol_encode_6_Worker_connect(frame, capacity, 42);
    frame[37] = 255;
    submit(&worker, frame, size, InvalidEnvelope, Disconnected, Disconnected);
    submit(&worker, NULL, 0, InvalidEnvelope, Disconnected, Disconnected);
    assert(oreslang_protocol_send_6_Worker_connect(worker.id, 1));
    expect(&worker, Committed, Disconnected, Connecting);
    assert(oreslang_protocol_send_6_Worker_connected(worker.id));
    expect(&worker, Committed, Connecting, Connected);
    size = oreslang_protocol_encode_6_Worker_connect(frame, capacity, 60000);
    submit(&worker, frame, size, Committed, Connected, Connecting);
    size = oreslang_protocol_encode_6_Worker_fail(frame, capacity);
    submit(&worker, frame, size, Committed, Connecting, Failed);
    size = oreslang_protocol_encode_6_Worker_connect(frame, capacity, 42);
    submit(&worker, frame, size, IllegalEdge, Failed, Failed);
    oreslang_source_actor_stop_id(worker.id);

    Actor replacement = {oreslang_protocol_spawn_Worker(), 0};
    assert(replacement.id != worker.id);
    size = oreslang_protocol_encode_6_Worker_connected(frame, capacity);
    assert(!oreslang_protocol_send_6_Worker_connect(worker.id, 42));
    submit(&replacement, frame, size, IllegalEdge, Disconnected, Disconnected);
    size = oreslang_protocol_encode_6_Worker_connect(frame, capacity, 42);
    submit(&replacement, frame, size, Committed, Disconnected, Connecting);
    oreslang_source_actor_stop_id(replacement.id);

    Actor payment = {oreslang_protocol_spawn_PaymentProcessor(), 0};
    size = oreslang_protocol_encode_16_PaymentProcessor_capture(frame, capacity);
    submit(&payment, frame, size, IllegalEdge, Pending, Pending);
    size = oreslang_protocol_encode_16_PaymentProcessor_authorize(frame, capacity);
    submit(&payment, frame, size, Committed, Pending, Authorized);
    size = oreslang_protocol_encode_16_PaymentProcessor_capture(frame, capacity);
    submit(&payment, frame, size, Committed, Authorized, Captured);
    oreslang_source_actor_stop_id(payment.id);

    Actor reset = {oreslang_protocol_spawn_ResetActor(), 0};
    size = oreslang_protocol_encode_10_ResetActor_reset(frame, capacity);
    submit(&reset, frame, size, Committed, 1, 0);
    oreslang_source_actor_stop_id(reset.id);
    Actor limits = {oreslang_protocol_spawn_LimitsActor(), 0};
    size = oreslang_protocol_encode_11_LimitsActor_finish(frame, capacity, INT64_MIN + 1, INT32_MIN);
    submit(&limits, frame, size, InvalidPayload, 1, 1);
    size = oreslang_protocol_encode_11_LimitsActor_finish(frame, capacity, INT64_MIN, INT32_MIN);
    assert(size == 55 && u64(frame + 39) == (uint64_t)INT64_MIN &&
           u64(frame + 47) == (uint64_t)(int64_t)INT32_MIN);
    submit(&limits, frame, size, Committed, 1, 0);
    oreslang_source_actor_stop_id(limits.id);

    test_stopped_queue();
    test_stop_races();
    printf("verified %u live LLVM protocol turn receipts and 24 stop races\n", checks);
}
