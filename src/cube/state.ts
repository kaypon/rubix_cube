// A cube with no 3D: 54 stickers as (position, normal, colour), turned by the
// same notation the 3D view uses. For pages and tests that need to know what
// a sequence does without rendering it.

import { parseMove } from "./notation.ts";
import { faceletIndex, faceletPlacement, type Vec3 } from "./facelets.ts";
import { AXIS_INDEX, rotateVec } from "./rotate.ts";

/** The 54 colour ids (facelet order) after applying `moves` to a solved cube. */
export function colorsAfter(moves: string[]): number[] {
  const stickers = Array.from({ length: 54 }, (_, i) => ({ ...faceletPlacement(i), color: Math.floor(i / 9) }));
  for (const name of moves) {
    const t = parseMove(name);
    for (const s of stickers) {
      if (!t.layers.includes(s.pos[AXIS_INDEX[t.axis]])) continue;
      s.pos = rotateVec(s.pos, t.axis, t.quarters);
      s.normal = rotateVec(s.normal, t.axis, t.quarters);
    }
  }
  const out = new Array<number>(54);
  for (const s of stickers) out[faceletIndex(s.pos as Vec3, s.normal as Vec3)] = s.color;
  return out;
}

/** Facelet letters (as checkCube returns them) back to colour ids. */
export function colorsFromFacelets(facelets: string): number[] {
  return [...facelets].map((l) => "URFDLB".indexOf(l));
}
