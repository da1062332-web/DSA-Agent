// packages/bre-core/src/canonical-json.ts — owner: Dev 2 (pure functions, no I/O)

/**
 * Deterministic canonical JSON serialization:
 * - Object keys sorted lexicographically
 * - Primitive values normalized
 * - Arrays preserve element order
 * - No redundant whitespace
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([_, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalJsonStringify(v)).join(',') + '}';
}

/**
 * Pure TypeScript SHA-256 implementation (FIPS 180-4) with zero dependencies.
 * Complies with bre-core's no-I/O rule and empty types compilerOptions.
 */
function sha256Raw(message: string): string {
  // UTF-8 encode
  const msgBytes: number[] = [];
  for (let i = 0; i < message.length; i++) {
    let charCode = message.charCodeAt(i);
    if (charCode < 0x80) {
      msgBytes.push(charCode);
    } else if (charCode < 0x800) {
      msgBytes.push(0xc0 | (charCode >> 6), 0x80 | (charCode & 0x3f));
    } else if (charCode < 0xd800 || charCode >= 0xe000) {
      msgBytes.push(0xe0 | (charCode >> 12), 0x80 | ((charCode >> 6) & 0x3f), 0x80 | (charCode & 0x3f));
    } else {
      // surrogate pair
      i++;
      charCode = 0x10000 + (((charCode & 0x3ff) << 10) | (message.charCodeAt(i) & 0x3ff));
      msgBytes.push(
        0xf0 | (charCode >> 18),
        0x80 | ((charCode >> 12) & 0x3f),
        0x80 | ((charCode >> 6) & 0x3f),
        0x80 | (charCode & 0x3f),
      );
    }
  }

  const l = msgBytes.length * 8;
  msgBytes.push(0x80);
  while ((msgBytes.length * 8) % 512 !== 448) {
    msgBytes.push(0);
  }

  // 64-bit length big-endian
  const highBits = Math.floor(l / 0x100000000);
  const lowBits = l >>> 0;
  msgBytes.push(
    (highBits >>> 24) & 0xff,
    (highBits >>> 16) & 0xff,
    (highBits >>> 8) & 0xff,
    highBits & 0xff,
    (lowBits >>> 24) & 0xff,
    (lowBits >>> 16) & 0xff,
    (lowBits >>> 8) & 0xff,
    lowBits & 0xff,
  );

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let H0 = 0x6a09e667;
  let H1 = 0xbb67ae85;
  let H2 = 0x3c6ef372;
  let H3 = 0xa54ff53a;
  let H4 = 0x510e527f;
  let H5 = 0x9b05688c;
  let H6 = 0x1f83d9ab;
  let H7 = 0x5be0cd19;

  const W = new Int32Array(64);

  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));

  for (let chunk = 0; chunk < msgBytes.length; chunk += 64) {
    for (let t = 0; t < 16; t++) {
      const idx = chunk + t * 4;
      W[t] =
        (msgBytes[idx]! << 24) | (msgBytes[idx + 1]! << 16) | (msgBytes[idx + 2]! << 8) | msgBytes[idx + 3]!;
    }

    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, W[t - 15]!) ^ rotr(18, W[t - 15]!) ^ (W[t - 15]! >>> 3);
      const s1 = rotr(17, W[t - 2]!) ^ rotr(19, W[t - 2]!) ^ (W[t - 2]! >>> 10);
      W[t] = (W[t - 16]! + s0 + W[t - 7]! + s1) | 0;
    }

    let a = H0;
    let b = H1;
    let c = H2;
    let d = H3;
    let e = H4;
    let f = H5;
    let g = H6;
    let h = H7;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t]! + W[t]!) | 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    H0 = (H0 + a) | 0;
    H1 = (H1 + b) | 0;
    H2 = (H2 + c) | 0;
    H3 = (H3 + d) | 0;
    H4 = (H4 + e) | 0;
    H5 = (H5 + f) | 0;
    H6 = (H6 + g) | 0;
    H7 = (H7 + h) | 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return (
    toHex(H0) +
    toHex(H1) +
    toHex(H2) +
    toHex(H3) +
    toHex(H4) +
    toHex(H5) +
    toHex(H6) +
    toHex(H7)
  ).toLowerCase();
}

/**
 * Returns content hash in format 'sha256:<64 hex digits>' matching database constraint
 * CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$')
 */
export function computeContentHash(value: unknown): string {
  const canonical = canonicalJsonStringify(value);
  return `sha256:${sha256Raw(canonical)}`;
}
