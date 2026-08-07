# Local-first recommendation state placement

The recommendation engine is an inference library, not the owner of an adopter's user database. Applications, servers, and user-controlled data stores provide persistence through adapters. The engine defines and enforces placement policy without selecting a database, transport, cloud, application framework, or deployment topology.

## Separation of powers

- Applications and platforms own accounts, authentication, sessions, user interfaces, scheduling, synchronization, and their local database lifecycle.
- The recommendation engine owns normalization, consent evaluation, semantic derivation, signal identity, profile application, retrieval, scoring, explanations, and policy validation.
- Storage adapters own persistence mechanics. An adapter must declare its authority, processing boundary, persistence behavior, offline characteristics, deletion support, and export support.
- A storage location is not trusted merely because it is remote, encrypted, or called a server. Authority is evaluated independently from location.

## State domains

Recommendation state is partitioned into independently placeable domains:

- `interest_profile`
- `seen_history`
- `dismissal_history`
- `feedback_history`
- `bandit_state`
- `label_evidence`
- `profile_embedding`
- `candidate_cache`
- `explanation_cache`
- `aggregate_statistics`

This prevents an adopter from treating all recommendation data as one generic profile blob. A deployment may keep preference state in IndexedDB, rebuildable embeddings in a separate local cache, and optional aggregate statistics in non-subject shared infrastructure.

## Allowed authority boundaries

Subject-level recommendation state may be placed only in:

1. `device_owned` storage using the `local_only` processing boundary; or
2. `user_owned` storage using the `server_allowed` processing boundary, such as a correctly authorized ActivityPod, Solid Pod, or equivalent user-controlled remote store.

`provider_owned` application, instance, AppView, and service-operator storage is not eligible for subject-level recommendation state.

`shared_operator` storage is limited to non-subject `aggregate_statistics` under the `aggregate_only` boundary.

## Local-first adapter requirements

A `device_owned` adapter must:

- require no network connection;
- support offline operation;
- permit deletion of persistent personal state;
- permit export of persistent preference and evidence state.

These requirements make local-first behavior an executable contract rather than a documentation preference.

## User-controlled remote storage

A `user_owned` adapter may require a network, but it must still preserve the user's authority. The storage-authority layer remains responsible for proving that authority—for example through ActivityPods/Solid ACL control and owner-bound provenance. Generic server consent does not convert provider-owned storage into user-owned storage.

Persistent personal state must remain user-deletable. Persistent preference and evidence state must remain user-exportable.

## Ephemeral and rebuildable state

The policy distinguishes persistence from authority. Ephemeral state still must satisfy its authority boundary. Rebuildable artifacts such as embeddings and caches do not require export, but persistent copies must remain deletable.

## Adapter manifests

Integrators declare storage behavior with `RecommendationStateStorageAdapterManifest` and validate it through:

- `normalizeRecommendationStateStorageAdapterManifest`
- `evaluateRecommendationStatePlacement`
- `evaluateRecommendationStateStorageManifest`
- `assertRecommendationStateStorageManifest`

A manifest fails closed when any declared domain violates policy. The engine does not instantiate the adapter or infer capabilities from a product name.

## Privacy invariant

Complete personalization must remain possible without transmitting subject-level recommendation state to application-controlled infrastructure. Remote personalization persistence is an explicit exception only for storage controlled by the user.
