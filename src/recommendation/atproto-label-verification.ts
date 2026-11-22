import { createPublicKey, verify } from "node:crypto";
import { isRecommendationAtprotoLabelTimestamp } from "./atproto-labels.js";

// Optional check that a labeler really signed a com.atproto.label.defs#label. Nothing in the core
// recommendation path calls this. It uses only node:crypto, so it adds no dependencies.
//
// Scope is label signatures only. Repo, MST and CAR proofs, ActivityPub HTTP signatures and object
// proofs are not verified here. See docs/atproto-label-verification.md.

export const RECOMMENDATION_ATPROTO_LABEL_VERIFICATION_FAILURES = [
  "malformed_label",
  "unsupported_version",
  "malformed_signature",
  "did_mismatch",
  "key_not_found",
  "ambiguous_key",
  "malformed_key",
  "unsupported_key_type",
  "high_s_signature",
  "signature_mismatch",
  "expired",
  "invalid_clock"
] as const;

export type RecommendationAtprotoLabelVerificationFailure =
  typeof RECOMMENDATION_ATPROTO_LABEL_VERIFICATION_FAILURES[number];

export type RecommendationAtprotoLabelKeyType = "secp256k1" | "p256";

export type RecommendationAtprotoLabelVerificationResult =
  | {
      verified: true;
      keyType: RecommendationAtprotoLabelKeyType;
      /** True when the labeler signed a retraction of an earlier label. It is not a positive label. */
      negated: boolean;
      /** True when the signed label carries an expiry that is still in the future. */
      hasExpiry: boolean;
    }
  | { verified: false; reason: RecommendationAtprotoLabelVerificationFailure };

export interface RecommendationAtprotoSignedLabel {
  ver: number;
  src: string;
  uri: string;
  cid?: string;
  val: string;
  neg?: boolean;
  cts: string;
  exp?: string;
  /** 64 byte r||s. Raw bytes, standard base64, or the JSON form { $bytes: base64 }. */
  sig: Uint8Array | string | { $bytes: string };
}

export interface RecommendationAtprotoLabelVerificationInput {
  label: unknown;
  /** The labeler's current DID document, resolved by the caller. */
  didDocument: unknown;
  /** RFC 3339 timestamp from the caller's clock. */
  now: string;
}

const LABEL_KEY_FRAGMENT = "#atproto_label";
const MAX_FIELD_BYTES = 8_192;
const MAX_MULTIKEY_CHARS = 128;
const MAX_SIGNATURE_BASE64_CHARS = 128;
const MAX_VERIFICATION_METHODS = 64;
const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const ALLOWED_LABEL_FIELDS = new Set(["ver", "src", "uri", "cid", "val", "neg", "cts", "exp", "sig"]);
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

interface Curve {
  name: RecommendationAtprotoLabelKeyType;
  jwkCurve: "secp256k1" | "P-256";
  prefix: readonly [number, number];
  p: bigint;
  a: bigint;
  b: bigint;
  n: bigint;
}

const CURVES: readonly Curve[] = [
  {
    name: "secp256k1",
    jwkCurve: "secp256k1",
    prefix: [0xe7, 0x01],
    p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn,
    a: 0n,
    b: 7n,
    n: 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
  },
  {
    name: "p256",
    jwkCurve: "P-256",
    prefix: [0x80, 0x24],
    p: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn,
    a: 0xffffffff00000001000000000000000000000000fffffffffffffffffffffffcn,
    b: 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn,
    n: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
  }
];

class Rejection extends Error {
  constructor(readonly reason: RecommendationAtprotoLabelVerificationFailure) {
    super(reason);
  }
}

function reject(reason: RecommendationAtprotoLabelVerificationFailure): never {
  throw new Rejection(reason);
}

// ---------------------------------------------------------------------------------------------
// DAG-CBOR for the label shape only: one flat map of text keys to unsigned ints, text and bools.
// Keys are sorted by encoded length, then bytewise. Lengths and integers use the shortest form.

const textEncoder = new TextEncoder();

