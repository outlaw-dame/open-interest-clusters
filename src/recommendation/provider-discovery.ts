import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  RECOMMENDATION_PROTOCOLS,
  type RecommendationProtocol
} from "./consent.js";

export const RECOMMENDATION_PROVIDER_APPLICATION_PROFILES = [
  "generic_activitypub",
  "mastodon_compatible",
  "generic_atproto",
  "bluesky_compatible",
  "activitypods"
] as const;

export type RecommendationProviderApplicationProfile =
  typeof RECOMMENDATION_PROVIDER_APPLICATION_PROFILES[number];

export const RECOMMENDATION_PROVIDER_CAPABILITIES = [
  "profile",
  "posts",
  "hashtags",
  "feeds",
  "lists",
  "starter_packs",
  "labels",
  "moderation",
  "blocks",
  "mutes",
  "follows",
  "collections",
  "user_owned_storage",
  "acl_authorization"
] as const;

export type RecommendationProviderCapability =
  typeof RECOMMENDATION_PROVIDER_CAPABILITIES[number];

export const RECOMMENDATION_PROVIDER_CAPABILITY_STATES = [
  "supported",
  "unsupported",
  "unknown"
] as const;

export type RecommendationProviderCapabilityState =
  typeof RECOMMENDATION_PROVIDER_CAPABILITY_STATES[number];

export const RECOMMENDATION_PROVIDER_DISCOVERY_AUTHORITIES = [
  "provider_probe",
  "protocol_native",
  "authenticated_registration",
  "explicit_integration"
] as const;

export type RecommendationProviderDiscoveryAuthority =
  typeof RECOMMENDATION_PROVIDER_DISCOVERY_AUTHORITIES[number];

export const RECOMMENDATION_PROVIDER_BINDING_VERIFICATIONS = [
  "asserted",
  "verified"
] as const;

export type RecommendationProviderBindingVerification =
  typeof RECOMMENDATION_PROVIDER_BINDING_VERIFICATIONS[number];

export interface RecommendationProviderProtocolBinding {
  protocol: RecommendationProtocol;
  endpoint?: string;
  authority: RecommendationProviderDiscoveryAuthority;
  verification: RecommendationProviderBindingVerification;
}

export interface RecommendationProviderCapabilityObservation {
  capability: RecommendationProviderCapability;
  state: RecommendationProviderCapabilityState;
  authority: RecommendationProviderDiscoveryAuthority;
  protocol?: RecommendationProtocol;
}

export interface RecommendationProviderDiscoveryObservation {
  providerId: string;
  applicationId?: string;
  applicationAuthority?: RecommendationProviderDiscoveryAuthority;
  protocolBindings: readonly RecommendationProviderProtocolBinding[];
  applicationProfiles: readonly RecommendationProviderApplicationProfile[];
  capabilities: readonly RecommendationProviderCapabilityObservation[];
  observedAt: string;
  expiresAt: string;
}

export interface RecommendationResolvedProviderCapability {
  capability: RecommendationProviderCapability;
  state: RecommendationProviderCapabilityState;
  protocol?: RecommendationProtocol;
  authority: RecommendationProviderDiscoveryAuthority;
}

export interface RecommendationProviderDescriptor {
  providerId: string;
  applicationId?: string;
  detectedAt: string;
  expiresAt: string;
  protocolBindings: readonly RecommendationProviderProtocolBinding[];
  applicationProfiles: readonly RecommendationProviderApplicationProfile[];
  capabilities: readonly RecommendationResolvedProviderCapability[];
}

export interface RecommendationProviderDiscoveryProbe {
  id: string;
  probe(signal?: AbortSignal):
    | RecommendationProviderDiscoveryObservation
    | Promise<RecommendationProviderDiscoveryObservation>;
}

export interface RecommendationProviderDiscoveryCache {
  read(key: string): RecommendationProviderDescriptor | undefined | Promise<RecommendationProviderDescriptor | undefined>;
  write(key: string, descriptor: RecommendationProviderDescriptor): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
}

export interface RecommendationProviderDiscoveryRetryPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface RecommendationProviderDiscoveryOptions {
  providerId: string;
  applicationId?: string;
  probes: readonly RecommendationProviderDiscoveryProbe[];
  cache?: RecommendationProviderDiscoveryCache;
  signal?: AbortSignal;
  now?: () => Date;
  retry?: RecommendationProviderDiscoveryRetryPolicy;
  concurrency?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export class RecommendationProviderProbeError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable = false) {
    super("Recommendation provider discovery probe failed.");
    this.name = "RecommendationProviderProbeError";
    this.code = boundedString(code, 128, "Invalid recommendation provider probe error code.");
    this.retryable = retryable;
  }
}

const PROTOCOL_SET = new Set<string>(RECOMMENDATION_PROTOCOLS);
const PROFILE_SET = new Set<string>(RECOMMENDATION_PROVIDER_APPLICATION_PROFILES);
const CAPABILITY_SET = new Set<string>(RECOMMENDATION_PROVIDER_CAPABILITIES);
const CAPABILITY_STATE_SET = new Set<string>(RECOMMENDATION_PROVIDER_CAPABILITY_STATES);
const AUTHORITY_SET = new Set<string>(RECOMMENDATION_PROVIDER_DISCOVERY_AUTHORITIES);
const VERIFICATION_SET = new Set<string>(RECOMMENDATION_PROVIDER_BINDING_VERIFICATIONS);
const AUTHORITY_RANK: Readonly<Record<RecommendationProviderDiscoveryAuthority, number>> = Object.freeze({
  provider_probe: 1,
  protocol_native: 2,
  authenticated_registration: 3,
  explicit_integration: 3
});
const MAX_ID_LENGTH = 512;
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_PROBES = 32;
const MAX_BINDINGS = 32;
const MAX_PROFILES = 16;
const MAX_CAPABILITIES = 64;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 50;
const DEFAULT_MAX_DELAY_MS = 500;
const MAX_DELAY_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, message: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.length > maximum ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(message);
  }
  return value;
}

function optionalBoundedString(value: unknown, maximum: number, message: string): string | undefined {
  return value === undefined ? undefined : boundedString(value, maximum, message);
}

function timestamp(value: unknown, message: string): string {
  const text = boundedString(value, 64, message);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== text) throw new TypeError(message);
  return text;
}

function currentTimeMs(now: () => Date): number {
  const current = now();
  if (!(current instanceof Date) || !Number.isFinite(current.getTime())) {
    throw new TypeError("Invalid recommendation provider discovery clock.");
  }
  return current.getTime();
}

function uniqueKnown<T extends string>(
  value: unknown,
  known: ReadonlySet<string>,
  maximum: number,
  message: string
): readonly T[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    !value.every((entry) => typeof entry === "string" && known.has(entry)) ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError(message);
  }
  return Object.freeze([...value] as T[]);
}

function normalizeBinding(value: unknown): RecommendationProviderProtocolBinding {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !["protocol", "endpoint", "authority", "verification"].includes(key)) ||
    typeof value.protocol !== "string" || !PROTOCOL_SET.has(value.protocol) ||
    typeof value.authority !== "string" || !AUTHORITY_SET.has(value.authority) ||
    typeof value.verification !== "string" || !VERIFICATION_SET.has(value.verification)
  ) {
    throw new TypeError("Invalid recommendation provider protocol binding.");
  }
  if (value.protocol === "unknown") {
    throw new TypeError("Recommendation provider discovery cannot publish an unknown protocol binding.");
  }
  const endpoint = optionalBoundedString(
    value.endpoint,
    MAX_ENDPOINT_LENGTH,
    "Invalid recommendation provider protocol endpoint."
  );
  const binding: RecommendationProviderProtocolBinding = {
    protocol: value.protocol as RecommendationProtocol,
    authority: value.authority as RecommendationProviderDiscoveryAuthority,
    verification: value.verification as RecommendationProviderBindingVerification
  };
  if (endpoint !== undefined) binding.endpoint = endpoint;
  return Object.freeze(binding);
}

