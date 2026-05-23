import { domainToASCII } from "node:url";

import { normalizeHashtag } from "../normalization/hashtags.js";
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function noTag(suffix: string): string {
  return `no${suffix}`;
}

export const RECOMMENDATION_FEDIVERSE_DEFAULT_OPT_OUT_TAGS = Object.freeze([
  noTag("ai"),
  noTag("index"),
  noTag("indexing"),
  noTag("indexers"),
  noTag("search"),
  noTag("bot"),
  noTag("bots"),
  noTag("archive"),
  noTag("crawl"),
  noTag("crawling"),
  noTag("scrape"),
  noTag("scraping"),
  noTag("llm"),
  noTag("llms"),
  "robotxt"
]);

export type RecommendationFediverseInstancePolicyProvider = "oliphant" | "custom";
export type RecommendationFediverseInstancePolicyTier = "tier0" | "tier1";
export type RecommendationFediverseEligibilityReason =
  | "eligible"
  | "excluded.account_discoverable_false"
  | "excluded.account_indexable_false"
  | "excluded.account_noindex_true"
  | "excluded.account_locked"
  | "excluded.account_moved"
  | "excluded.account_suspended"
  | "excluded.account_limited"
  | "excluded.account_bot_not_allowed"
  | "excluded.account_group_not_allowed"
  | "excluded.account_opt_out_tag"
  | "excluded.instance_policy.oliphant_tier0"
  | "excluded.instance_policy.oliphant_tier1"
  | "excluded.instance_policy.custom"
  | "excluded.viewer_blocked_account"
  | "excluded.viewer_muted_account"
  | "excluded.viewer_blocked_domain"
  | "excluded.provider_policy";

export interface RecommendationFediverseAccountEligibilityInput {
  actorUri?: string;
  acct?: string;
  domain?: string;
  discoverable?: boolean | null;
  indexable?: boolean | null;
  noindex?: boolean | null;
  locked?: boolean | null;
  moved?: boolean | null;
  suspended?: boolean | null;
  limited?: boolean | null;
  bot?: boolean | null;
  group?: boolean | null;
  profileTags?: readonly string[];
  featuredTags?: readonly string[];
}

export interface RecommendationFediverseInstancePolicyMatchInput {
  provider: RecommendationFediverseInstancePolicyProvider;
  tier?: RecommendationFediverseInstancePolicyTier;
}

export interface RecommendationFediverseInstanceEligibilityInput {
  domain: string;
  policyMatches?: readonly RecommendationFediverseInstancePolicyMatchInput[];
}

export interface RecommendationFediverseViewerControlsInput {
  blockedAccounts?: readonly string[];
  mutedAccounts?: readonly string[];
  blockedDomains?: readonly string[];
}

export interface RecommendationFediverseEligibilityPolicyInput {
  providerAllowsRecommendation?: boolean;
  requireDiscoverable?: boolean;
  requireIndexable?: boolean;
  respectNoindex?: boolean;
  respectOptOutTags?: boolean;
  optOutTags?: readonly string[];
  allowLockedAccounts?: boolean;
  allowMovedAccounts?: boolean;
  allowSuspendedAccounts?: boolean;
  allowLimitedAccounts?: boolean;
  allowBots?: boolean;
  allowGroups?: boolean;
}

export interface RecommendationFediverseEligibilityInput {
  account?: RecommendationFediverseAccountEligibilityInput;
  instance?: RecommendationFediverseInstanceEligibilityInput;
  viewerControls?: RecommendationFediverseViewerControlsInput;
  policy?: RecommendationFediverseEligibilityPolicyInput;
}

export interface RecommendationFediverseEligibilityResult {
  eligible: boolean;
  reason: RecommendationFediverseEligibilityReason;
  matchedOptOutTagCount: number;
  normalizedAccountDomain?: string;
  normalizedInstanceDomain?: string;
}

interface NormalizedFediverseAccountIdentity {
  readonly actorUri?: string;
  readonly acct?: string;
  readonly domain?: string;
}

interface NormalizedFediverseInstance {
  readonly domain: string;
  readonly policyMatches: readonly RecommendationFediverseInstancePolicyMatchInput[];
}

