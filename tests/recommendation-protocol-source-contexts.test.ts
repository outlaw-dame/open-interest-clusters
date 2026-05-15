import test from "node:test";
import assert from "node:assert/strict";

import {
  createActivityPodsSourceContext,
  createActivityPubSourceContext,
  createAtprotoSourceContext
} from "../src/index.js";

test("ActivityPub context maps public and unlisted visibility without marking private data", () => {
  const publicContext = createActivityPubSourceContext({ visibility: "public" });
  const unlistedContext = createActivityPubSourceContext({ visibility: "unlisted", serverSideProcessing: true });

  assert.deepEqual(publicContext, {
    protocol: "activitypub",
    sourceVisibility: "public",
    accessBasis: "public_web",
    containsPrivateData: false
  });
  assert.deepEqual(unlistedContext, {
    protocol: "activitypub",
    sourceVisibility: "unlisted",
    accessBasis: "public_web",
    containsPrivateData: false,
    serverSideProcessing: true
  });
  assert.equal(Object.isFrozen(publicContext), true);
});

test("ActivityPub context maps private, direct, mutuals, and local-only scopes", () => {
  assert.deepEqual(createActivityPubSourceContext({ visibility: "private" }), {
    protocol: "activitypub",
    sourceVisibility: "followers_only",
    accessBasis: "follower_relationship",
    containsPrivateData: true
  });
  assert.deepEqual(createActivityPubSourceContext({ visibility: "direct" }), {
    protocol: "activitypub",
    sourceVisibility: "mentioned_only",
    accessBasis: "mentioned_recipient",
    containsPrivateData: true
  });
  assert.deepEqual(createActivityPubSourceContext({ visibility: "mutuals_only" }), {
    protocol: "activitypub",
    sourceVisibility: "mutuals_only",
    accessBasis: "mutual_relationship",
    containsPrivateData: true
  });
  assert.deepEqual(createActivityPubSourceContext({ visibility: "local_only" }), {
    protocol: "activitypub",
    sourceVisibility: "local_only",
    accessBasis: "provider_policy",
    containsPrivateData: true
  });
});

test("ActivityPub context rejects malformed booleans and unknown visibility", () => {
  assert.throws(() => createActivityPubSourceContext({ visibility: "bad" as never }), TypeError);
  assert.throws(
    () => createActivityPubSourceContext({ visibility: "public", serverSideProcessing: "true" as never }),
    TypeError
  );
});

test("ActivityPods context maps Solid ACL read and control access", () => {
  assert.deepEqual(createActivityPodsSourceContext({ resourceScope: "acl_controlled", solidAccessMode: "read" }), {
    protocol: "activitypods",
    sourceVisibility: "acl_controlled",
    accessBasis: "solid_acl_read",
    containsPrivateData: true
  });
  assert.deepEqual(createActivityPodsSourceContext({ resourceScope: "acl_controlled", solidAccessMode: "control" }), {
    protocol: "activitypods",
    sourceVisibility: "acl_controlled",
    accessBasis: "solid_acl_control",
    containsPrivateData: true
  });
  assert.deepEqual(createActivityPodsSourceContext({ resourceScope: "acl_controlled", isOwner: true }), {
    protocol: "activitypods",
    sourceVisibility: "acl_controlled",
    accessBasis: "owner",
    containsPrivateData: true
  });
});

test("ActivityPods context fails closed when ACL access is not read/control/owner", () => {
  assert.deepEqual(createActivityPodsSourceContext({ resourceScope: "acl_controlled", solidAccessMode: "write" }), {
    protocol: "activitypods",
    sourceVisibility: "acl_controlled",
    accessBasis: "unknown",
    containsPrivateData: true
  });
  assert.throws(
    () => createActivityPodsSourceContext({ resourceScope: "acl_controlled", isOwner: "true" as never }),
    TypeError
  );
});

test("ATProto context treats repositories as public repo visibility while preserving consent requirement", () => {
  const context = createAtprotoSourceContext({
    repositoryVisibility: "public_repo",
    containsThirdPartyData: true,
    providerPolicyAllowsProcessing: false
  });

  assert.deepEqual(context, {
    protocol: "atproto",
    sourceVisibility: "atproto_public_repo",
    accessBasis: "atproto_public_repo",
    containsPrivateData: false,
    containsThirdPartyData: true,
    providerPolicyAllowsProcessing: false
  });
});

test("ATProto unknown repository visibility fails closed", () => {
  assert.deepEqual(createAtprotoSourceContext({ repositoryVisibility: "unknown" }), {
    protocol: "atproto",
    sourceVisibility: "unknown",
    accessBasis: "unknown",
    containsPrivateData: false
  });
  assert.throws(() => createAtprotoSourceContext({ repositoryVisibility: "private" as never }), TypeError);
});
