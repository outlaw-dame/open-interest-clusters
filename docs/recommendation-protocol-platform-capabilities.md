# Recommendation protocol and platform capabilities

This document defines how the recommendation engine distinguishes protocol-level data semantics from application/platform features.

## Why this boundary exists

A protocol does not guarantee every feature implemented by an application built on that protocol.

Examples:

- ActivityPub defines federation primitives, but a generic ActivityPub server does not automatically have every Mastodon account preference or API extension.
- Mastodon adds profile-directory discoverability controls, public-post indexability/noindex signals, featured hashtags, pinned posts, and Mastodon API representations.
- ActivityPods may expose ActivityPub while adding Solid-style user-controlled ACL/resource semantics, without adopting Mastodon extensions or ATProto.
- ATProto repositories are designed for public account records, but application features are defined by app lexicons rather than by the repository format itself.
- Bluesky's `app.bsky.actor.profile` provides free-form profile description text and a pinned-post strong reference, but it must not be treated as if it exposed Mastodon's discoverability/indexability/featured-hashtag controls.
- A different ATProto application can define a different feature set from Bluesky.

The recommendation engine therefore must not infer application capabilities solely from `protocol`.

## Two separate layers

### 1. Protocol/source privacy semantics

Existing source-context code owns protocol-level visibility and authorization semantics.

Current examples include:

- ActivityPub: public, unlisted, followers-only, mentioned-only, mutuals-only, local-only, and unknown source visibility;
- ActivityPods/Solid: public/unlisted resources plus ACL-controlled and local-only resources with user-controlled access evidence;
- ATProto: public repository records versus unknown repository visibility.

These semantics answer questions such as whether data is public, private, user-controlled, or authorized for recommendation processing.

They do **not** answer whether a particular application has a featured-hashtag API or a discoverability switch.

### 2. Platform/profile feature capabilities

`RecommendationProfileFeatureCapabilities` describes the feature surface that the profile adapter actually knows how to observe.

Each feature is one of:

- `supported` — the adapter/platform exposes semantics the engine understands;
- `unsupported` — the adapter/platform is known not to expose that feature;
- `unknown` — support or reliable observation cannot be established.

The current profile capability fields are:

- `rawProfileText`
- `pinnedPosts`
- `discoverabilityControl`
- `indexabilityControl`
- `noindexSignal`
- `featuredHashtags`

Unknown privacy-relevant capability evidence fails closed. Unsupported features are neutral rather than being represented by invented booleans.

## Convenience presets are platform-specific

The package exposes convenience capability declarations for the integrations it directly understands.

### Mastodon

The Mastodon preset declares support for:

- raw profile text;
- pinned posts;
- discoverability controls;
- indexability controls;
- noindex signals;
- featured hashtags.

This preset is **not** a generic ActivityPub preset. A non-Mastodon ActivityPub implementation must declare the capabilities it actually exposes.

### Bluesky

The Bluesky preset declares support for:

- free-form profile description text;
- pinned posts through the `app.bsky.actor.profile` strong reference.

It declares Mastodon-style discoverability, indexability/noindex, and featured hashtags unsupported. The engine therefore does not fabricate `discoverable: true` or `indexable: true` merely to make Bluesky accounts eligible.

This preset is **not** a generic ATProto preset. Other ATProto applications may declare additional or different capabilities.

## Runtime provider and application discovery

Runtime capability discovery must be **client-aware**, not merely server-software-aware.

A recommendation engine can be embedded in a Mastodon client, an ATProto application, or an ActivityPods application even when the remote server is only one part of the integration. Probing a server implementation endpoint may be useful evidence, but it must not be the sole mechanism that determines the application capability profile.

The thin runtime discovery layer should combine bounded evidence from four sources, ordered roughly from strongest to weakest for application identity:

1. explicit application self-declaration supplied by the embedding integration;
2. authenticated or authorization-bound application/client identity;
3. protocol-native application registration or metadata;
4. server/provider capability probing as corroborating evidence.

The engine must keep the **application identity** and the **server/provider identity** as separate values. A Mastodon-compatible app can connect to many Mastodon servers; an ActivityPods app has its own ActivityPub actor and may connect to many Pods; an ATProto client has a client identity distinct from the user's PDS.

### Mastodon applications

For Mastodon integrations, `GET /api/v2/instance` is useful for identifying and negotiating with the server, but it is not sufficient to identify the client application using the recommendation engine.

