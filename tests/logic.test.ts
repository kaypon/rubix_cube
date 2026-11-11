// Run: npm test. Checks our geometry + notation against cubejs's own model,
// then round-trips scrambles through the real solver.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  parseMove,
  parseAlg,
  invertMove,
  invertAlg,
  nameTurn,
  randomScramble,
  remapMove,
  frameFromVectors,
  UPRIGHT,
} from "../src/cube/notation.ts";
import { colorsAfter, colorsFromFacelets } from "../src/cube/state.ts";
import { encodeFacelets, decodeFacelets } from "../src/cube/share.ts";
import { averageOf, best, formatMs, mean } from "../src/timer/stats.ts";
import {
  cleanName,
  qualifies,
  validMs,
  encodeMember,
  decodeMember,
  entriesFromRange,
  keyPrefix,
} from "../api/_board.js";
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

const ALL_MOVES = ["U", "R", "F", "D", "L", "B", "M", "E", "S", "x", "y", "z"].flatMap((m) => [m, `${m}'`, `${m}2`]);

test("colorsAfter matches the sticker model and cubejs", () => {
  const alg = parseAlg("R U R' U' F2 D L' B R2 U2 F' L D' B2");
  const s = solvedStickers();
  apply(s, alg);
  assert.deepEqual(colorsAfter(alg), colorsOf(s));
  const r = checkCube(colorsAfter(alg));
  assert.equal(r.ok && r.facelets, new Cube().move(alg.join(" ")).asString());
});

test("share codes round-trip and are 21 URL-safe characters", () => {
  for (let n = 0; n < 200; n++) {
    const scramble = randomScramble(25);
    const r = checkCube(colorsAfter(scramble));
    assert.ok(r.ok);
    const code = encodeFacelets(r.facelets);
    assert.match(code, /^[A-Za-z0-9_-]{21}$/);
    assert.equal(decodeFacelets(code), r.facelets);
    // Face turns never move centers, so the letters map straight back to colours.
    assert.deepEqual(colorsFromFacelets(r.facelets), colorsAfter(scramble));
  }
  const solved = new Cube().asString();
  assert.equal(decodeFacelets(encodeFacelets(solved)), solved);
});

test("bad share codes are refused", () => {
  assert.equal(decodeFacelets(""), null);
  assert.equal(decodeFacelets("short"), null);
  assert.equal(decodeFacelets("!!!!!!!!!!!!!!!!!!!!!"), null);
  assert.equal(decodeFacelets("_____________________"), null); // bigger than 6^48
});

test("upright view leaves every move alone", () => {
  for (const m of ALL_MOVES) assert.equal(remapMove(m, UPRIGHT), m);
});

test("moves follow the view once the cube is turned (any way up)", () => {
  // Turning the view by r is the same as doing r, the move, then undoing r.
  const inverseDir = (r: string[], v: Vec3): Vec3 =>
    invertAlg(r).reduce((acc, name) => {
      const t = parseMove(name);
      return rotateVec(acc, t.axis, t.quarters);
    }, v);
  const views = [["x"], ["x2"], ["y'"], ["z"], ["x", "y"], ["z2", "y"], ["x'", "z"], ["y", "x2"]];
  const start = randomScramble(12);
  for (const r of views) {
    const frame = frameFromVectors(inverseDir(r, [0, 1, 0]), inverseDir(r, [1, 0, 0]), inverseDir(r, [0, 0, 1]));
    for (const m of ALL_MOVES) {
      const expected = colorsAfter([...start, ...r, m, ...invertAlg(r)]);
      assert.deepEqual(colorsAfter([...start, remapMove(m, frame)]), expected, `view ${r.join(" ")}, move ${m}`);
    }
  }
});

test("frameFromVectors always picks three different axes", () => {
  const f = frameFromVectors([0.1, 0.9, 0.4], [0.2, 0.8, 0.1], [0.3, 0.7, 0.6]);
  assert.equal(new Set([f.up.axis, f.right.axis, f.front.axis]).size, 3);
  assert.deepEqual(f.up, { axis: "y", sign: 1 });
});

test("timer stats: formatting and WCA averages", () => {
  assert.equal(formatMs(8419), "8.41");
  assert.equal(formatMs(0), "0.00");
  assert.equal(formatMs(62_057), "1:02.05");
  assert.equal(formatMs(null), "--");
  assert.equal(best([9000, 8000, 12000]), 8000);
  assert.equal(mean([1000, 2000]), 1500);
  assert.equal(averageOf([1, 2, 3, 4].map((s) => s * 1000), 5), null);
  // Last 5 of these: 10, 30, 11, 12, 9 → drop 9 and 30 → mean(10, 11, 12) = 11.
  assert.equal(averageOf([50, 10, 30, 11, 12, 9].map((s) => s * 1000), 5), 11000);
});

test("board rules: names, times, and who qualifies", () => {
  assert.equal(cleanName("  kev   dot "), "kev dot");
  assert.equal(cleanName("Zoë!"), "Zoë!");
  assert.equal(cleanName(""), null);
  assert.equal(cleanName("a".repeat(13)), null);
  assert.equal(cleanName("<script>"), null);
  assert.equal(cleanName("a|b"), null);
  assert.equal(cleanName(42), null);
  assert.ok(validMs(3000) && !validMs(2999) && !validMs(4000.5) && !validMs("5000"));
  const board = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, name: "x", ms: 10_000 + i * 1000, at: 0 }));
  assert.ok(qualifies(board, 18_999));
  assert.ok(!qualifies(board, 19_000), "a tie with 10th doesn't get in");
  assert.ok(qualifies(board.slice(0, 4), 50_000), "an unfull board takes anything legal");
  assert.ok(!qualifies([], 2500));
});

test("board entries survive the trip through Redis members", () => {
  const m = encodeMember("KEV", 1762862400000, "ab12cd34");
  assert.deepEqual(decodeMember(m, "8410", 1), { rank: 1, name: "KEV", ms: 8410, at: 1762862400000 });
  const early = encodeMember("A", 5, "ffffffff");
  const late = encodeMember("B", 1762862400000, "00000000");
  assert.ok(early < late, "equal times: the earlier post sorts first");
  assert.deepEqual(
    entriesFromRange([m, 8410, "junk", 9000, late, "9100"]).map((e) => [e.rank, e.name, e.ms]),
    [[1, "KEV", 8410], [2, "B", 9100]],
  );
  assert.equal(keyPrefix("production"), "cube:");
  assert.equal(keyPrefix("preview"), "cube-dev:");
  assert.equal(keyPrefix(undefined), "cube-dev:");
});

test("a shared cube's mix (the solution undone) rebuilds it from solved", () => {
  for (let n = 0; n < 8; n++) {
    const r = checkCube(colorsAfter(randomScramble(25)));
    assert.ok(r.ok);
    const mix = invertAlg(parseAlg(Cube.fromString(r.facelets).solve()));
    const rebuilt = checkCube(colorsAfter(mix));
    assert.equal(rebuilt.ok && rebuilt.facelets, r.facelets);
  }
});

console.log(`\n${passed} passed`);
