function hexadecimal(bytes: Uint8Array) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function uuidV7(
  nowMs = Date.now(),
  randomBytes: (target: Uint8Array) => Uint8Array = (target) =>
    crypto.getRandomValues(target),
) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffffffff) {
    throw new TypeError("UUIDv7 time is outside its 48-bit millisecond range.");
  }
  const bytes = randomBytes(new Uint8Array(16));
  if (bytes.byteLength !== 16) {
    throw new TypeError("UUIDv7 randomness must fill exactly sixteen bytes.");
  }
  for (let index = 5; index >= 0; index -= 1) {
    const divisor = 256 ** (5 - index);
    bytes[index] = Math.floor(nowMs / divisor) % 256;
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const value = hexadecimal(bytes);
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  throw new TypeError("Canonical JSON contains an unsupported value.");
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export async function sha256Hex(value: Uint8Array | string) {
  const source = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hexadecimal(new Uint8Array(digest));
}