Mastodon applications register through `POST /api/v1/apps`. The resulting OAuth application has a `client_id`, registered scopes, redirect URIs, name, and optional website. With a valid app or user token, `GET /api/v1/apps/verify_credentials` returns the authenticated `Application` record. Mastodon's OAuth authorization-server metadata can also advertise the application-registration endpoint and supported scopes.

The runtime layer should therefore model at least:

```text
application identity:
  explicit integration ID
  + OAuth client/application identity when available
  + registered scopes / redirect origins as bounded corroboration

server identity:
  origin
  + OAuth authorization-server metadata
  + Mastodon-compatible API capability observations
```

A successful Mastodon-compatible API probe establishes server capabilities, **not** that every embedding client is the Mastodon first-party application. Likewise, an app name or website returned by an OAuth application record is descriptive evidence and must not silently authorize additional recommendation capabilities.

### ATProto and Bluesky applications

ATProto OAuth provides a stronger protocol-native client identity mechanism. Client software is identified by a globally unique `client_id`; for normal deployed clients this is an HTTPS URL whose resource is the public client metadata document. The metadata declares properties such as application type, redirect URIs, grant types, scopes, and optionally client name, client URI, logo, policy, and terms URLs.

The runtime layer should bind ATProto application capability declarations to the exact normalized `client_id` and fetched client-metadata document rather than infer `Bluesky` merely because the user has an ATProto account or because the PDS speaks ATProto.

Security requirements:

- fetch client metadata with the same hardened SSRF, redirect, size, timeout, and content-type protections used elsewhere in the engine;
- require the metadata `client_id` to exactly match the URL used as the client ID where the ATProto profile requires it;
- treat descriptive branding fields as untrusted unless the integration has an independent trust binding;
- never use requested OAuth scopes as positive interest evidence;
- use scopes only for authorization/capability gating.

This supports Bluesky and non-Bluesky ATProto applications without making `ATProto == Bluesky` an architectural assumption.

### ActivityPods applications

ActivityPods exposes an application-native discovery path that is stronger than probing a Pod server alone.

ActivityPods applications are ActivityPub actors. ActivityPods documents FEP-2677 support for finding the actor linked with an application. Application installation/authorization then uses ActivityPub plus Solid Application Interoperability concepts: applications declare `AccessNeedGroups` / `AccessNeeds`, the Pod creates `AccessGrants` / `DataGrants` and an `ApplicationRegistration`, and registration lifecycle changes are communicated with ActivityPub `Create`, `Update`, and `Delete` activities.

The runtime layer should therefore preserve:

```text
application actor identity
  + ApplicationRegistration identity
  + declared AccessNeeds
  + currently valid grants
  + Pod/provider identity
```

These are separate pieces of evidence. The application actor identifies the app; the registration and grants determine what the user explicitly authorized; the Pod/provider determines storage and transport behavior. None of them should be collapsed into a generic `ActivityPub server detected` flag.

This is also important for the user-controlled-storage rule: recommendation state may be stored remotely in an ActivityPod only when the current application registration/grant authorizes that user-controlled storage operation. The existence of ActivityPods-compatible endpoints alone is insufficient authority.

### Discovery precedence and conflicts

The eventual runtime resolver should not blindly choose one detector. It should normalize all observations into a bounded evidence set and resolve them with explicit precedence.

Recommended rules:

- authenticated registration/client identity outranks unauthenticated server fingerprinting;
- an explicit integration declaration must be validated against protocol-native evidence when such evidence is available;
- server probes can add server capabilities but cannot silently rewrite application identity;
- conflicting high-confidence identity evidence fails closed instead of choosing whichever detector ran last;
- unknown privacy-relevant application capabilities remain `unknown` and fail closed at the policy boundary;
- capability cache entries must be scoped by the correct authority key: application/client identity for app features, server/provider identity for server features, and application-registration/user grant identity for ActivityPods authorization.

This separation prevents a future runtime discovery layer from accidentally treating one Mastodon instance probe, one PDS, or one Pod host as authoritative for every client application that connects to it.

## Raw profile text and hashtags

Raw profile text is processed independently of whether the application linkifies hashtags or exposes structured tag objects.

The profile signal path:

