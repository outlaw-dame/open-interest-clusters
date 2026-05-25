import assert from "node:assert/strict";

const PRIVACY_SAFE_AUDIT_EVENT_KEYS = Object.freeze([
  "accessBasis",
  "containsPrivateData",
  "containsThirdPartyData",
  "dataUse",
  "decision",
  "protocol",
  "reason",
  "serverSideProcessing",
  "sourceVisibility"
]);

export function assertSerializedPayloadRedaction(value: unknown, forbiddenTokens: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const token of forbiddenTokens) {
    if (typeof token === "string" && token.length > 0) {
      assert.equal(
        serialized.includes(token),
        false,
        `Expected serialized payload to redact token: ${token}`
      );
    }
  }
}

export function assertPrivacySafeAuditEventShape(event: object): void {
  assert.deepEqual(Object.keys(event).sort(), [...PRIVACY_SAFE_AUDIT_EVENT_KEYS]);
}