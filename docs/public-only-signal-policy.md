# Public and user-controlled recommendation signal policy

Recommendation interest inference is enforced at the normalized signal boundary.

## Allowed affinity evidence

Affinity-bearing signals may be created only from:

- explicitly public provider evidence using `public` visibility and `public_web` access;
- ATProto public repository evidence using the matching `atproto_public_repo` visibility and access basis;
- explicit user-owned local evidence using the `app_local`, `local_only`, `owner`, `user_owned`, and `local_only` processing boundary with no server-side processing;
- explicitly authorized user-controlled ActivityPods/Solid Pod evidence using `activitypods`, `acl_controlled`, `solid_acl_control`, `user_owned`, and the `server_allowed` boundary.

The ActivityPods/Solid exception represents remote persistence under the user's authority. It requires control authority, not merely read access, and excludes third-party private data. It does not authorize application-managed servers, provider-controlled stores, private timelines, follower-only posts, followed hashtags, or equivalent provider-private state to become affinity evidence.

Generic consent does not override this project policy. A generic `serverSideDataUses` grant is insufficient unless the normalized evidence also proves the narrow user-controlled Pod boundary above.

Unlisted ActivityPub content is not treated as explicitly public discovery evidence.

## Private moderation and safety evidence

Private evidence may remain usable for local filtering when it is represented as a filtering effect rather than affinity:

- a negative `dismiss`, `hide`, `block`, or `mute` action; or
- a non-positive `moderation_label` signal.

Private filtering effects must remain `local_only` and must not use server-side processing. They may suppress, exclude, or explain candidates, but they cannot increase affinity.

## Enforcement point

`normalizeRecommendationInterestSignal` invokes the shared policy. This makes the invariant apply to direct signal construction, source derivation, label derivation, ledger replay, profile ingestion, and orchestration.

The exported evaluator returns privacy-safe reason codes so applications can test policy decisions without exposing raw source identifiers or user data.