const FEDIVERSE_DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const FEDIVERSE_MAX_DOMAIN_LENGTH = 253;
const FEDIVERSE_MAX_IDENTITY_LENGTH = 2048;

function optionalString(value: unknown, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(message);
  return value;
}

function optionalBooleanValue(value: unknown, message: string): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(message);
  return value;
}

function stringList(value: unknown, message: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new TypeError(message);
  return Object.freeze([...value]);
}

function normalizeFediverseDomain(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > FEDIVERSE_MAX_DOMAIN_LENGTH || /\s/u.test(trimmed)) throw new TypeError("Invalid Fediverse recommendation domain.");
  if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes("?") || trimmed.includes("#") || trimmed.includes("@")) throw new TypeError("Invalid Fediverse recommendation domain.");
  const ascii = domainToASCII(trimmed).toLocaleLowerCase("en-US");
  if (ascii.length === 0 || ascii.length > FEDIVERSE_MAX_DOMAIN_LENGTH || ascii.startsWith(".") || ascii.endsWith(".")) throw new TypeError("Invalid Fediverse recommendation domain.");
  const labels = ascii.split(".");
  if (labels.length < 2 || labels.some((label) => !FEDIVERSE_DOMAIN_LABEL_PATTERN.test(label))) throw new TypeError("Invalid Fediverse recommendation domain.");
  return ascii;
}

function normalizeFediverseActorUri(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > FEDIVERSE_MAX_IDENTITY_LENGTH) throw new TypeError("Invalid Fediverse recommendation actor URI.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new TypeError("Invalid Fediverse recommendation actor URI.");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username.length > 0 || url.password.length > 0) throw new TypeError("Invalid Fediverse recommendation actor URI.");
  url.hostname = normalizeFediverseDomain(url.hostname);
  url.hash = "";
  return url.toString();
}

function fediverseDomainFromActorUri(actorUri: string | undefined): string | undefined {
  return actorUri === undefined ? undefined : normalizeFediverseDomain(new URL(actorUri).hostname);
}

function normalizeFediverseAcct(input: string): string {
  const trimmed = input.trim().replace(/^@/u, "");
  if (trimmed.length === 0 || trimmed.length > FEDIVERSE_MAX_IDENTITY_LENGTH || /\s/u.test(trimmed)) throw new TypeError("Invalid Fediverse recommendation account handle.");
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) throw new TypeError("Invalid Fediverse recommendation account handle.");
  const username = trimmed.slice(0, atIndex).normalize("NFKC").toLocaleLowerCase("und");
  const domain = normalizeFediverseDomain(trimmed.slice(atIndex + 1));
  if (username.length === 0 || username.includes("/") || username.includes(":") || username.includes("@")) throw new TypeError("Invalid Fediverse recommendation account handle.");
  return `${username}@${domain}`;
}

function fediverseDomainFromAcct(acct: string | undefined): string | undefined {
  return acct === undefined ? undefined : normalizeFediverseDomain(acct.slice(acct.lastIndexOf("@") + 1));
}

function normalizeFediverseAccountIdentity(account: RecommendationFediverseAccountEligibilityInput | undefined): NormalizedFediverseAccountIdentity {
  if (account === undefined) return Object.freeze({});
  if (!isPlainRecord(account)) throw new TypeError("Invalid Fediverse recommendation account input.");
  const actorUri = optionalString(account.actorUri, "Invalid Fediverse recommendation actor URI.");
  const acct = optionalString(account.acct, "Invalid Fediverse recommendation account handle.");
  const domain = optionalString(account.domain, "Invalid Fediverse recommendation domain.");
  const normalizedActorUri = actorUri === undefined ? undefined : normalizeFediverseActorUri(actorUri);
  const normalizedAcct = acct === undefined ? undefined : normalizeFediverseAcct(acct);
  const explicitDomain = domain === undefined ? undefined : normalizeFediverseDomain(domain);
  const derivedDomain = explicitDomain ?? fediverseDomainFromActorUri(normalizedActorUri) ?? fediverseDomainFromAcct(normalizedAcct);
  if (normalizedActorUri !== undefined && derivedDomain !== undefined && fediverseDomainFromActorUri(normalizedActorUri) !== derivedDomain) throw new TypeError("Conflicting Fediverse recommendation account domains.");
  if (normalizedAcct !== undefined && derivedDomain !== undefined && fediverseDomainFromAcct(normalizedAcct) !== derivedDomain) throw new TypeError("Conflicting Fediverse recommendation account domains.");
  return Object.freeze({
    ...(normalizedActorUri === undefined ? {} : { actorUri: normalizedActorUri }),
    ...(normalizedAcct === undefined ? {} : { acct: normalizedAcct }),
    ...(derivedDomain === undefined ? {} : { domain: derivedDomain })
  });
}

