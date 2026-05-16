import { sha256Hex } from "../runtime/hash.js";
import { DEFAULT_RECOMMENDATION_PROFILE_SUBJECT_KEY_NAMESPACE, type RecommendationProfileSubjectKeyInput } from "./profile-store-persistence.js";

export const RECOMMENDATION_PROFILE_SUBJECT_KEY_PREFIX = "profile:" as const;

const MAX_SUBJECT_ID_LENGTH = 512;
const MAX_KEY_PART_LENGTH = 512;
const PROFILE_SUBJECT_KEY_HEX_LENGTH = 64;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeKeyPart(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= MAX_KEY_PART_LENGTH && !hasControlCharacter(value);
}

function assertSafeKeyPart(value: unknown, message: string): string {
  if (!isSafeKeyPart(value)) {
    throw new TypeError(message);
  }

  return value;
}

export function assertValidRecommendationProfileSubjectId(subjectId: unknown): asserts subjectId is string {
  if (!isNonEmptyString(subjectId) || subjectId.length > MAX_SUBJECT_ID_LENGTH || hasControlCharacter(subjectId)) {
    throw new TypeError("Invalid recommendation profile subject id.");
  }
}

function isLowerHex(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isDigit = code >= 48 && code <= 57;
    const isLowerHexLetter = code >= 97 && code <= 102;
    if (!isDigit && !isLowerHexLetter) {
      return false;
    }
  }

  return true;
}

export function assertValidRecommendationProfileSubjectKey(subjectKey: unknown): asserts subjectKey is string {
  if (
    typeof subjectKey !== "string" ||
    !subjectKey.startsWith(RECOMMENDATION_PROFILE_SUBJECT_KEY_PREFIX) ||
    subjectKey.length !== RECOMMENDATION_PROFILE_SUBJECT_KEY_PREFIX.length + PROFILE_SUBJECT_KEY_HEX_LENGTH ||
    !isLowerHex(subjectKey.slice(RECOMMENDATION_PROFILE_SUBJECT_KEY_PREFIX.length))
  ) {
    throw new TypeError("Invalid recommendation profile persistence subject key.");
  }
}

export function createRecommendationProfileSubjectKey(input: RecommendationProfileSubjectKeyInput): string {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Invalid recommendation profile subject key input.");
  }

  assertValidRecommendationProfileSubjectId(input.subjectId);
  const namespace = assertSafeKeyPart(
    input.namespace ?? DEFAULT_RECOMMENDATION_PROFILE_SUBJECT_KEY_NAMESPACE,
    "Invalid recommendation profile subject key namespace."
  );
  const salt = input.salt === undefined ? "" : assertSafeKeyPart(input.salt, "Invalid recommendation profile subject key salt.");
  const material = JSON.stringify(["recommendation-profile-subject-key.v1", namespace, salt, input.subjectId]);

  return `${RECOMMENDATION_PROFILE_SUBJECT_KEY_PREFIX}${sha256Hex(material)}`;
}
