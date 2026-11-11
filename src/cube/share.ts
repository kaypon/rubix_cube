// A cube state as a short link code. The six centers never move in a facelet
// string, so only the other 48 stickers are stored: 48 base-6 digits fit in
// 124 bits, which is 21 URL-safe base64 characters.

import { FACES } from "./facelets.ts";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CODE_LENGTH = 21;
const STORED = Array.from({ length: 54 }, (_, i) => i).filter((i) => i % 9 !== 4);

export function encodeFacelets(facelets: string): string {
  let n = 0n;
  for (const i of STORED) n = n * 6n + BigInt(FACES.indexOf(facelets[i] as (typeof FACES)[number]));
  let out = "";
  for (let k = 0; k < CODE_LENGTH; k++) {
    out = B64[Number(n & 63n)] + out;
    n >>= 6n;
  }
  return out;
}

/** The facelet string a code stands for, or null if it isn't one of ours. Still needs checkCube. */
export function decodeFacelets(code: string): string | null {
  if (code.length !== CODE_LENGTH) return null;
  let n = 0n;
  for (const ch of code) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    n = (n << 6n) | BigInt(v);
  }
  const out = new Array<string>(54);
  FACES.forEach((f, i) => (out[i * 9 + 4] = f));
  for (let k = STORED.length - 1; k >= 0; k--) {
    out[STORED[k]] = FACES[Number(n % 6n)];
    n /= 6n;
  }
  return n === 0n ? out.join("") : null;
}