function accountSet(values: unknown): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const value of stringList(values, "Invalid Fediverse recommendation account control list.")) {
    const trimmed = value.trim();
    normalized.add(trimmed.includes("://") ? normalizeFediverseActorUri(trimmed) : normalizeFediverseAcct(trimmed));
  }
  return normalized;
}

function domainSet(values: unknown): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const value of stringList(values, "Invalid Fediverse recommendation domain control list.")) normalized.add(normalizeFediverseDomain(value));
  return normalized;
}

function normalizeViewerControls(input: unknown): { blockedAccounts: ReadonlySet<string>; mutedAccounts: ReadonlySet<string>; blockedDomains: ReadonlySet<string> } {
  if (input === undefined) return { blockedAccounts: new Set<string>(), mutedAccounts: new Set<string>(), blockedDomains: new Set<string>() };
  if (!isPlainRecord(input)) throw new TypeError("Invalid Fediverse recommendation viewer controls.");
  return { blockedAccounts: accountSet(input.blockedAccounts), mutedAccounts: accountSet(input.mutedAccounts), blockedDomains: domainSet(input.blockedDomains) };
}

function domainMatches(domain: string | undefined, domains: ReadonlySet<string>): boolean {
  if (domain === undefined) return false;
  for (const candidate of domains) if (domain === candidate || domain.endsWith(`.${candidate}`)) return true;
  return false;
}

function accountMatches(account: NormalizedFediverseAccountIdentity, controls: ReadonlySet<string>): boolean {
  return (account.actorUri !== undefined && controls.has(account.actorUri)) || (account.acct !== undefined && controls.has(account.acct));
}

function normalizePolicyTag(input: string): string {
  const normalized = normalizeHashtag(input).replace(/[^\p{Letter}\p{Number}]+/gu, "");
  if (normalized.length === 0) throw new TypeError("Invalid Fediverse recommendation opt-out tag.");
  return normalized;
}

function normalizeAccountTag(input: string): string | null {
  try {
    return normalizePolicyTag(input);
  } catch {
    return null;
  }
}

function collectOptOutTags(policy: RecommendationFediverseEligibilityPolicyInput | undefined): ReadonlySet<string> {
  const tags = new Set<string>();
  for (const tag of RECOMMENDATION_FEDIVERSE_DEFAULT_OPT_OUT_TAGS) tags.add(normalizePolicyTag(tag));
  for (const tag of stringList(policy?.optOutTags, "Invalid Fediverse recommendation opt-out tag list.")) tags.add(normalizePolicyTag(tag));
  return tags;
}

function matchedOptOutCount(account: RecommendationFediverseAccountEligibilityInput | undefined, optOutTags: ReadonlySet<string>): number {
  if (account === undefined) return 0;
  const matched = new Set<string>();
  for (const tag of [...stringList(account.profileTags, "Invalid Fediverse recommendation profile tag list."), ...stringList(account.featuredTags, "Invalid Fediverse recommendation featured tag list.")]) {
    const normalized = normalizeAccountTag(tag);
    if (normalized !== null && optOutTags.has(normalized)) matched.add(normalized);
  }
  return matched.size;
}

