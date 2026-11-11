import "./style.css";
import { CubeView, STICKER_HEX, type Screen } from "./cube/CubeView.ts";
import { checkCube, COLOR_NAMES } from "./cube/facelets.ts";
import { invertAlg, invertMove, isMove, randomScramble } from "./cube/notation.ts";
import { solve, solverReady } from "./solver/client.ts";
import { decodeFacelets, encodeFacelets } from "./cube/share.ts";
import { colorsFromFacelets } from "./cube/state.ts";
import { SKINS, type SkinName } from "./cube/skins.ts";
import { Guide } from "./guide/guide.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const view = new CubeView($("stage"));
view.canvas.tabIndex = 0;
view.canvas.setAttribute("role", "img");
view.canvas.setAttribute(
  "aria-label",
  "A Rubik's cube. Drag a face to turn it, drag around it to look around, or type U R F D L B (hold Shift to turn the other way).",
);

const ui = {
  hint: $<HTMLParagraphElement>("hint"),
  palette: $("palette"),
  swatches: $("swatches"),
  timeline: $("timeline"),
  moves: $<HTMLOListElement>("moves"),
  play: $<HTMLButtonElement>("play"),
  paint: $<HTMLButtonElement>("paint"),
  solve: $<HTMLButtonElement>("solve"),
  explode: $<HTMLButtonElement>("explode"),
  speed: $<HTMLInputElement>("speed"),
};

const DEFAULT_HINT = "[ DRAG A FACE TO TURN IT ]";
const PAINT_HINT = "[ HOLD YOUR CUBE WHITE ON TOP, GREEN FACING YOU. PAINT WHAT YOU SEE ]";

type Tone = "plain" | "alert" | "win" | "raw";
function hint(text: string, tone: Tone = "plain") {
  ui.hint.textContent = text;
  ui.hint.classList.toggle("cube-hint--alert", tone === "alert");
  ui.hint.classList.toggle("cube-hint--win", tone === "win");
  ui.hint.classList.toggle("cube-hint--raw", tone === "raw");
}

const pretty = (m: string) => m.replace("'", "′");

// --- sequence playback ----------------------------------------------------
//
// One timeline, two uses: a solution (from here to solved) or a mix (from
// solved to here, one move at a time, so you can copy it onto a real cube).

type Sequence = { kind: "solve" | "mix"; moves: string[]; index: number; doneHint?: string };
let solution: Sequence | null = null;
let playing = false;
let wasSolved = true;
let lastQueued: Promise<void> = Promise.resolve();

function queue(name: string, scale = 1): Promise<void> {
  lastQueued = view.enqueue(name, scale);
  return lastQueued;
}

function dropSolution() {
  solution = null;
  playing = false;
  ui.timeline.hidden = true;
  renderTimeline();
}

function renderTimeline() {
  ui.play.textContent = playing ? "Pause" : "Play";
  if (!solution) return;
  const { moves, index } = solution;
  if (ui.moves.children.length !== moves.length) {
    ui.moves.replaceChildren(
      ...moves.map((m, i) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cube-move";
        b.textContent = pretty(m);
        b.setAttribute("aria-label", `Move ${i + 1}: ${m}`);
        b.addEventListener("click", () => jumpTo(i + 1));
        li.append(b);
        return li;
      }),
    );
  }
  [...ui.moves.querySelectorAll<HTMLButtonElement>(".cube-move")].forEach((b, i) => {
    b.classList.toggle("cube-move--done", i < index);
    if (i === index - 1) {
      b.setAttribute("aria-current", "step");
      b.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    } else b.removeAttribute("aria-current");
  });
  ui.moves.setAttribute("aria-label", solution.kind === "mix" ? "Mix" : "Solution");
  if (solution.kind === "mix") {
    if (index === moves.length) hint(solution.doneHint ?? `[ MIXED IN ${moves.length} MOVES. NOW SOLVE IT ]`, "win");
    else if (index === 0)
      hint(`[ START SOLVED: WHITE ON TOP, GREEN FACING YOU. FIRST MOVE ${pretty(moves[0])}. PRESS > ]`);
    else hint(`[ ${index} OF ${moves.length} DONE. NEXT ${pretty(moves[index])} ]`);
    return;
  }
  if (index === moves.length) hint(`[ ${moves.length} MOVES. DONE ]`, "win");
  else if (index === 0) hint(`[ SOLVED IN ${moves.length} MOVES. PRESS PLAY ]`);
  else hint(`[ MOVE ${index} OF ${moves.length} ]`);
}

