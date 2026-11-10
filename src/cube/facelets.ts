// Sticker geometry <-> the 54-character facelet string the solver speaks,
// plus a cubie-level sanity check so we can say *why* a painted cube is
// impossible instead of handing the solver garbage.
//
// Facelet order is Kociemba's: U1..U9 R1..R9 F1..F9 D1..D9 L1..L9 B1..B9,
// each face read left-to-right, top-to-bottom as you look straight at it
// (U with B at the top, D with F at the top, the side faces with U on top).

export const FACES = ["U", "R", "F", "D", "L", "B"] as const;
export type FaceLetter = (typeof FACES)[number];

export type Vec3 = [number, number, number];

/** Colour ids. -1 = unpainted. Default scheme: white top, green front. */
export const COLOR_NAMES = ["white", "red", "green", "yellow", "orange", "blue"] as const;
export const UNPAINTED = -1;

/** Position and outward normal of facelet `index` (0..53). */
export function faceletPlacement(index: number): { pos: Vec3; normal: Vec3 } {
  const face = FACES[Math.floor(index / 9)];
  const r = Math.floor((index % 9) / 3);
  const c = index % 3;
  switch (face) {
    case "U": return { pos: [c - 1, 1, r - 1], normal: [0, 1, 0] };
    case "R": return { pos: [1, 1 - r, 1 - c], normal: [1, 0, 0] };
    case "F": return { pos: [c - 1, 1 - r, 1], normal: [0, 0, 1] };
    case "D": return { pos: [c - 1, -1, 1 - r], normal: [0, -1, 0] };
    case "L": return { pos: [-1, 1 - r, c - 1], normal: [-1, 0, 0] };
    case "B": return { pos: [1 - c, 1 - r, -1], normal: [0, 0, -1] };
  }
}

const key = (pos: Vec3, normal: Vec3) => `${pos.join(",")}|${normal.join(",")}`;

const INDEX_BY_PLACEMENT = new Map<string, number>();
for (let i = 0; i < 54; i++) {
  const { pos, normal } = faceletPlacement(i);
  INDEX_BY_PLACEMENT.set(key(pos, normal), i);
}

export function faceletIndex(pos: Vec3, normal: Vec3): number {
  const i = INDEX_BY_PLACEMENT.get(key(pos, normal));
  if (i === undefined) throw new Error(`No facelet at ${key(pos, normal)}`);
  return i;
}

export const CENTER_INDICES = [4, 13, 22, 31, 40, 49];

// --- Cubie model (Kociemba's corner/edge numbering) -----------------------

const F = (face: FaceLetter, n: number) => FACES.indexOf(face) * 9 + (n - 1);

const CORNER_FACELETS = [
  [F("U", 9), F("R", 1), F("F", 3)], // URF
  [F("U", 7), F("F", 1), F("L", 3)], // UFL
  [F("U", 1), F("L", 1), F("B", 3)], // ULB
  [F("U", 3), F("B", 1), F("R", 3)], // UBR
  [F("D", 3), F("F", 9), F("R", 7)], // DFR
  [F("D", 1), F("L", 9), F("F", 7)], // DLF
  [F("D", 7), F("B", 9), F("L", 7)], // DBL
  [F("D", 9), F("R", 9), F("B", 7)], // DRB
];
const CORNER_COLORS: FaceLetter[][] = [
  ["U", "R", "F"], ["U", "F", "L"], ["U", "L", "B"], ["U", "B", "R"],
  ["D", "F", "R"], ["D", "L", "F"], ["D", "B", "L"], ["D", "R", "B"],
];
const EDGE_FACELETS = [
  [F("U", 6), F("R", 2)], [F("U", 8), F("F", 2)], [F("U", 4), F("L", 2)], [F("U", 2), F("B", 2)],
  [F("D", 6), F("R", 8)], [F("D", 2), F("F", 8)], [F("D", 4), F("L", 8)], [F("D", 8), F("B", 8)],
  [F("F", 6), F("R", 4)], [F("F", 4), F("L", 6)], [F("B", 6), F("L", 4)], [F("B", 4), F("R", 6)],
];
const EDGE_COLORS: FaceLetter[][] = [
  ["U", "R"], ["U", "F"], ["U", "L"], ["U", "B"], ["D", "R"], ["D", "F"],
  ["D", "L"], ["D", "B"], ["F", "R"], ["F", "L"], ["B", "L"], ["B", "R"],
];