function normalizeCapabilityObservation(value: unknown): RecommendationProviderCapabilityObservation {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !["capability", "state", "authority", "protocol"].includes(key)) ||
    typeof value.capability !== "string" || !CAPABILITY_SET.has(value.capability) ||
    typeof value.state !== "string" || !CAPABILITY_STATE_SET.has(value.state) ||
    typeof value.authority !== "string" || !AUTHORITY_SET.has(value.authority) ||
    (value.protocol !== undefined && (typeof value.protocol !== "string" || !PROTOCOL_SET.has(value.protocol) || value.protocol === "unknown"))
  ) {
    throw new TypeError("Invalid recommendation provider capability observation.");
  }
  const capability: RecommendationProviderCapabilityObservation = {
    capability: value.capability as RecommendationProviderCapability,
    state: value.state as RecommendationProviderCapabilityState,
    authority: value.authority as RecommendationProviderDiscoveryAuthority
  };
  if (value.protocol !== undefined) capability.protocol = value.protocol as RecommendationProtocol;
  return Object.freeze(capability);
}

export function normalizeRecommendationProviderDiscoveryObservation(
  value: unknown
): RecommendationProviderDiscoveryObservation {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => ![
      "providerId", "applicationId", "applicationAuthority", "protocolBindings", "applicationProfiles",
      "capabilities", "observedAt", "expiresAt"
    ].includes(key))
  ) {
    throw new TypeError("Invalid recommendation provider discovery observation.");
  }
  const providerId = boundedString(value.providerId, MAX_ID_LENGTH, "Invalid recommendation provider ID.");
  const applicationId = optionalBoundedString(
    value.applicationId,
    MAX_ID_LENGTH,
    "Invalid recommendation provider application ID."
  );
  if (
    value.applicationAuthority !== undefined &&
    (typeof value.applicationAuthority !== "string" || !AUTHORITY_SET.has(value.applicationAuthority))
  ) {
    throw new TypeError("Invalid recommendation provider application authority.");
  }
  if (!Array.isArray(value.protocolBindings) || value.protocolBindings.length > MAX_BINDINGS) {
    throw new TypeError("Invalid recommendation provider protocol bindings.");
  }
  const protocolBindings = value.protocolBindings.map(normalizeBinding);
  const bindingKeys = protocolBindings.map((entry) =>
    `${entry.protocol}\u0000${entry.endpoint ?? ""}\u0000${entry.authority}\u0000${entry.verification}`
  );
  if (new Set(bindingKeys).size !== bindingKeys.length) {
    throw new TypeError("Duplicate recommendation provider protocol binding.");
  }
  const applicationProfiles = uniqueKnown<RecommendationProviderApplicationProfile>(
    value.applicationProfiles,
    PROFILE_SET,
    MAX_PROFILES,
    "Invalid recommendation provider application profiles."
  );
  if (applicationId === undefined && (value.applicationAuthority !== undefined || applicationProfiles.length > 0)) {
    throw new TypeError("Recommendation provider application claims require an application identity.");
  }
  const applicationAuthority = applicationId === undefined
    ? undefined
    : (value.applicationAuthority as RecommendationProviderDiscoveryAuthority | undefined) ?? "provider_probe";
  if (!Array.isArray(value.capabilities) || value.capabilities.length > MAX_CAPABILITIES) {
    throw new TypeError("Invalid recommendation provider capabilities.");
  }
  const capabilities = value.capabilities.map(normalizeCapabilityObservation);
  const capabilityKeys = capabilities.map((entry) =>
    `${entry.capability}\u0000${entry.protocol ?? ""}\u0000${entry.authority}`
  );
  if (new Set(capabilityKeys).size !== capabilityKeys.length) {
    throw new TypeError("Duplicate recommendation provider capability observation.");
  }
  const observedAt = timestamp(value.observedAt, "Invalid recommendation provider observation timestamp.");
  const expiresAt = timestamp(value.expiresAt, "Invalid recommendation provider expiration timestamp.");
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) {
    throw new TypeError("Recommendation provider observation must expire after it was observed.");
  }
  const normalized: RecommendationProviderDiscoveryObservation = {
    providerId,
    protocolBindings: Object.freeze(protocolBindings),
    applicationProfiles,
    capabilities: Object.freeze(capabilities),
    observedAt,
    expiresAt
  };
  if (applicationId !== undefined) {
    normalized.applicationId = applicationId;
    normalized.applicationAuthority = applicationAuthority;
  }
  return Object.freeze(normalized);
}