1. converts profile markup to normalized plain text where necessary;
2. scans plain text for explicit opt-out language;
3. scans both hash-prefixed and plain opt-out tokens such as `#NoAI`, `#NoRecommendations`, and `NoAI`;
4. checks bounded structured profile tags for safety/opt-out tokens without using those tags as positive affinity;
5. matches allowed interest keywords against the same normalized raw text;
6. expands explicit compound hashtag boundaries conservatively for exact phrase matching;
7. optionally inspects platform-native featured hashtags only when that capability is declared supported.

This means a Bluesky description such as `Climate researcher #Climate #ActivityPub` can provide public topical evidence even though those hashtags are not Mastodon featured-tag objects. A description containing `#NoAI` or `#NoRecommendations` fails closed before emitting profile-derived interest evidence.

Linkification is presentation behavior, not a prerequisite for semantic extraction.

### Compound hashtags

Compound hashtag expansion is deterministic and intentionally conservative.

The shared `hashtagPhraseVariants` helper always retains the compact canonical hashtag identity and may add phrase variants only when word boundaries are explicitly encoded by:

- Unicode compatibility normalization;
- separators such as `_` or `-`;
- lower-case to upper-case transitions;
- acronym-to-word case transitions.

Examples:

```text
#OpenSource       -> opensource + "open source"
#BlackLivesMatter -> blacklivesmatter + "black lives matter"
#Open_Source      -> open_source + "open source"
#OpenAIResearch   -> openairesearch + "open airesearch" + "open ai research"
#OAuthSecurity    -> oauthsecurity + "oauth security" + "o auth security"
```

The engine preserves multiple plausible casing-derived alternatives rather than declaring one ambiguous acronym split authoritative. Matching still requires an **exact allowed interest phrase** to equal one of these variants.

It does **not** perform dictionary-based segmentation of all-lowercase compounds. For example, `#opensource` remains only `opensource`; it does not automatically become `open source`. This avoids silently inventing semantic boundaries and creating broad false-positive interests.

Expansion is used for matching only. It does not rewrite canonical hashtag identity, candidate deduplication identity, or provenance.

Likewise, partial substrings are not promoted. `#OpenSourceSecurity` may produce the full phrase `open source security`, but does not by itself match standalone `source`, `security`, or `open source` interest keywords.

## Pinned posts

Pinned-post support is also capability-based.

- Mastodon integrations may provide the bounded public pinned-post collection expected by the Mastodon adapter path.
- Bluesky integrations may provide the post identified by the profile's `pinnedPost` strong reference; the URI and CID must match that reference.
- A provider that declares pinned posts unsupported must not smuggle pinned-post data into this path.
- Unknown pinned-post support fails closed because otherwise opt-out text in an unobserved pinned item could be missed.

## Account controls

Platform-specific account controls are policy evidence, never affinity features.

When a capability is supported, its restrictive state is respected. For example:

- Mastodon `discoverable: false` blocks profile-derived recommendation evidence;
- Mastodon `indexable: false` blocks it;
- an observed `noindex: true` blocks it;
- a featured opt-out hashtag blocks it;
- a bounded structured profile tag carrying an opt-out token blocks it.

When a capability is explicitly unsupported, the engine does not invent a corresponding positive value. For example, Bluesky does not need fictitious `discoverable: true` or `indexable: true` values.

These controls and structured safety tags must never be converted into positive user-interest signals, recommendation boosts, or public explanation text.

## ActivityPods and extensions

ActivityPods remains independent of ATProto adoption.

An ActivityPods provider can:

- expose ActivityPub as its social protocol;
- use Solid/ActivityPods ACL and user-owned storage semantics for private/user-controlled resources;
- declare only the profile/application capabilities it actually implements;
- omit ATProto entirely;
- optionally add future application-specific capabilities without changing the generic recommendation core.

Protocol account links or projections must not override the authoritative ACL/storage/privacy boundary.

## Adapter rule

Provider adapters are responsible for canonicalizing platform-specific observations into these generic capability and policy contracts.

The generic engine must not contain logic equivalent to:

```text
if protocol == activitypub then MastodonFeature = true
if protocol == atproto then BlueskyFeature = true
```

Instead, the flow is:

```text
protocol/source context
  + application/client identity
  + provider/server identity
  + provider/application adapter
  + user-scoped authorization/grant evidence where applicable
  -> declared and verified feature capabilities
  -> observed platform controls/public profile text
  -> privacy-safe eligibility decision
  -> profile-derived interest evidence
```

That keeps the engine usable across Mastodon, other ActivityPub software, ActivityPods providers, Bluesky, other ATProto applications, and future adapters without weakening privacy or inventing nonexistent platform semantics.