export type CheckResult =
  | { ok: true; facelets: string; solved: boolean }
  | { ok: false; reason: string };

function parity(perm: number[]): number {
  let p = 0;
  for (let i = 0; i < perm.length; i++)
    for (let j = i + 1; j < perm.length; j++) if (perm[i] > perm[j]) p ^= 1;
  return p;
}

/**
 * Check a cube described by 54 colour ids (in facelet order) and, if it's a
 * reachable state, return the facelet string. Reasons are written for the
 * person holding the cube, not for the solver.
 */
export function checkCube(colors: number[]): CheckResult {
  const unpainted = colors.filter((c) => c === UNPAINTED).length;
  if (unpainted > 0)
    return { ok: false, reason: `${unpainted} sticker${unpainted === 1 ? "" : "s"} still blank` };

  const counts = new Array(6).fill(0);
  colors.forEach((c) => counts[c]++);
  for (let c = 0; c < 6; c++) {
    if (counts[c] !== 9) {
      const diff = counts[c] - 9;
      return {
        ok: false,
        reason: `${COLOR_NAMES[c]}: ${counts[c]} of 9 (${diff > 0 ? `${diff} too many` : `${-diff} short`})`,
      };
    }
  }

  const centerColors = CENTER_INDICES.map((i) => colors[i]);
  if (new Set(centerColors).size !== 6) return { ok: false, reason: "two centers share a colour" };
  const letterOf = new Map<number, FaceLetter>();
  centerColors.forEach((c, f) => letterOf.set(c, FACES[f]));
  const facelets = colors.map((c) => letterOf.get(c)!).join("");

  const opposite: Record<FaceLetter, FaceLetter> = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };

  const cp: number[] = [];
  const co: number[] = [];
  for (let i = 0; i < 8; i++) {
    const f = CORNER_FACELETS[i].map((idx) => facelets[idx] as FaceLetter);
    const ori = f.findIndex((l) => l === "U" || l === "D");
    const pair = ori < 0 ? null : [f[(ori + 1) % 3], f[(ori + 2) % 3]];
    const j = pair ? CORNER_COLORS.findIndex((cc) => cc[1] === pair[0] && cc[2] === pair[1]) : -1;
    if (j < 0) {
      const hasOpposites = f.some((a) => f.includes(opposite[a]));
      return {
        ok: false,
        reason: hasOpposites
          ? "a corner has two opposite colours on it"
          : "a corner has its colours in an impossible order",
      };
    }
    cp.push(j);
    co.push(ori);
  }

  const ep: number[] = [];
  const eo: number[] = [];
  for (let i = 0; i < 12; i++) {
    const [a, b] = EDGE_FACELETS[i].map((idx) => facelets[idx] as FaceLetter);
    let j = EDGE_COLORS.findIndex((ec) => ec[0] === a && ec[1] === b);
    let o = 0;
    if (j < 0) {
      j = EDGE_COLORS.findIndex((ec) => ec[0] === b && ec[1] === a);
      o = 1;
    }
    if (j < 0) {
      return {
        ok: false,
        reason: a === b ? "an edge has the same colour twice" : "an edge has two opposite colours",
      };
    }
    ep.push(j);
    eo.push(o);
  }

  if (new Set(cp).size !== 8) return { ok: false, reason: "the same corner appears twice" };
  if (new Set(ep).size !== 12) return { ok: false, reason: "the same edge appears twice" };
  if (eo.reduce((s, v) => s + v, 0) % 2) return { ok: false, reason: "one edge is flipped" };
  if (co.reduce((s, v) => s + v, 0) % 3) return { ok: false, reason: "one corner is twisted" };
  if (parity(cp) !== parity(ep)) return { ok: false, reason: "two pieces are swapped" };

  const solved = FACES.every((_, f) => {
    const face = facelets.slice(f * 9, f * 9 + 9);
    return [...face].every((l) => l === face[4]);
  });
  return { ok: true, facelets, solved };
}