function normalizeDescriptor(value: unknown): RecommendationProviderDescriptor {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => ![
      "providerId", "applicationId", "detectedAt", "expiresAt", "protocolBindings",
      "applicationProfiles", "capabilities"
    ].includes(key))
  ) {
    throw new TypeError("Invalid cached recommendation provider descriptor.");
  }
  const providerId = boundedString(value.providerId, MAX_ID_LENGTH, "Invalid recommendation provider ID.");
  const applicationId = optionalBoundedString(
    value.applicationId,
    MAX_ID_LENGTH,
    "Invalid recommendation provider application ID."
  );
  const detectedAt = timestamp(value.detectedAt, "Invalid recommendation provider detection timestamp.");
  const expiresAt = timestamp(value.expiresAt, "Invalid recommendation provider expiration timestamp.");
  if (Date.parse(expiresAt) <= Date.parse(detectedAt)) {
    throw new TypeError("Invalid recommendation provider descriptor lifetime.");
  }
  if (!Array.isArray(value.protocolBindings) || value.protocolBindings.length === 0 || value.protocolBindings.length > MAX_BINDINGS) {
    throw new TypeError("Invalid recommendation provider protocol bindings.");
  }
  const protocolBindings = value.protocolBindings.map(normalizeBinding);
  const bindingKeys = protocolBindings.map((entry) => `${entry.protocol}\u0000${entry.endpoint ?? ""}`);
  if (new Set(bindingKeys).size !== bindingKeys.length) {
    throw new TypeError("Duplicate recommendation provider protocol binding.");
  }
  const applicationProfiles = uniqueKnown<RecommendationProviderApplicationProfile>(
    value.applicationProfiles,
    PROFILE_SET,
    MAX_PROFILES,
    "Invalid recommendation provider application profiles."
  );
  if (applicationId === undefined && applicationProfiles.length > 0) {
    throw new TypeError("Cached recommendation provider application profiles require an application identity.");
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length > MAX_CAPABILITIES) {
    throw new TypeError("Invalid recommendation provider capabilities.");
  }
  const capabilities = value.capabilities.map((entry) => {
    const normalized = normalizeCapabilityObservation(entry);
    return Object.freeze({ ...normalized }) as RecommendationResolvedProviderCapability;
  });
  const capabilityKeys = capabilities.map((entry) => `${entry.capability}\u0000${entry.protocol ?? ""}`);
  if (new Set(capabilityKeys).size !== capabilityKeys.length) {
    throw new TypeError("Duplicate recommendation provider capability.");
  }
  const descriptor: RecommendationProviderDescriptor = {
    providerId,
    detectedAt,
    expiresAt,
    protocolBindings: Object.freeze(protocolBindings),
    applicationProfiles,
    capabilities: Object.freeze(capabilities)
  };
  if (applicationId !== undefined) descriptor.applicationId = applicationId;
  return Object.freeze(descriptor);
}