function showSequence(seq: Sequence) {
  solution = seq;
  playing = false;
  ui.timeline.hidden = false;
  ui.moves.replaceChildren();
  renderTimeline();
}

function stepForward(scale = 1): Promise<void> | void {
  if (!solution || solution.index >= solution.moves.length) return;
  const m = solution.moves[solution.index++];
  renderTimeline();
  return queue(m, scale);
}

function stepBack(scale = 1): Promise<void> | void {
  if (!solution || solution.index <= 0) return;
  const m = solution.moves[--solution.index];
  renderTimeline();
  return queue(invertMove(m), scale);
}

async function play() {
  if (!solution) return;
  if (playing) {
    playing = false;
    renderTimeline();
    return;
  }
  if (solution.index >= solution.moves.length) jumpTo(0);
  playing = true;
  renderTimeline();
  while (playing && solution && solution.index < solution.moves.length) {
    await stepForward();
  }
  playing = false;
  renderTimeline();
}

function jumpTo(k: number) {
  if (!solution) return;
  playing = false;
  const fast = 0.35;
  while (solution.index < k) stepForward(fast);
  while (solution.index > k) stepBack(fast);
  renderTimeline();
}

// --- moves from anywhere --------------------------------------------------

view.onMove = (_name, source) => {
  if (source === "drag" && solution) dropSolution();
  const r = checkCube(view.colors());
  const solved = r.ok && r.solved;
  // Stepping a mix back to its start lands on solved too; that's no win.
  if (solved && !wasSolved && solution?.kind !== "mix") {
    view.celebrate();
    if (!solution) hint("[ SOLVED BY HAND ]", "win");
  }
  wasSolved = solved;
};

function userMove(name: string) {
  if (solution) dropSolution();
  if (view.paintMode) setPaint(false);
  queue(name);
}

// --- paint ----------------------------------------------------------------

const swatches = STICKER_HEX.map((hex, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cube-swatch";
  b.setAttribute("role", "radio");
  b.style.setProperty("--chip", `#${hex.toString(16).padStart(6, "0")}`);
  b.innerHTML = `<span class="cube-swatch__chip"></span><span class="cube-swatch__count"></span>`;
  b.addEventListener("click", () => pickColor(i));
  ui.swatches.append(b);
  return b;
});

function pickColor(i: number) {
  view.paintColor = i;
  renderPalette();
}

function renderPalette() {
  const counts = new Array(6).fill(0);
  for (const c of view.colors()) if (c >= 0) counts[c]++;
  swatches.forEach((b, i) => {
    b.setAttribute("aria-checked", String(view.paintColor === i));
    b.setAttribute("aria-label", `${COLOR_NAMES[i]}, ${counts[i]} of 9 painted`);
    b.querySelector(".cube-swatch__count")!.textContent = `${counts[i]}/9`;
    b.classList.toggle("cube-swatch--full", counts[i] === 9);
    b.classList.toggle("cube-swatch--over", counts[i] > 9);
  });
}

function setPaint(on: boolean) {
  view.paintMode = on;
  ui.paint.textContent = on ? "Done" : "Paint";
  ui.paint.setAttribute("aria-pressed", String(on));
  ui.paint.classList.toggle("cube-btn--on", on);
  ui.palette.hidden = !on;
  if (on) {
    if (solution) dropSolution();
    renderPalette();
    hint(PAINT_HINT);
  } else if (!solution) hint(DEFAULT_HINT);
}

view.onPaint = () => {
  renderPalette();
  const r = checkCube(view.colors());
  wasSolved = r.ok && r.solved;
};

// --- buttons --------------------------------------------------------------

$("scramble").addEventListener("click", () => {
  if (solution) dropSolution();
  if (view.paintMode) setPaint(false);
  const moves = randomScramble(22);
  hint(`[ ${moves.join(" ")} ]`);
  moves.forEach((m) => queue(m, 0.45));
});

