import {
  RECOMMENDATION_ACCESS_BASES,
  type RecommendationAccessBasis,
  type RecommendationSourceVisibility
} from "./consent.js";
import type { RecommendationSourceContext } from "./source-adapter.js";

export const RECOMMENDATION_ACTIVITYPUB_VISIBILITIES = [
  "public",
  "unlisted",
  "private",
  "followers_only",
  "direct",
  "mentioned_only",
  "mutuals_only",
  "local_only",
  "unknown"
] as const;

export type RecommendationActivityPubVisibility = typeof RECOMMENDATION_ACTIVITYPUB_VISIBILITIES[number];

export const RECOMMENDATION_ACTIVITYPODS_RESOURCE_SCOPES = [
  "public",
  "unlisted",
  "acl_controlled",
  "local_only",
  "unknown"
] as const;

export type RecommendationActivityPodsResourceScope = typeof RECOMMENDATION_ACTIVITYPODS_RESOURCE_SCOPES[number];

export const RECOMMENDATION_SOLID_ACCESS_MODES = ["read", "append", "write", "control", "none", "unknown"] as const;

export type RecommendationSolidAccessMode = typeof RECOMMENDATION_SOLID_ACCESS_MODES[number];

export const RECOMMENDATION_ATPROTO_REPOSITORY_VISIBILITIES = ["public_repo", "unknown"] as const;

export type RecommendationAtprotoRepositoryVisibility = typeof RECOMMENDATION_ATPROTO_REPOSITORY_VISIBILITIES[number];

