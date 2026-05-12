import type { LocalPreferenceProfile } from "./types.js";

const MAX_INTERESTS = 10_000;
const MAX_BANDIT_STATES = 10_000;

export function serializeLocalPreferenceProfile(
  profile: Readonly<LocalPreferenceProfile>
): string {
  return JSON.stringify(profile);
}

export function deserializeLocalPreferenceProfile(
  serialized: string
): LocalPreferenceProfile {
  const parsed = JSON.parse(serialized) as LocalPreferenceProfile;

  if (parsed.schemaVersion !== "local-preference-profile.v1") {
    throw new Error("Unsupported local preference profile schema");
  }

  if (!Array.isArray(parsed.interests) || parsed.interests.length > MAX_INTERESTS) {
    throw new Error("Invalid local preference interests");
  }

  if (
    typeof parsed.banditStates !== "object" ||
    parsed.banditStates === null ||
    Object.keys(parsed.banditStates).length > MAX_BANDIT_STATES
  ) {
    throw new Error("Invalid local preference bandit state map");
  }

  return parsed;
}
