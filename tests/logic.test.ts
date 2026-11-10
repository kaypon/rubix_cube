// Run: npm test. Checks our geometry + notation against cubejs's own model,
// then round-trips scrambles through the real solver.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseMove, parseAlg, invertMove, nameTurn, randomScramble } from "../src/cube/notation.ts";
import { faceletPlacement, faceletIndex, checkCube, type Vec3 } from "../src/cube/facelets.ts";
import { rotateVec, AXIS_INDEX } from "../src/cube/rotate.ts";

const require = createRequire(import.meta.url);
const Cube = require("cubejs");

type Sticker = { pos: Vec3; normal: Vec3; color: number };

const solvedStickers = (): Sticker[] =>
  Array.from({ length: 54 }, (_, i) => ({ ...faceletPlacement(i), color: Math.floor(i / 9) }));

function apply(stickers: Sticker[], moves: string[]) {
  for (const name of moves) {
    const t = parseMove(name);
    for (const s of stickers) {
      if (!t.layers.includes(s.pos[AXIS_INDEX[t.axis]])) continue;
      s.pos = rotateVec(s.pos, t.axis, t.quarters);
      s.normal = rotateVec(s.normal, t.axis, t.quarters);
    }
  }
}

function colorsOf(stickers: Sticker[]): number[] {
  const out = new Array(54);
  for (const s of stickers) out[faceletIndex(s.pos, s.normal)] = s.color;
  return out;
}

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

test("solved cube checks out as solved", () => {
  const r = checkCube(colorsOf(solvedStickers()));
  assert.ok(r.ok && r.solved);
  assert.equal(r.ok && r.facelets, new Cube().asString());
});

test("every face move matches cubejs", () => {
  for (const m of ["U", "R", "F", "D", "L", "B", "U'", "R2", "F'", "D2", "L'", "B2"]) {
    const s = solvedStickers();
    apply(s, [m]);
    const r = checkCube(colorsOf(s));
    assert.ok(r.ok, m);
    assert.equal(r.ok && r.facelets, new Cube().move(m).asString(), `move ${m}`);
  }
});

test("long algorithm matches cubejs", () => {
  const alg = "R U R' U' F2 D L' B R2 U2 F' L D' B2";
  const s = solvedStickers();
  apply(s, parseAlg(alg));
  const r = checkCube(colorsOf(s));
  assert.equal(r.ok && r.facelets, new Cube().move(alg).asString());
});

test("inverse undoes a move", () => {
  for (const m of ["R", "U'", "F2", "M", "E'", "S", "x", "y'", "z2"]) {
    const s = solvedStickers();
    apply(s, [m, invertMove(m)]);
    const r = checkCube(colorsOf(s));
    assert.ok(r.ok && r.solved, m);
  }
});

test("nameTurn names drag turns", () => {
  assert.equal(nameTurn("x", 1, -1), "R");
  assert.equal(nameTurn("x", 1, 1), "R'");
  assert.equal(nameTurn("y", -1, 1), "D");
  assert.equal(nameTurn("z", 1, 2), "F2");
  assert.equal(nameTurn("x", 0, 1), "M");
  assert.equal(nameTurn("y", 1, 4), null);
});

test("impossible cubes get a specific reason", () => {
  const colors = colorsOf(solvedStickers());
  const twisted = [...colors];
  // Rotate the URF corner's three stickers: U9 -> R1 -> F3.
  [twisted[8], twisted[9], twisted[20]] = [colors[20], colors[8], colors[9]];
  assert.deepEqual(checkCube(twisted), { ok: false, reason: "one corner is twisted" });

  const flipped = [...colors];
  [flipped[5], flipped[10]] = [colors[10], colors[5]]; // UR edge
  assert.deepEqual(checkCube(flipped), { ok: false, reason: "one edge is flipped" });

  const blank = [...colors];
  blank[0] = -1;
  assert.deepEqual(checkCube(blank), { ok: false, reason: "1 sticker still blank" });
});

test("solver solves random scrambles (with slices and rotations mixed in)", () => {
  Cube.initSolver();
  for (let n = 0; n < 15; n++) {
    const s = solvedStickers();
    const scramble = [...randomScramble(25), ...(n % 2 ? ["M", "y", "S'"] : [])];
    apply(s, scramble);
    const r = checkCube(colorsOf(s));
    assert.ok(r.ok, "scramble is valid");
    const solution = Cube.fromString(r.facelets).solve();
    apply(s, parseAlg(solution));
    const after = checkCube(colorsOf(s));
    assert.ok(after.ok && after.solved, `scramble ${scramble.join(" ")} → ${solution}`);
  }
});

console.log(`\n${passed} passed`);
