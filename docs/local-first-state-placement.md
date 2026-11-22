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

The manifest's `processingBoundary` says where the store runs, and the interests in it carry the matching label: `local_only` on the device, `server_allowed` in a user-owned server store (see [`privacy-model.md`](privacy-model.md)). A user-controlled server is still a server, so keeping interests there needs the user's server-side consent. Missing, revoked, deleted or mismatched consent refuses the write.

Subject-level recommendation state may be placed only in:

1. `device_owned` storage with the `local_only` manifest boundary. The store runs on the device; or
2. `user_owned` storage with the `server_allowed` manifest boundary, such as a correctly authorized ActivityPod, Solid Pod, or equivalent user-controlled remote store. A server runs the store, but it is the user's server.

Any other pairing is refused: a device store cannot claim `server_allowed`, and a user-owned store cannot claim `local_only`. Writing a profile to a pod labels its interests `server_allowed`, and moving it between the device and a pod relabels it. Candidate events carry no label of their own, so only their store's manifest placement applies.

`provider_owned` application, instance, AppView, and service-operator storage is not eligible for subject-level recommendation state.

`shared_operator` storage is limited to non-subject `aggregate_statistics` under the `aggregate_only` boundary.

### User-owned remote stores

| Store | Status |
| --- | --- |
| ActivityPods pod | Supported. The library ships a manifest and a grant-bound adapter. |
| Solid pod | Supported as a placement. The library has no Solid adapter; you supply one and declare it `user_owned` with `server_allowed`. |
| User's ATProto PDS | **Not an allowed placement.** |

An ATProto repository is, in the protocol's own words, a collection of data published by a single user ([atproto.com/guides/data-repos](https://atproto.com/guides/data-repos)). Repos are self-authenticating and anyone can verify them, so writing private interests into one would publish them. The PDS host can also read repo contents. The manifest is a declaration by the integrator, and the library does not inspect the store behind it. Its authority values are `device_owned`, `user_owned`, `provider_owned` and `shared_operator`, and none of them names a PDS. Any other value is rejected, but a PDS adapter declared as `user_owned` would pass the manifest check, so this rule is documentation plus review, not something the code can detect. Integrators must not declare a PDS as `user_owned`.

A PDS could become acceptable for subject-level interests only if the content is encrypted on the client with keys the user holds, so the host and the public see ciphertext, or if the protocol gains private, permissioned storage that has been verified to exist. This was not checked against newer AT Protocol work, so any private-data feature that has shipped since is unconfirmed. Until then ATProto is a source of public data (labels, public repos), not a place for the user's interests.

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
