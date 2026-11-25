#ifndef ATTOXP_UI_ABI_V1_H
#define ATTOXP_UI_ABI_V1_H
/* PROPOSED ABI ONLY. This header does not implement or certify a native adapter. */
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define ATTOXP_UI_ABI_MAJOR 1u
#define ATTOXP_UI_ABI_MINOR 0u
#define ATTOXP_UI_MAX_BATCH_BYTES 65536u
#define ATTOXP_UI_MAX_BATCH_OPS 256u

/* Numeric status values are frozen within major version 1. */
typedef enum AttoXpUiStatusV1 {
  ATTOXP_UI_OK = 0,
  ATTOXP_UI_QUEUED = 1,
  ATTOXP_UI_ERR_ABI_VERSION = 100,
  ATTOXP_UI_ERR_INVALID_ARGUMENT = 101,
  ATTOXP_UI_ERR_STALE_HANDLE = 102,
  ATTOXP_UI_ERR_WRONG_APP_SCENE_OR_OWNER = 103,
  ATTOXP_UI_ERR_SCENE_LIFECYCLE = 104,
  ATTOXP_UI_ERR_WRONG_UI_THREAD = 105,
  ATTOXP_UI_ERR_CAPABILITY_DENIED = 106,
  ATTOXP_UI_ERR_QUOTA = 107,
  ATTOXP_UI_ERR_REVISION = 108,
  ATTOXP_UI_ERR_CANCELLED = 109,
  ATTOXP_UI_ERR_QUARANTINED = 110,
  ATTOXP_UI_ERR_REENTRANT = 111,
  ATTOXP_UI_ERR_INTERNAL = 199
} AttoXpUiStatusV1;

/* Unpredictable 128-bit host-issued identity plus non-wrapping generation.
 * These fields are NOT a capability token or an authorization grant.
 * Host table also binds app instance, scene, actor owner, type and lifecycle.
 * Never place native view pointers in actor messages.
 */
typedef struct AttoXpUiHandleV1 {
  uint64_t identity_hi;
  uint64_t identity_lo;
  uint64_t generation;
} AttoXpUiHandleV1;

/* Every entrypoint accepts exact v1 struct_size and reserved_zero == 0;
 * reject unknown major versions; minor features require explicit negotiation.
 */
typedef struct AttoXpUiAbiV1 {
  uint32_t struct_size;
  uint16_t major;
  uint16_t minor;
  uint32_t flags;
  uint32_t reserved_zero;
} AttoXpUiAbiV1;

/* Buffer is BORROWED ONLY for duration of submit. Host copies validated data
 * into an owned, bounded queue before returning ATTOXP_UI_QUEUED.
 * expected_revision is per-scene, checked at commit as well as admission.
 * Caller identity and actor capabilities come from trusted runtime context,
 * never from this untrusted structure.
 */
typedef struct AttoXpUiBatchV1 {
  uint32_t struct_size;
  uint32_t reserved_zero;
  AttoXpUiHandleV1 scene;
  uint64_t expected_revision;
  uint64_t request_id;
  const uint8_t *encoded_ops;
  uint32_t encoded_bytes;
  uint32_t operation_count;
} AttoXpUiBatchV1;

/* No callbacks or host function pointers may cross an actor channel.
 * Completion is an async data-only event on the actor's bounded mailbox.
 */
typedef struct AttoXpUiResultV1 {
  uint32_t struct_size;
  uint32_t status;
  uint64_t request_id;
  uint64_t committed_revision;
} AttoXpUiResultV1;

/* Host entrypoints, not guest imports of arbitrary platform APIs. All return
 * numeric statuses: C++ exceptions, Swift errors, panics and Java exceptions
 * must be caught and mapped before crossing this boundary.
 * Implementations must verify scene generation/ownership/lifecycle BEFORE
 * dereferencing platform objects, and recheck after async dispatch.
 * submit is async; commit/view mutation MUST run on native UI thread.
 */
AttoXpUiStatusV1 attoxp_ui_query_abi_v1(AttoXpUiAbiV1 *out_abi);
AttoXpUiStatusV1 attoxp_ui_submit_batch_v1(const AttoXpUiBatchV1 *batch,
                                           AttoXpUiResultV1 *out_result);
AttoXpUiStatusV1 attoxp_ui_cancel_v1(AttoXpUiHandleV1 scene,
                                     uint64_t request_id);

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(AttoXpUiHandleV1) == 24, "AttoXp handle ABI width");
_Static_assert(sizeof(AttoXpUiAbiV1) == 16, "AttoXp ABI header width");
_Static_assert(sizeof(AttoXpUiResultV1) == 24, "AttoXp result ABI width");
#endif
#ifdef __cplusplus
}
#endif
#endif