// Mix: back to solved and upright, then walk through a scramble move by move.
let mixToken = 0;
$("mix").addEventListener("click", async () => {
  const token = ++mixToken;
  dropSolution();
  if (view.paintMode) setPaint(false);
  hint("[ RESETTING ]");
  // Solved isn't enough: after an x or y the centers have moved, and the mix
  // has to start from white on top, green in front.
  const atHome = view.colors().every((c, i) => c === Math.floor(i / 9));
  await Promise.all([view.uprightView(), atHome ? null : view.reset()]);
  if (token !== mixToken) return;
  wasSolved = true;
  showSequence({ kind: "mix", moves: randomScramble(20), index: 0 });
  ui.play.focus({ preventScroll: true });
});

// Share: the current state as a link. Whoever opens it gets this exact cube.
$("share").addEventListener("click", async () => {
  if (view.paintMode) setPaint(false);
  await lastQueued;
  const r = checkCube(view.colors());
  if (!r.ok) {
    hint(`[ CAN'T SHARE THAT: ${r.reason} ]`, "alert");
    return;
  }
  if (r.solved) {
    hint("[ NOTHING TO SOLVE YET. MIX IT FIRST ]");
    return;
  }
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("cube", encodeFacelets(r.facelets));
  const link = url.toString();
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: "Solve this cube", text: "Bet you can't solve this.", url: link });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }
  // A copy can be refused, or left hanging on a permission prompt; either
  // way, fall back to showing the link so it can be copied by hand.
  const copied = await Promise.race([
    navigator.clipboard?.writeText(link).then(
      () => true,
      () => false,
    ) ?? false,
    new Promise<false>((r) => setTimeout(() => r(false), 1500)),
  ]);
  if (copied) hint("[ LINK COPIED. SEND IT TO SOMEONE ]", "win");
  else hint(link, "raw");
});

ui.paint.addEventListener("click", () => setPaint(!view.paintMode));

$("clear").addEventListener("click", () => {
  view.blank();
  renderPalette();
  wasSolved = false;
});

let solving = false;
ui.solve.addEventListener("click", async () => {
  if (solving) return;
  if (view.paintMode) setPaint(false);
  if (solution?.kind === "solve") {
    // Already solved: the moves are waiting. Play is what starts them.
    ui.play.focus();
    return;
  }
  if (solution) dropSolution();
  solving = true;
  try {
    await lastQueued;
    const r = checkCube(view.colors());
    if (!r.ok) {
      hint(`[ CAN'T SOLVE THAT: ${r.reason} ]`, "alert");
      return;
    }
    if (r.solved) {
      hint("[ ALREADY SOLVED. SCRAMBLE IT FIRST ]");
      return;
    }
    hint("[ THINKING ]");
    const moves = (await solve(r.facelets)).filter(isMove);
    showSequence({ kind: "solve", moves, index: 0 });
    ui.play.focus({ preventScroll: true });
  } catch (err) {
    hint("[ THE SOLVER CHOKED ON THAT ONE. CHECK THE COLOURS ]", "alert");
    console.error(err);
  } finally {
    solving = false;
  }
});

$("reset").addEventListener("click", () => {
  dropSolution();
  mixToken++;
  view.uprightView();
  view.reset().then(() => renderPalette());
  wasSolved = true;
  hint(view.paintMode ? PAINT_HINT : DEFAULT_HINT);
});

ui.play.addEventListener("click", () => play());
$("next").addEventListener("click", () => {
  playing = false;
  stepForward();
});
$("prev").addEventListener("click", () => {
  playing = false;
  stepBack();
});
$("first").addEventListener("click", () => jumpTo(0));
$("last").addEventListener("click", () => solution && jumpTo(solution.moves.length));
ui.speed.addEventListener("input", () => (view.speed = Number(ui.speed.value)));

let exploded = false;
ui.explode.addEventListener("click", () => {
  exploded = !exploded;
  view.setExploded(exploded);
  ui.explode.classList.toggle("cube-btn--on", exploded);
  ui.explode.setAttribute("aria-pressed", String(exploded));
});

document.querySelectorAll<HTMLButtonElement>("[data-screen]").forEach((b, _, all) =>
  b.addEventListener("click", () => {
    view.setScreen(b.dataset.screen as Screen);
    $("stage").classList.toggle("cube-stage--screen", b.dataset.screen !== "off");
    all.forEach((o) => {
      o.classList.toggle("cube-btn--on", o === b);
      o.setAttribute("aria-pressed", String(o === b));
    });
  }),
);

