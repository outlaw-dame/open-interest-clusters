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
2. `user_owned` storage with the `server_allowed` manifest boundary, such as a correctly authorized ActivityPod, Solid Pod, private ATProto space on the user's own PDS, or equivalent user-controlled remote store. A server runs the store, but it is the user's server.

Any other pairing is refused: a device store cannot claim `server_allowed`, and a user-owned store cannot claim `local_only`. Writing a profile to a pod labels its interests `server_allowed`, and moving it between the device and a pod relabels it. Candidate events carry no label of their own, so only their store's manifest placement applies.

`provider_owned` application, instance, AppView, and service-operator storage is not eligible for subject-level recommendation state.

`shared_operator` storage is limited to non-subject `aggregate_statistics` under the `aggregate_only` boundary.

### User-owned remote stores

| Store | Status |
| --- | --- |
| ActivityPods pod | Supported. The library ships a manifest and a grant-bound adapter. |
| Solid pod | Supported as a placement. The library has no Solid adapter; you supply one and declare it `user_owned` with `server_allowed`. |
| Private ATProto space on the user's own PDS | Allowed as a placement, with the conditions below. The library has no spaces adapter; you supply one and declare it `user_owned` with `server_allowed`. |
| Public ATProto repo (the PDS's normal repo records) | **Never allowed** for subject-level interests. |

**Private space.** An ATProto space is a permissioned store on the user's PDS. Access is controlled by a space authority, which is a DID and can be the user's own account, and records live in per-space permissioned repos on the author's PDS. A space on the user's own PDS with the user's DID as the authority is treated like a pod: `user_owned` with `server_allowed`, kept with the user's explicit server-side consent, on a host the user chose. Interests in it are labelled `server_allowed`. The code side is the `atproto_private_space` preference storage target, evidence with source visibility `atproto_private_space` and access basis `atproto_space_authority`, and the same signal policy rule that accepts pod evidence.

What this does not give you:

- Spaces give access control, not confidentiality. The ATProto team says so directly: data in a space is not encrypted and is readable by any user or application with access to it. The PDS host can read it, and so can every app the user lets in. That is the same position as a pod on a host you do not run.
- Spaces were an alpha at the time of writing, with breaking changes and no production use advised. A public beta was announced for December 1. Check the current state before you rely on them.
- The library ships no spaces adapter and does not verify what an adapter writes or where. The rule is the adapter's responsibility. A manifest is a declaration, and an adapter that declares `user_owned` and then writes to a public repo would pass the manifest check.

**Public repo.** An ATProto repository is, in the protocol's own words, a collection of data published by a single user ([atproto.com/guides/data-repos](https://atproto.com/guides/data-repos)). Repos are self-authenticating and anyone can read them, so writing private interests into one would publish them. Nothing in the library accepts it: there is no preference storage target for a repo, and the signal policy does not accept `atproto_public_repo` evidence as a placement for private interests. The library cannot see where an adapter writes, so as a second check a manifest can declare `publiclyReadable: true`, which is refused for subject-level state (next section). A bare "PDS" is not a placement either. Declare a store that writes to a private space as above, and never declare a repo-backed store as `user_owned`.

ATProto is still the source of public data (labels, public repos). Only a private space is a place for the user's own interests.

### Declaring that a store is not publicly readable

The manifest has an optional `publiclyReadable` boolean. A remote user-owned store sets it to `true` when anyone can read it without the user's permission. If it is `true`, the store is refused for every subject-level domain on every path that checks the manifest: profile reads and writes, the candidate event store, and the profile move (both locations, and both event stores). The refusal reason is `state.deny.publicly_readable_store`. A value that is not a boolean is rejected. If the field is absent, nothing changes, so existing manifests keep working.

The library cannot verify the field. It catches an integrator who declares a public store, not one who leaves the field out or declares `false` for a store that is public. Treat `publiclyReadable: false` as your statement and check the adapter in review.

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