export interface RecommendationActivityPubSourceContextInput {
  visibility: RecommendationActivityPubVisibility;
  accessBasis?: RecommendationAccessBasis;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationActivityPodsSourceContextInput {
  resourceScope: RecommendationActivityPodsResourceScope;
  solidAccessMode?: RecommendationSolidAccessMode;
  isOwner?: boolean;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationAtprotoSourceContextInput {
  repositoryVisibility: RecommendationAtprotoRepositoryVisibility;
  accessBasis?: RecommendationAccessBasis;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

const ACTIVITYPUB_VISIBILITY_SET = new Set<string>(RECOMMENDATION_ACTIVITYPUB_VISIBILITIES);
const ACTIVITYPODS_SCOPE_SET = new Set<string>(RECOMMENDATION_ACTIVITYPODS_RESOURCE_SCOPES);
const SOLID_ACCESS_MODE_SET = new Set<string>(RECOMMENDATION_SOLID_ACCESS_MODES);
const ATPROTO_REPOSITORY_VISIBILITY_SET = new Set<string>(RECOMMENDATION_ATPROTO_REPOSITORY_VISIBILITIES);
const ACCESS_BASIS_SET = new Set<string>(RECOMMENDATION_ACCESS_BASES);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function hasString(set: ReadonlySet<string>, value: unknown): value is string {
  return typeof value === "string" && set.has(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalAccessBasis(value: unknown): value is RecommendationAccessBasis | undefined {
  return value === undefined || hasString(ACCESS_BASIS_SET, value);
}

function isOptionalSolidAccessMode(value: unknown): value is RecommendationSolidAccessMode | undefined {
  return value === undefined || hasString(SOLID_ACCESS_MODE_SET, value);
}

function withOptionalFlags(
  context: RecommendationSourceContext,
  input: {
    containsThirdPartyData?: boolean;
    serverSideProcessing?: boolean;
    providerPolicyAllowsProcessing?: boolean;
  }
): RecommendationSourceContext {
  const next: RecommendationSourceContext = { ...context };

  if (input.containsThirdPartyData !== undefined) {
    next.containsThirdPartyData = input.containsThirdPartyData;
  }

  if (input.serverSideProcessing !== undefined) {
    next.serverSideProcessing = input.serverSideProcessing;
  }

  if (input.providerPolicyAllowsProcessing !== undefined) {
    next.providerPolicyAllowsProcessing = input.providerPolicyAllowsProcessing;
  }

  return Object.freeze(next);
}

function activityPubSourceVisibility(visibility: RecommendationActivityPubVisibility): RecommendationSourceVisibility {
  switch (visibility) {
    case "public":
      return "public";
    case "unlisted":
      return "unlisted";
    case "private":
    case "followers_only":
      return "followers_only";
    case "direct":
    case "mentioned_only":
      return "mentioned_only";
    case "mutuals_only":
      return "mutuals_only";
    case "local_only":
      return "local_only";
    case "unknown":
      return "unknown";
  }
}

function defaultActivityPubAccessBasis(visibility: RecommendationActivityPubVisibility): RecommendationAccessBasis {
  switch (visibility) {
    case "public":
    case "unlisted":
      return "public_web";
    case "private":
    case "followers_only":
      return "follower_relationship";
    case "direct":
    case "mentioned_only":
      return "mentioned_recipient";
    case "mutuals_only":
      return "mutual_relationship";
    case "local_only":
      return "provider_policy";
    case "unknown":
      return "unknown";
  }
}

function isPrivateSourceVisibility(visibility: RecommendationSourceVisibility): boolean {
  return (
    visibility === "followers_only" ||
    visibility === "mentioned_only" ||
    visibility === "mutuals_only" ||
    visibility === "local_only" ||
    visibility === "acl_controlled"
  );
}

export function createActivityPubSourceContext(input: RecommendationActivityPubSourceContextInput): RecommendationSourceContext {
  if (
    !isObject(input) ||
    !hasString(ACTIVITYPUB_VISIBILITY_SET, input.visibility) ||
    !isOptionalAccessBasis(input.accessBasis) ||
    !isOptionalBoolean(input.containsThirdPartyData) ||
    !isOptionalBoolean(input.serverSideProcessing) ||
    !isOptionalBoolean(input.providerPolicyAllowsProcessing)
  ) {
    throw new TypeError("Invalid ActivityPub recommendation source context input.");
  }

  const sourceVisibility = activityPubSourceVisibility(input.visibility);
  return withOptionalFlags(
    {
      protocol: "activitypub",
      sourceVisibility,
      accessBasis: input.accessBasis ?? defaultActivityPubAccessBasis(input.visibility),
      containsPrivateData: isPrivateSourceVisibility(sourceVisibility)
    },
    input
  );
}

function activityPodsSourceVisibility(scope: RecommendationActivityPodsResourceScope): RecommendationSourceVisibility {
  switch (scope) {
    case "public":
      return "public";
    case "unlisted":
      return "unlisted";
    case "acl_controlled":
      return "acl_controlled";
    case "local_only":
      return "local_only";
    case "unknown":
      return "unknown";
  }
}

function activityPodsAccessBasis(input: RecommendationActivityPodsSourceContextInput): RecommendationAccessBasis {
  if (input.isOwner === true) {
    return "owner";
  }

  if (input.resourceScope === "public" || input.resourceScope === "unlisted") {
    return "public_web";
  }

  if (input.resourceScope === "local_only") {
    return "provider_policy";
  }

  if (input.resourceScope === "acl_controlled") {
    if (input.solidAccessMode === "control") {
      return "solid_acl_control";
    }

    if (input.solidAccessMode === "read") {
      return "solid_acl_read";
    }
  }

  return "unknown";
}

export function createActivityPodsSourceContext(input: RecommendationActivityPodsSourceContextInput): RecommendationSourceContext {
  if (
    !isObject(input) ||
    !hasString(ACTIVITYPODS_SCOPE_SET, input.resourceScope) ||
    !isOptionalSolidAccessMode(input.solidAccessMode) ||
    !isOptionalBoolean(input.isOwner) ||
    !isOptionalBoolean(input.containsThirdPartyData) ||
    !isOptionalBoolean(input.serverSideProcessing) ||
    !isOptionalBoolean(input.providerPolicyAllowsProcessing)
  ) {
    throw new TypeError("Invalid ActivityPods recommendation source context input.");
  }

  const sourceVisibility = activityPodsSourceVisibility(input.resourceScope);
  return withOptionalFlags(
    {
      protocol: "activitypods",
      sourceVisibility,
      accessBasis: activityPodsAccessBasis(input),
      containsPrivateData: isPrivateSourceVisibility(sourceVisibility)
    },
    input
  );
}

function defaultAtprotoAccessBasis(sourceVisibility: RecommendationSourceVisibility): RecommendationAccessBasis {
  return sourceVisibility === "atproto_public_repo" ? "atproto_public_repo" : "unknown";
}

export function createAtprotoSourceContext(input: RecommendationAtprotoSourceContextInput): RecommendationSourceContext {
  if (
    !isObject(input) ||
    !hasString(ATPROTO_REPOSITORY_VISIBILITY_SET, input.repositoryVisibility) ||
    !isOptionalAccessBasis(input.accessBasis) ||
    !isOptionalBoolean(input.containsThirdPartyData) ||
    !isOptionalBoolean(input.serverSideProcessing) ||
    !isOptionalBoolean(input.providerPolicyAllowsProcessing)
  ) {
    throw new TypeError("Invalid ATProto recommendation source context input.");
  }

  const sourceVisibility: RecommendationSourceVisibility =
    input.repositoryVisibility === "public_repo" ? "atproto_public_repo" : "unknown";

  return withOptionalFlags(
    {
      protocol: "atproto",
      sourceVisibility,
      accessBasis: input.accessBasis ?? defaultAtprotoAccessBasis(sourceVisibility),
      containsPrivateData: false
    },
    input
  );
}