function normalizeInstance(input: RecommendationFediverseInstanceEligibilityInput | undefined): NormalizedFediverseInstance | undefined {
  if (input === undefined) return undefined;
  if (!isPlainRecord(input) || typeof input.domain !== "string") throw new TypeError("Invalid Fediverse recommendation instance input.");
  const matches = input.policyMatches ?? Object.freeze([]);
  if (!Array.isArray(matches)) throw new TypeError("Invalid Fediverse recommendation instance policy matches.");
  return Object.freeze({
    domain: normalizeFediverseDomain(input.domain),
    policyMatches: Object.freeze(matches.map((match) => {
      if (!isPlainRecord(match) || (match.provider !== "oliphant" && match.provider !== "custom")) throw new TypeError("Invalid Fediverse recommendation instance policy match.");
      if (match.tier !== undefined && match.tier !== "tier0" && match.tier !== "tier1") throw new TypeError("Invalid Fediverse recommendation instance policy tier.");
      return Object.freeze({ provider: match.provider, ...(match.tier === undefined ? {} : { tier: match.tier }) });
    }))
  });
}

function instancePolicyReason(instance: NormalizedFediverseInstance | undefined): RecommendationFediverseEligibilityReason | undefined {
  for (const match of instance?.policyMatches ?? Object.freeze([])) {
    if (match.provider === "oliphant" && match.tier === "tier0") return "excluded.instance_policy.oliphant_tier0";
    if (match.provider === "oliphant" && match.tier === "tier1") return "excluded.instance_policy.oliphant_tier1";
    if (match.provider === "custom") return "excluded.instance_policy.custom";
  }
  return undefined;
}

function eligibilityResult(eligible: boolean, reason: RecommendationFediverseEligibilityReason, accountDomain: string | undefined, instanceDomain: string | undefined, matchedOptOutTagCount: number): RecommendationFediverseEligibilityResult {
  return Object.freeze({ eligible, reason, matchedOptOutTagCount, ...(accountDomain === undefined ? {} : { normalizedAccountDomain: accountDomain }), ...(instanceDomain === undefined ? {} : { normalizedInstanceDomain: instanceDomain }) });
}

function assertPolicy(policy: unknown): asserts policy is RecommendationFediverseEligibilityPolicyInput | undefined {
  if (policy !== undefined && !isPlainRecord(policy)) throw new TypeError("Invalid Fediverse recommendation eligibility policy.");
}