// --- guide ----------------------------------------------------------------

const guide = new Guide($("guide"), $<HTMLButtonElement>("guide-open"), (open) => {
  document.querySelector(".cube-page")!.classList.toggle("cube-page--guide", open);
});

// Skin: ?skin=glass wins, then the last one picked, then classic.
const skinButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-skin]")];
function setSkin(name: SkinName, remember = true) {
  view.setSkin(name);
  guide.setSkin(name);
  skinButtons.forEach((o) => {
    o.classList.toggle("cube-btn--on", o.dataset.skin === name);
    o.setAttribute("aria-pressed", String(o.dataset.skin === name));
  });
  if (!remember) return;
  try {
    localStorage.setItem("cube.skin", name);
  } catch {
    /* storage blocked: the pick just won't stick */
  }
}
skinButtons.forEach((b) => b.addEventListener("click", () => setSkin(b.dataset.skin as SkinName)));

const isSkin = (v: string | null): v is SkinName => SKINS.includes(v as SkinName);
let savedSkin: string | null = null;
try {
  savedSkin = localStorage.getItem("cube.skin");
} catch {
  /* ignore */
}
const urlSkin = new URLSearchParams(location.search).get("skin");
const startSkin = isSkin(urlSkin) ? urlSkin : isSkin(savedSkin) ? savedSkin : "classic";
if (startSkin !== "classic") setSkin(startSkin, false);

// --- keyboard -------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement;
  if (target.tagName === "INPUT") return;

  if (view.paintMode && /^[1-6]$/.test(e.key)) {
    pickColor(Number(e.key) - 1);
    return;
  }
  if (e.key === "?") {
    guide.toggle();
    return;
  }
  if (e.key === "Escape" && guide.isOpen()) {
    guide.toggle(false);
    return;
  }
  if (e.key === "Escape" && view.paintMode) {
    setPaint(false);
    return;
  }
  if (solution && e.key === " " && target.tagName !== "BUTTON") {
    e.preventDefault();
    play();
    return;
  }
  if (solution && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    e.preventDefault();
    playing = false;
    if (e.key === "ArrowRight") stepForward();
    else stepBack();
    return;
  }
  // Keys follow what you see: U is whatever face is on top right now.
  const face = e.key.length === 1 ? e.key : "";
  const upper = face.toUpperCase();
  if ("URFDLBMES".includes(upper) && upper) userMove(view.relativeMove(e.shiftKey ? `${upper}'` : upper));
  else if ("xyz".includes(face.toLowerCase()) && face) {
    const r = face.toLowerCase();
    userMove(view.relativeMove(e.shiftKey ? `${r}'` : r));
  }
});

// --- a shared cube (?cube=...) ------------------------------------------------

function openShared(): boolean {
  const code = new URLSearchParams(location.search).get("cube");
  if (!code) return false;
  const facelets = decodeFacelets(code);
  const r = facelets ? checkCube(colorsFromFacelets(facelets)) : null;
  if (!facelets || !r?.ok) {
    hint("[ THAT LINK'S CUBE DOESN'T ADD UP. HERE'S A FRESH ONE ]", "alert");
    return false;
  }
  if (r.solved) return false;
  view.setColors(colorsFromFacelets(facelets));
  wasSolved = false;
  const sharedHint = "[ SOMEONE SENT YOU THIS. SOLVE IT, OR |< TO COPY IT ONTO A REAL CUBE ]";
  hint("[ SOMEONE SENT YOU THIS. SOLVE IT ]");
  // The mix that makes it: undo the solver's solution. Only offered if you
  // haven't started turning by the time it's ready.
  const untouched = () => {
    const now = checkCube(view.colors());
    return now.ok && now.facelets === facelets;
  };
  solverReady
    .then(() => solve(facelets))
    .then((moves) => {
      if (solution || view.paintMode || !untouched()) return;
      const mix = invertAlg(moves.filter(isMove));
      showSequence({ kind: "mix", moves: mix, index: mix.length, doneHint: sharedHint });
    })
    .catch((err) => console.error(err));
  return true;
}

// --- go -------------------------------------------------------------------

openShared();
view.assemble();
solverReady.catch((err) => console.error("Solver failed to start", err));