function encodeHead(major: number, value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TypeError("CBOR length or integer out of range.");
  }
  const type = major << 5;
  if (value < 24) return [type | value];
  if (value < 0x100) return [type | 24, value];
  if (value < 0x10000) return [type | 25, value >>> 8, value & 0xff];
  return [type | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function encodeText(value: string): Uint8Array {
  if (LONE_SURROGATE.test(value)) throw new TypeError("Label text is not valid Unicode.");
  const bytes = textEncoder.encode(value);
  if (bytes.length > MAX_FIELD_BYTES) throw new TypeError("Label text is too long.");
  const head = encodeHead(3, bytes.length);
  const out = new Uint8Array(head.length + bytes.length);
  out.set(head);
  out.set(bytes, head.length);
  return out;
}

function compareKeys(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] as number) - (b[i] as number);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Encodes a label without its signature as canonical DAG-CBOR, the exact bytes a labeler signs.
 * Throws TypeError on anything outside the label shape.
 */
export function encodeRecommendationAtprotoLabelForSigning(label: Readonly<Record<string, unknown>>): Uint8Array {
  const entries: Array<{ key: Uint8Array; value: Uint8Array }> = [];
  for (const [name, value] of Object.entries(label)) {
    if (name === "sig" || value === undefined) continue;
    if (!ALLOWED_LABEL_FIELDS.has(name)) throw new TypeError(`Unexpected label field ${name}.`);
    let encoded: Uint8Array;
    if (name === "ver") {
      if (typeof value !== "number") throw new TypeError("Label ver must be an integer.");
      encoded = Uint8Array.from(encodeHead(0, value));
    } else if (name === "neg") {
      if (typeof value !== "boolean") throw new TypeError("Label neg must be a boolean.");
      encoded = Uint8Array.of(value ? 0xf5 : 0xf4);
    } else {
      if (typeof value !== "string") throw new TypeError(`Label ${name} must be a string.`);
      encoded = encodeText(value);
    }
    entries.push({ key: encodeText(name), value: encoded });
  }
  entries.sort((x, y) => compareKeys(x.key, y.key));

  const head = encodeHead(5, entries.length);
  const parts: Uint8Array[] = [Uint8Array.from(head)];
  for (const entry of entries) parts.push(entry.key, entry.value);
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Multikey decoding. Only compressed secp256k1 and P-256 points are accepted, as in atproto.

function decodeBase58(input: string): Uint8Array {
  let value = 0n;
  for (const char of input) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) reject("malformed_key");
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 0xffn));
  let zeros = 0;
  while (zeros < input.length && input[zeros] === "1") zeros += 1;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes]);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  for (let e = exponent; e > 0n; e >>= 1n) {
    if ((e & 1n) === 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
  }
  return result;
}

function toBase64Url(value: bigint): string {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex").toString("base64url");
}

function importMultikey(multibase: unknown): { key: ReturnType<typeof createPublicKey>; curve: Curve } {
  if (typeof multibase !== "string" || multibase.length > MAX_MULTIKEY_CHARS || !multibase.startsWith("z")) {
    reject("malformed_key");
  }
  const raw = decodeBase58((multibase as string).slice(1));
  const curve = CURVES.find((c) => raw[0] === c.prefix[0] && raw[1] === c.prefix[1]);
  if (curve === undefined) reject("unsupported_key_type");
  const point = raw.subarray(2);
  if (point.length !== 33 || (point[0] !== 0x02 && point[0] !== 0x03)) reject("malformed_key");

  const c = curve as Curve;
  const x = BigInt(`0x${Buffer.from(point.subarray(1)).toString("hex")}`);
  if (x >= c.p) reject("malformed_key");
  const ySquared = (x ** 3n + c.a * x + c.b) % c.p;
  let y = modPow(ySquared, (c.p + 1n) / 4n, c.p);
  if ((y * y) % c.p !== ySquared) reject("malformed_key");
  if ((y & 1n) !== BigInt((point[0] as number) & 1)) y = c.p - y;

  try {
    const key = createPublicKey({
      key: { kty: "EC", crv: c.jwkCurve, x: toBase64Url(x), y: toBase64Url(y) },
      format: "jwk"
    });
    return { key, curve: c };
  } catch {
    return reject("malformed_key");
  }
}

// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSignature(value: unknown): Uint8Array {
  let encoded: unknown = value;
  if (isRecord(value) && !(value instanceof Uint8Array)) {
    if (Object.keys(value).length !== 1 || !("$bytes" in value)) reject("malformed_signature");
    encoded = value["$bytes"];
  }
  if (encoded instanceof Uint8Array) {
    if (encoded.length !== 64) reject("malformed_signature");
    return encoded;
  }
  if (typeof encoded !== "string" || encoded.length > MAX_SIGNATURE_BASE64_CHARS || !BASE64_PATTERN.test(encoded)) {
    reject("malformed_signature");
  }
  const bytes = Buffer.from(encoded as string, "base64");
  if (bytes.length !== 64) reject("malformed_signature");
  return new Uint8Array(bytes);
}

