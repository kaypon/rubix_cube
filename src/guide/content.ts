// The solving guide: a beginner's layer-by-layer method, plus how the Solve
// button's computer solver differs. Every `alg` is playable on the demo cube:
// it's set up by running the inverse on a solved cube, then played forward,
// so you watch exactly that case get solved.

export interface Demo {
  label: string;
  alg: string;
  /** Whole-cube turn applied first, e.g. "z2" to hold white on the bottom. */
  hold?: string;
}

export interface Step {
  title: string;
  body: string[];
  demos: Demo[];
}

export const INTRO = [
  "Nobody solves a cube by staring at all 54 stickers. You solve it a layer at a time, using a handful of move sequences that move a few pieces and put everything else back where it was.",
  "Tap any sequence to watch it on the cube above. You can drag that cube around too.",
];

export const NOTATION = {
  body: [
    "Each letter is a face: U up, D down, L left, R right, F front, B back. A letter alone means turn that face clockwise, as if you were looking straight at it. A prime (R′) means counter-clockwise. A 2 (R2) means half a turn.",
    "Centers never move against each other, so they tell you each face's colour. Edges have two stickers, corners have three. You never place stickers. You place pieces.",
  ],
  moves: ["R", "R'", "R2", "U", "F", "L", "D", "B"],
};

export const STEPS: Step[] = [
  {
    title: "White cross",
    body: [
      "White on top. Make a plus sign of white edges, each one's other colour matching the center beside it.",
      "No sequence to learn here: turn the bottom until an edge sits under its spot, then turn its side twice to bring it up.",
    ],
    demos: [{ label: "D′ R2", alg: "D' R2" }],
  },
  {
    title: "White corners",
    body: [
      "Flip the cube so white is on the bottom. Find a white corner in the top layer and park it right above where it belongs, at the front right.",
      "Repeat R U R′ U′ until it drops in, white side down. Every corner takes one, three or five goes.",
    ],
    demos: [{ label: "(R U R′ U′) ×3", alg: "R U R' U' R U R' U' R U R' U'", hold: "z2" }],
  },
  {
    title: "Middle layer",
    body: [
      "Find a top edge with no yellow on it. Turn the top until its front colour matches the center below, then send it down to whichever side its top colour belongs to.",
      "If an edge is stuck in the middle the wrong way round, send any edge into its slot to knock it out, then insert it properly.",
    ],
    demos: [
      { label: "Send right: U R U′ R′ U′ F′ U F", alg: "U R U' R' U' F' U F", hold: "z2" },
      { label: "Send left: U′ L′ U L U F U′ F′", alg: "U' L' U L U F U' F'", hold: "z2" },
    ],
  },
  {
    title: "Yellow cross",
    body: [
      "Ignore the sides for now; you only want a yellow plus on top. F R U R′ U′ F′ takes you from a dot, to an L, to a line, to the cross.",
      "Hold the L at back left, and the line left to right, before each go.",
    ],
    demos: [{ label: "F R U R′ U′ F′", alg: "F R U R' U' F'", hold: "z2" }],
  },
  {
    title: "Yellow edges",
    body: [
      "Turn the top until two edges match their side centers. This swaps the front and left edges; repeat until all four match.",
    ],
    demos: [{ label: "R U R′ U R U2 R′ U", alg: "R U R' U R U2 R' U", hold: "z2" }],
  },
  {
    title: "Yellow corners, placed",
    body: [
      "Get each yellow corner into the right spot. Its twist doesn't matter yet. This cycles three corners and leaves the front-right one where it is.",
    ],
    demos: [{ label: "U R U′ L′ U R′ U′ L", alg: "U R U' L' U R' U' L", hold: "z2" }],
  },
  {
    title: "Yellow corners, twisted",
    body: [
      "Hold an unfinished corner at front right. Repeat R′ D′ R D until its yellow faces up. Halfway through the cube looks wrecked: keep going.",
      "Then turn only the top to bring the next corner to front right, and repeat. Never turn the whole cube during this step. Finish with a turn of the top.",
    ],
    demos: [
      {
        label: "(R′ D′ R D) ×2, U, (R′ D′ R D) ×4, U′",
        alg: "R' D' R D R' D' R D U R' D' R D R' D' R D R' D' R D R' D' R D U'",
        hold: "z2",
      },
    ],
  },
];

export const COMPUTER = [
  "The Solve button doesn't use any of that. It runs Herbert Kociemba's two-phase algorithm, which thinks about the cube very differently.",
  "Phase one hunts for moves that land the cube in a smaller, tamer set of positions: every piece facing a legal way, and the four middle-layer edges somewhere in the middle layer. Phase two finishes from there using only U, D and half turns of the sides, moves that can't undo what phase one fixed.",
  "Both phases lean on big precomputed tables of how far each position is from done, so the search skips hopeless branches. It stops at the first answer of 22 moves or fewer, which is why you see about 20.",
  "There are about 43 quintillion positions, and none needs more than 20 moves. That was proved in 2010 with a lot of borrowed Google computer time.",
  "It's also why some painted cubes can't be solved: only one stickering in twelve is a real cube. A single twisted corner, flipped edge or swapped pair can't be made by turning.",
];
