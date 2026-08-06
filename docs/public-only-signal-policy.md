# Public and user-controlled recommendation signal policy

Recommendation interest inference is enforced at the normalized signal boundary.

## Storage authority, not storage location

The engine distinguishes **where processing occurs** from **who controls persisted recommendation state**.

The legacy `privacyBoundary` values remain supported as processing-location and disclosure boundaries:

- `local_only`: processing and subject-level state remain on the current device;
- `server_allowed`: remote processing or persistence is technically possible;
- `aggregate_only`: only aggregate, non-subject-level state is permitted.

`server_allowed` is not itself permission to persist user preference state. Authority is evaluated separately:

- `device_owned`: state controlled by the user's current device;
- `user_owned`: remote state controlled by the user, such as an ActivityPod or Solid Pod;
- `provider_owned`: state controlled by the application, server, AppView, instance, or service operator;
- `shared_operator`: aggregate infrastructure controlled by one or more operators rather than an individual user.

Legacy records without explicit authority are interpreted fail closed: `local_only` maps to `device_owned`, `server_allowed` maps to `provider_owned`, and `aggregate_only` maps to `shared_operator`. A narrowly verified ActivityPods/Solid control path is recognized as `user_owned`.

## Allowed affinity evidence

Affinity-bearing signals may be created only from:

- explicitly public provider evidence using `public` visibility and `public_web` access;
- ATProto public repository evidence using the matching `atproto_public_repo` visibility and access basis;
- explicit user-owned local evidence using the `app_local`, `local_only`, `owner`, `user_owned`, and device-owned processing boundary with no server-side processing;
- explicitly authorized user-controlled ActivityPods/Solid Pod evidence using `activitypods`, `acl_controlled`, `solid_acl_control`, `user_owned`, and remote processing under the user's storage authority.

The ActivityPods/Solid exception represents remote persistence under the user's authority. It requires control authority, not merely read access, and excludes third-party private data. It does not authorize application-managed servers, provider-controlled stores, private timelines, follower-only posts, followed hashtags, or equivalent provider-private state to become affinity evidence.

Generic consent does not override this project policy. A generic `serverSideDataUses` grant is insufficient unless the normalized evidence also proves the narrow user-controlled Pod boundary above.

Even when source posts or account metadata are public, a derived per-user profile remains personal recommendation state. Public source visibility does not authorize provider-owned persistence of the inferred profile.

Unlisted ActivityPub content is not treated as explicitly public discovery evidence.

## Private moderation and safety evidence

Private evidence may remain usable for device-owned local filtering when it is represented as a filtering effect rather than affinity:

- a negative `dismiss`, `hide`, `block`, or `mute` action; or
- a non-positive `moderation_label` signal.

Private filtering effects must remain `local_only`, resolve to `device_owned`, and must not use server-side processing. They may suppress, exclude, or explain candidates, but they cannot increase affinity.

## Enforcement point

`normalizeRecommendationInterestSignal` invokes the shared policy. The policy resolves and evaluates storage authority before permitting affinity, so the invariant applies to direct signal construction, source derivation, label derivation, ledger replay, profile ingestion, and orchestration.

The exported authority and signal evaluators return privacy-safe reason codes so applications can test policy decisions without exposing raw source identifiers or user data.