export function evaluateRecommendationFediverseEligibility(input: RecommendationFediverseEligibilityInput): RecommendationFediverseEligibilityResult {
  const rawInput: unknown = input;
  if (!isPlainRecord(rawInput)) throw new TypeError("Invalid Fediverse recommendation eligibility input.");
  const safeInput = rawInput as RecommendationFediverseEligibilityInput;
  assertPolicy(safeInput.policy);

  const account = safeInput.account;
  const normalizedAccount = normalizeFediverseAccountIdentity(account);
  const instance = normalizeInstance(safeInput.instance);
  const accountDomain = normalizedAccount.domain;
  const instanceDomain = instance?.domain ?? accountDomain;
  if (accountDomain !== undefined && instance?.domain !== undefined && accountDomain !== instance.domain) throw new TypeError("Conflicting Fediverse recommendation instance domain.");

  const policy = safeInput.policy;
  const providerAllowsRecommendation = optionalBooleanValue(policy?.providerAllowsRecommendation, "Invalid Fediverse recommendation provider policy flag.");
  const requireDiscoverable = optionalBooleanValue(policy?.requireDiscoverable, "Invalid Fediverse recommendation discoverability policy.") ?? true;
  const requireIndexable = optionalBooleanValue(policy?.requireIndexable, "Invalid Fediverse recommendation indexability policy.") ?? false;
  const respectNoindex = optionalBooleanValue(policy?.respectNoindex, "Invalid Fediverse recommendation noindex policy.") ?? true;
  const respectOptOutTags = optionalBooleanValue(policy?.respectOptOutTags, "Invalid Fediverse recommendation opt-out policy.") ?? true;
  const allowLockedAccounts = optionalBooleanValue(policy?.allowLockedAccounts, "Invalid Fediverse recommendation locked-account policy.") ?? false;
  const allowMovedAccounts = optionalBooleanValue(policy?.allowMovedAccounts, "Invalid Fediverse recommendation moved-account policy.") ?? false;
  const allowSuspendedAccounts = optionalBooleanValue(policy?.allowSuspendedAccounts, "Invalid Fediverse recommendation suspended-account policy.") ?? false;
  const allowLimitedAccounts = optionalBooleanValue(policy?.allowLimitedAccounts, "Invalid Fediverse recommendation limited-account policy.") ?? false;
  const allowBots = optionalBooleanValue(policy?.allowBots, "Invalid Fediverse recommendation bot policy.") ?? false;
  const allowGroups = optionalBooleanValue(policy?.allowGroups, "Invalid Fediverse recommendation group policy.") ?? true;
  const optOutCount = matchedOptOutCount(account, collectOptOutTags(policy));
  const viewerControls = normalizeViewerControls(safeInput.viewerControls);

  if (providerAllowsRecommendation === false) return eligibilityResult(false, "excluded.provider_policy", accountDomain, instanceDomain, optOutCount);
  const instanceReason = instancePolicyReason(instance);
  if (instanceReason !== undefined) return eligibilityResult(false, instanceReason, accountDomain, instanceDomain, optOutCount);
  if (domainMatches(accountDomain, viewerControls.blockedDomains) || domainMatches(instanceDomain, viewerControls.blockedDomains)) return eligibilityResult(false, "excluded.viewer_blocked_domain", accountDomain, instanceDomain, optOutCount);
  if (accountMatches(normalizedAccount, viewerControls.blockedAccounts)) return eligibilityResult(false, "excluded.viewer_blocked_account", accountDomain, instanceDomain, optOutCount);
  if (accountMatches(normalizedAccount, viewerControls.mutedAccounts)) return eligibilityResult(false, "excluded.viewer_muted_account", accountDomain, instanceDomain, optOutCount);

  if (account !== undefined) {
    const discoverable = optionalBooleanValue(account.discoverable, "Invalid Fediverse recommendation discoverable flag.");
    const indexable = optionalBooleanValue(account.indexable, "Invalid Fediverse recommendation indexable flag.");
    const noindex = optionalBooleanValue(account.noindex, "Invalid Fediverse recommendation noindex flag.");
    const locked = optionalBooleanValue(account.locked, "Invalid Fediverse recommendation locked flag.");
    const moved = optionalBooleanValue(account.moved, "Invalid Fediverse recommendation moved flag.");
    const suspended = optionalBooleanValue(account.suspended, "Invalid Fediverse recommendation suspended flag.");
    const limited = optionalBooleanValue(account.limited, "Invalid Fediverse recommendation limited flag.");
    const bot = optionalBooleanValue(account.bot, "Invalid Fediverse recommendation bot flag.");
    const group = optionalBooleanValue(account.group, "Invalid Fediverse recommendation group flag.");
    if (suspended === true && !allowSuspendedAccounts) return eligibilityResult(false, "excluded.account_suspended", accountDomain, instanceDomain, optOutCount);
    if (limited === true && !allowLimitedAccounts) return eligibilityResult(false, "excluded.account_limited", accountDomain, instanceDomain, optOutCount);
    if (moved === true && !allowMovedAccounts) return eligibilityResult(false, "excluded.account_moved", accountDomain, instanceDomain, optOutCount);
    if (locked === true && !allowLockedAccounts) return eligibilityResult(false, "excluded.account_locked", accountDomain, instanceDomain, optOutCount);
    if (bot === true && !allowBots) return eligibilityResult(false, "excluded.account_bot_not_allowed", accountDomain, instanceDomain, optOutCount);
    if (group === true && !allowGroups) return eligibilityResult(false, "excluded.account_group_not_allowed", accountDomain, instanceDomain, optOutCount);
    if ((requireDiscoverable && discoverable !== true) || discoverable === false) return eligibilityResult(false, "excluded.account_discoverable_false", accountDomain, instanceDomain, optOutCount);
    if ((requireIndexable && indexable !== true) || indexable === false) return eligibilityResult(false, "excluded.account_indexable_false", accountDomain, instanceDomain, optOutCount);
    if (respectNoindex && noindex === true) return eligibilityResult(false, "excluded.account_noindex_true", accountDomain, instanceDomain, optOutCount);
    if (respectOptOutTags && optOutCount > 0) return eligibilityResult(false, "excluded.account_opt_out_tag", accountDomain, instanceDomain, optOutCount);
  }

  return eligibilityResult(true, "eligible", accountDomain, instanceDomain, optOutCount);
}