function validateLabel(label: unknown): asserts label is RecommendationAtprotoSignedLabel {
  if (!isRecord(label)) reject("malformed_label");
  const l = label as Record<string, unknown>;
  for (const name of Object.keys(l)) {
    if (!ALLOWED_LABEL_FIELDS.has(name)) reject("malformed_label");
  }
  if (typeof l.src !== "string" || !DID_PATTERN.test(l.src) || l.src.length > 2_048) reject("malformed_label");
  for (const name of ["uri", "val"] as const) {
    if (typeof l[name] !== "string" || l[name] === "") reject("malformed_label");
  }
  if (l.cid !== undefined && (typeof l.cid !== "string" || l.cid === "")) reject("malformed_label");
  if (l.neg !== undefined && typeof l.neg !== "boolean") reject("malformed_label");
  if (!isRecommendationAtprotoLabelTimestamp(l.cts)) reject("malformed_label");
  if (l.exp !== undefined && !isRecommendationAtprotoLabelTimestamp(l.exp)) reject("malformed_label");
  if (l.ver !== undefined && (typeof l.ver !== "number" || !Number.isInteger(l.ver) || l.ver < 0)) {
    reject("malformed_label");
  }
  if (l.ver !== 1) reject("unsupported_version");
}

function findLabelKey(didDocument: unknown, labelerDid: string): unknown {
  if (!isRecord(didDocument) || didDocument.id !== labelerDid) reject("did_mismatch");
  const doc = didDocument as Record<string, unknown>;
  const methods = doc.verificationMethod;
  if (!Array.isArray(methods) || methods.length > MAX_VERIFICATION_METHODS) reject("key_not_found");
  const matches = (methods as unknown[]).filter(
    (m) => isRecord(m) && (m.id === LABEL_KEY_FRAGMENT || m.id === `${labelerDid}${LABEL_KEY_FRAGMENT}`)
  ) as Array<Record<string, unknown>>;
  if (matches.length === 0) reject("key_not_found");
  if (matches.length > 1) reject("ambiguous_key");
  const method = matches[0] as Record<string, unknown>;
  if (method.type !== "Multikey") reject("unsupported_key_type");
  if (method.controller !== undefined && method.controller !== labelerDid) reject("malformed_key");
  return method.publicKeyMultibase;
}

/**
 * Checks a label's signature against the labeler's current `#atproto_label` key. It never throws on
 * bad input. A verified result with `negated: true` is a signed retraction, not a positive label.
 * An authentic label whose `exp` has passed returns `expired`. There is no fallback to the repo
 * signing key: a DID document without an `#atproto_label` key fails closed.
 */
export function verifyRecommendationAtprotoLabelSignature(
  input: RecommendationAtprotoLabelVerificationInput
): RecommendationAtprotoLabelVerificationResult {
  try {
    const label = input.label;
    validateLabel(label);
    const nowMs = typeof input.now === "string" && isRecommendationAtprotoLabelTimestamp(input.now)
      ? Date.parse(input.now)
      : reject("invalid_clock");
    const signature = readSignature((label as unknown as Record<string, unknown>).sig);
    const { key, curve } = importMultikey(findLabelKey(input.didDocument, label.src));

    const s = BigInt(`0x${Buffer.from(signature.subarray(32)).toString("hex")}`);
    if (s > curve.n / 2n) reject("high_s_signature");

    const bytes = encodeLabelBytes(label);
    let valid = false;
    try {
      valid = verify("sha256", bytes, { key, dsaEncoding: "ieee-p1363" }, signature);
    } catch {
      valid = false;
    }
    if (!valid) reject("signature_mismatch");

    const expiresAt = label.exp === undefined ? undefined : Date.parse(label.exp);
    if (expiresAt !== undefined && expiresAt <= nowMs) reject("expired");
    return { verified: true, keyType: curve.name, negated: label.neg === true, hasExpiry: expiresAt !== undefined };
  } catch (error) {
    return { verified: false, reason: error instanceof Rejection ? error.reason : "malformed_label" };
  }
}

function encodeLabelBytes(label: RecommendationAtprotoSignedLabel): Uint8Array {
  try {
    return encodeRecommendationAtprotoLabelForSigning(label as unknown as Record<string, unknown>);
  } catch {
    return reject("malformed_label");
  }
}