function cacheKey(providerId: string, applicationId?: string): string {
  return `provider-discovery:v1:${providerId}:${applicationId ?? "-"}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

async function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return;
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const timer = setTimeout(() => finish(resolve), milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      finish(() => reject(signal?.reason ?? new DOMException("Aborted", "AbortError")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function retryPolicy(value: RecommendationProviderDiscoveryRetryPolicy | undefined): Required<RecommendationProviderDiscoveryRetryPolicy> {
  const maxAttempts = value?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = value?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = value?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  if (
    !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS ||
    !Number.isSafeInteger(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > MAX_DELAY_MS ||
    !Number.isSafeInteger(maxDelayMs) || maxDelayMs < baseDelayMs || maxDelayMs > MAX_DELAY_MS
  ) {
    throw new TypeError("Invalid recommendation provider discovery retry policy.");
  }
  return { maxAttempts, baseDelayMs, maxDelayMs };
}

async function runProbe(
  probe: RecommendationProviderDiscoveryProbe,
  signal: AbortSignal | undefined,
  retry: Required<RecommendationProviderDiscoveryRetryPolicy>,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>
): Promise<RecommendationProviderDiscoveryObservation | undefined> {
  boundedString(probe.id, 256, "Invalid recommendation provider discovery probe ID.");
  if (typeof probe.probe !== "function") {
    throw new TypeError("Invalid recommendation provider discovery probe.");
  }
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    try {
      return normalizeRecommendationProviderDiscoveryObservation(await probe.probe(signal));
    } catch (error) {
      throwIfAborted(signal);
      const retryable = error instanceof RecommendationProviderProbeError && error.retryable;
      if (!retryable || attempt === retry.maxAttempts) return undefined;
      const delay = Math.min(retry.maxDelayMs, retry.baseDelayMs * (2 ** (attempt - 1)));
      await sleep(delay, signal);
    }
  }
  return undefined;
}

function applicationAuthorityRank(observation: RecommendationProviderDiscoveryObservation): number {
  return AUTHORITY_RANK[observation.applicationAuthority ?? "provider_probe"];
}

function resolveApplicationId(
  expected: string | undefined,
  observations: readonly RecommendationProviderDiscoveryObservation[]
): string | undefined {
  const strongIds = new Set(
    observations
      .filter((observation) =>
        observation.applicationId !== undefined &&
        applicationAuthorityRank(observation) >= AUTHORITY_RANK.protocol_native
      )
      .map((observation) => observation.applicationId as string)
  );
  if (expected !== undefined && [...strongIds].some((entry) => entry !== expected)) {
    throw new TypeError("Conflicting recommendation provider application identity evidence.");
  }
  if (strongIds.size > 1) {
    throw new TypeError("Conflicting recommendation provider application identity evidence.");
  }
  return expected ?? [...strongIds][0];
}

function resolveApplicationProfiles(
  resolvedApplicationId: string | undefined,
  observations: readonly RecommendationProviderDiscoveryObservation[]
): readonly RecommendationProviderApplicationProfile[] {
  if (resolvedApplicationId === undefined) return Object.freeze([]);
  const profiles = observations
    .filter((observation) =>
      observation.applicationId === resolvedApplicationId &&
      applicationAuthorityRank(observation) >= AUTHORITY_RANK.protocol_native
    )
    .flatMap((observation) => observation.applicationProfiles);
  return Object.freeze([...new Set(profiles)].sort()) as readonly RecommendationProviderApplicationProfile[];
}

function mergeBindings(
  observations: readonly RecommendationProviderDiscoveryObservation[]
): readonly RecommendationProviderProtocolBinding[] {
  const byKey = new Map<string, RecommendationProviderProtocolBinding>();
  for (const observation of observations) {
    for (const binding of observation.protocolBindings) {
      const key = `${binding.protocol}\u0000${binding.endpoint ?? ""}`;
      const current = byKey.get(key);
      if (
        current === undefined ||
        AUTHORITY_RANK[binding.authority] > AUTHORITY_RANK[current.authority] ||
        (AUTHORITY_RANK[binding.authority] === AUTHORITY_RANK[current.authority] &&
          binding.verification === "verified" && current.verification === "asserted")
      ) {
        byKey.set(key, binding);
      }
    }
  }
  return Object.freeze([...byKey.values()].sort((a, b) =>
    a.protocol.localeCompare(b.protocol) || (a.endpoint ?? "").localeCompare(b.endpoint ?? "")
  ));
}

function mergeCapabilities(
  observations: readonly RecommendationProviderDiscoveryObservation[]
): readonly RecommendationResolvedProviderCapability[] {
  const grouped = new Map<string, RecommendationProviderCapabilityObservation[]>();
  for (const observation of observations) {
    for (const capability of observation.capabilities) {
      const key = `${capability.capability}\u0000${capability.protocol ?? ""}`;
      const group = grouped.get(key) ?? [];
      group.push(capability);
      grouped.set(key, group);
    }
  }
  const resolved: RecommendationResolvedProviderCapability[] = [];
  for (const group of grouped.values()) {
    const highestRank = Math.max(...group.map((entry) => AUTHORITY_RANK[entry.authority]));
    const strongest = group.filter((entry) => AUTHORITY_RANK[entry.authority] === highestRank);
    const states = new Set(strongest.map((entry) => entry.state));
    const exemplar = strongest[0];
    if (exemplar === undefined) continue;
    resolved.push(Object.freeze({
      capability: exemplar.capability,
      state: states.size === 1 ? exemplar.state : "unknown",
      authority: exemplar.authority,
      ...(exemplar.protocol === undefined ? {} : { protocol: exemplar.protocol })
    }));
  }
  return Object.freeze(resolved.sort((a, b) =>
    a.capability.localeCompare(b.capability) || (a.protocol ?? "").localeCompare(b.protocol ?? "")
  ));
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

async function bestEffortDelete(
  cache: RecommendationProviderDiscoveryCache,
  key: string
): Promise<void> {
  try {
    await cache.delete?.(key);
  } catch {
    // Cache cleanup is auxiliary. Fresh discovery remains authoritative.
  }
}

async function readFreshCache(
  cache: RecommendationProviderDiscoveryCache,
  key: string,
  providerId: string,
  applicationId: string | undefined,
  now: () => Date
): Promise<RecommendationProviderDescriptor | undefined> {
  let raw: RecommendationProviderDescriptor | undefined;
  try {
    raw = await cache.read(key);
  } catch {
    return undefined;
  }
  if (raw === undefined) return undefined;
  try {
    const cached = normalizeDescriptor(raw);
    const checkedAtMs = currentTimeMs(now);
    if (
      cached.providerId === providerId &&
      cached.applicationId === applicationId &&
      Date.parse(cached.expiresAt) > checkedAtMs
    ) {
      return cached;
    }
  } catch {
    // Delete malformed cache entries below and continue with fresh probes.
  }
  await bestEffortDelete(cache, key);
  return undefined;
}

async function bestEffortWrite(
  cache: RecommendationProviderDiscoveryCache,
  key: string,
  descriptor: RecommendationProviderDescriptor
): Promise<void> {
  try {
    await cache.write(key, descriptor);
  } catch {
    // Cache persistence must not invalidate an already verified fresh result.
  }
}

export function recommendationProviderCapabilityState(
  descriptor: RecommendationProviderDescriptor,
  capability: RecommendationProviderCapability,
  protocol?: RecommendationProtocol
): RecommendationProviderCapabilityState {
  const matches = descriptor.capabilities.filter((entry) =>
    entry.capability === capability && (protocol === undefined || entry.protocol === protocol)
  );
  if (matches.length === 0) return "unknown";
  const states = new Set(matches.map((entry) => entry.state));
  return states.size === 1 ? matches[0]?.state ?? "unknown" : "unknown";
}

export async function discoverRecommendationProviderCapabilities(
  options: RecommendationProviderDiscoveryOptions
): Promise<RecommendationProviderDescriptor> {
  if (!isRecord(options)) {
    throw new TypeError("Invalid recommendation provider discovery options.");
  }
  const providerId = boundedString(options.providerId, MAX_ID_LENGTH, "Invalid recommendation provider ID.");
  const applicationId = optionalBoundedString(
    options.applicationId,
    MAX_ID_LENGTH,
    "Invalid recommendation provider application ID."
  );
  if (!Array.isArray(options.probes) || options.probes.length === 0 || options.probes.length > MAX_PROBES) {
    throw new TypeError("Invalid recommendation provider discovery probes.");
  }
  for (const candidate of options.probes) {
    if (!isRecord(candidate)) throw new TypeError("Invalid recommendation provider discovery probe.");
    boundedString(candidate.id, 256, "Invalid recommendation provider discovery probe ID.");
    if (typeof candidate.probe !== "function") {
      throw new TypeError("Invalid recommendation provider discovery probe.");
    }
  }
  if (new Set(options.probes.map((probe) => probe.id)).size !== options.probes.length) {
    throw new TypeError("Duplicate recommendation provider discovery probe ID.");
  }
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new TypeError("Invalid recommendation provider discovery concurrency.");
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new TypeError("Invalid recommendation provider discovery abort signal.");
  }
  const now = options.now ?? (() => new Date());
  currentTimeMs(now);
  const key = cacheKey(providerId, applicationId);
  throwIfAborted(options.signal);
  if (options.cache !== undefined) {
    const cached = await readFreshCache(
      options.cache,
      key,
      providerId,
      applicationId,
      now
    );
    throwIfAborted(options.signal);
    if (cached !== undefined) return cached;
  }

  const retry = retryPolicy(options.retry);
  const sleep = options.sleep ?? defaultSleep;
  const observations = (await mapConcurrent(
    options.probes,
    concurrency,
    (candidate) => runProbe(candidate, options.signal, retry, sleep)
  )).filter((entry): entry is RecommendationProviderDiscoveryObservation => entry !== undefined);

  throwIfAborted(options.signal);
  const afterProbeMs = currentTimeMs(now);
  const currentObservations = observations.filter((entry) => Date.parse(entry.expiresAt) > afterProbeMs);
  if (currentObservations.length === 0) {
    throw new Error("Recommendation provider discovery produced no current trusted observations.");
  }
  if (currentObservations.some((entry) => entry.providerId !== providerId)) {
    throw new TypeError("Recommendation provider discovery returned mismatched provider identity.");
  }

  const resolvedApplicationId = resolveApplicationId(applicationId, currentObservations);
  const protocolBindings = mergeBindings(currentObservations);
  if (protocolBindings.length === 0) {
    throw new Error("Recommendation provider discovery produced no verified protocol bindings.");
  }
  const applicationProfiles = resolveApplicationProfiles(resolvedApplicationId, currentObservations);
  const capabilities = mergeCapabilities(currentObservations);
  const detectedAtMs = Math.max(...currentObservations.map((entry) => Date.parse(entry.observedAt)));
  const expiresAtMs = Math.min(...currentObservations.map((entry) => Date.parse(entry.expiresAt)));
  if (detectedAtMs >= expiresAtMs) {
    throw new Error("Recommendation provider discovery observations have no overlapping validity window.");
  }
  const finalCheckMs = currentTimeMs(now);
  if (expiresAtMs <= finalCheckMs) {
    throw new Error("Recommendation provider discovery observations expired before resolution completed.");
  }
  const descriptor: RecommendationProviderDescriptor = Object.freeze({
    providerId,
    ...(resolvedApplicationId === undefined ? {} : { applicationId: resolvedApplicationId }),
    detectedAt: new Date(detectedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    protocolBindings,
    applicationProfiles,
    capabilities
  });
  if (options.cache !== undefined) await bestEffortWrite(options.cache, key, descriptor);
  return descriptor;
}
