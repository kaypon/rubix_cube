// Cube notation <-> geometric turns.
//
// Coordinates: x points at R, y at U, z at F. Cubies sit on integer
// coordinates -1..1. A turn rotates every cubie whose coordinate on `axis`
// is in `layers` by `quarters` × 90°, positive = counter-clockwise looking
// down the positive axis (right-hand rule).

export type Axis = "x" | "y" | "z";

export interface Turn {
  axis: Axis;
  layers: number[];
  /** Signed quarter turns about the positive axis: ±1 or ±2. */
  quarters: number;
}

interface Base {
  axis: Axis;
  layers: number[];
  /** Quarter-turn sign of the move's clockwise direction. */
  sign: 1 | -1;
}

const ALL = [-1, 0, 1];

const BASES: Record<string, Base> = {
  R: { axis: "x", layers: [1], sign: -1 },
  L: { axis: "x", layers: [-1], sign: 1 },
  U: { axis: "y", layers: [1], sign: -1 },
  D: { axis: "y", layers: [-1], sign: 1 },
  F: { axis: "z", layers: [1], sign: -1 },
  B: { axis: "z", layers: [-1], sign: 1 },
  M: { axis: "x", layers: [0], sign: 1 },
  E: { axis: "y", layers: [0], sign: 1 },
  S: { axis: "z", layers: [0], sign: -1 },
  x: { axis: "x", layers: ALL, sign: -1 },
  y: { axis: "y", layers: ALL, sign: -1 },
  z: { axis: "z", layers: ALL, sign: -1 },
};

const MOVE_RE = /^([URFDLBMESxyz])(2|')?$/;

export function isMove(name: string): boolean {
  return MOVE_RE.test(name);
}

export function parseMove(name: string): Turn {
  const m = MOVE_RE.exec(name);
  if (!m) throw new Error(`Unknown move: ${name}`);
  const base = BASES[m[1]];
  const amount = m[2] === "2" ? 2 : m[2] === "'" ? -1 : 1;
  return { axis: base.axis, layers: base.layers, quarters: base.sign * amount };
}

export function parseAlg(alg: string): string[] {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((m) => m.replace("’", "'"));
}

export function invertMove(name: string): string {
  if (name.endsWith("2")) return name;
  if (name.endsWith("'")) return name.slice(0, -1);
  return `${name}'`;
}

/** Name the single-layer move a drag produced, e.g. axis x, layer 1, +1 → R'. */
export function nameTurn(axis: Axis, layer: number, quarters: number): string | null {
  const q = ((quarters % 4) + 4) % 4; // 0..3, positive direction
  if (q === 0) return null;
  for (const [face, base] of Object.entries(BASES)) {
    if (base.axis !== axis || base.layers.length !== 1 || base.layers[0] !== layer) continue;
    if (q === 2) return `${face}2`;
    const clockwise = (q === 1 ? 1 : -1) === base.sign;
    return clockwise ? face : `${face}'`;
  }
  return null;
}

/** Undo a whole sequence: reversed, each move inverted. */
export function invertAlg(moves: string[]): string[] {
  return moves.slice().reverse().map(invertMove);
}

// --- moves relative to the view -------------------------------------------
//
// Once the cube can be turned upside down, "U" on the keyboard should mean
// the face on top of the screen, not the face that started there. A frame
// says which cube axis (and which end of it) points screen-up, screen-right
// and out of the screen; remapMove turns a screen-relative move into the
// cube's own notation.

export interface Dir {
  axis: Axis;
  sign: 1 | -1;
}
export interface ViewFrame {
  up: Dir;
  right: Dir;
  front: Dir;
}

export const UPRIGHT: ViewFrame = {
  up: { axis: "y", sign: 1 },
  right: { axis: "x", sign: 1 },
  front: { axis: "z", sign: 1 },
};

type V3 = [number, number, number];
const AXIS_LIST: Axis[] = ["x", "y", "z"];

/**
 * Snap three screen directions (given in cube coordinates) to cube axes.
 * Up wins its axis first, then right picks from what's left, and front
 * takes the last one, so the three always come out distinct.
 */
export function frameFromVectors(up: V3, right: V3, front: V3): ViewFrame {
  const pick = (v: V3, from: number[]): Dir => {
    const i = from.reduce((best, j) => (Math.abs(v[j]) > Math.abs(v[best]) ? j : best), from[0]);
    return { axis: AXIS_LIST[i], sign: v[i] < 0 ? -1 : 1 };
  };
  const u = pick(up, [0, 1, 2]);
  const r = pick(right, [0, 1, 2].filter((i) => AXIS_LIST[i] !== u.axis));
  const f = pick(front, [0, 1, 2].filter((i) => AXIS_LIST[i] !== u.axis && AXIS_LIST[i] !== r.axis));
  return { up: u, right: r, front: f };
}

const flip = (d: Dir): Dir => ({ axis: d.axis, sign: d.sign === 1 ? -1 : 1 });
const FACE_AT: Record<Axis, [string, string]> = { x: ["L", "R"], y: ["D", "U"], z: ["B", "F"] };
// Each slice turns like one face: M like L, E like D, S like F.
const SLICE: Record<Axis, { name: string; like: 1 | -1 }> = {
  x: { name: "M", like: -1 },
  y: { name: "E", like: -1 },
  z: { name: "S", like: 1 },
};

export function remapMove(name: string, frame: ViewFrame): string {
  const m = MOVE_RE.exec(name);
  if (!m) throw new Error(`Unknown move: ${name}`);
  const [, letter, suffix = ""] = m;
  const screen: Record<string, Dir> = {
    U: frame.up,
    D: flip(frame.up),
    R: frame.right,
    L: flip(frame.right),
    F: frame.front,
    B: flip(frame.front),
  };
  let base: string;
  let prime = false;
  if (letter in screen) {
    const d = screen[letter];
    base = FACE_AT[d.axis][d.sign === 1 ? 1 : 0];
  } else if (letter === "M" || letter === "E" || letter === "S") {
    const d = letter === "M" ? screen.L : letter === "E" ? screen.D : screen.F;
    base = SLICE[d.axis].name;
    prime = d.sign !== SLICE[d.axis].like;
  } else {
    // x turns like R, y like U, z like F.
    const d = letter === "x" ? screen.R : letter === "y" ? screen.U : screen.F;
    base = d.axis;
    prime = d.sign === -1;
  }
  if (suffix === "2") return `${base}2`;
  return prime !== (suffix === "'") ? `${base}'` : base;
}

const FACE_MOVES = ["U", "D", "R", "L", "F", "B"];
const AXIS_OF: Record<string, Axis> = { U: "y", D: "y", R: "x", L: "x", F: "z", B: "z" };

/** A random-move scramble that never turns the same axis twice in a row. */
export function randomScramble(length = 22): string[] {
  const out: string[] = [];
  let lastAxis: Axis | null = null;
  while (out.length < length) {
    const face = FACE_MOVES[Math.floor(Math.random() * 6)];
    if (AXIS_OF[face] === lastAxis) continue;
    lastAxis = AXIS_OF[face];
    out.push(face + ["", "'", "2"][Math.floor(Math.random() * 3)]);
  }
  return out;
}
