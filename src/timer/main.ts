// /timer: scramble a real cube, hold space (or the pad), let go to start,
// any key or tap to stop. Your times stay in this browser; a time fast
// enough for the shared top 10 can be posted with a name.

import "../style.css";
import "./timer.css";
import { randomScramble } from "../cube/notation.ts";
import { colorsAfter } from "../cube/state.ts";
import { FACES } from "../cube/facelets.ts";
import { STICKER_HEX, hexCss } from "../cube/colors.ts";
import { averageOf, best, formatMs, mean } from "./stats.ts";
import { fetchBoard, postScore, type Entry } from "./board.ts";
import { MIN_MS, cleanName, qualifies } from "../../api/_board.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  page: $("page"),
  scramble: $<HTMLParagraphElement>("scramble"),
  net: $("net"),
  pad: $("pad"),
  clock: $<HTMLOutputElement>("clock"),
  hint: $<HTMLParagraphElement>("timer-hint"),
  post: $<HTMLFormElement>("post"),
  name: $<HTMLInputElement>("name"),
  stats: $("stats"),
  history: $<HTMLOListElement>("history"),
  historyEmpty: $("history-empty"),
  clear: $<HTMLButtonElement>("clear-times"),
  board: $<HTMLOListElement>("board"),
  boardNote: $("board-note"),
};

const touch = matchMedia("(pointer: coarse)").matches;
const pretty = (m: string) => m.replace("'", "′");

type Tone = "plain" | "alert" | "win";
function hint(text: string, tone: Tone = "plain") {
  ui.hint.textContent = text;
  ui.hint.classList.toggle("cube-hint--alert", tone === "alert");
  ui.hint.classList.toggle("cube-hint--win", tone === "win");
}

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage blocked: this visit's times just won't stick */
    }
  },
};

// --- scramble --------------------------------------------------------------

let scramble: string[] = [];

const NET_AT: Record<(typeof FACES)[number], [number, number]> = {
  U: [3, 0], L: [0, 3], F: [3, 3], R: [6, 3], B: [9, 3], D: [3, 6],
};

function renderNet(colors: number[]) {
  const cells: string[] = [];
  FACES.forEach((face, f) => {
    const [ox, oy] = NET_AT[face];
    for (let i = 0; i < 9; i++) {
      const x = (ox + (i % 3)) * 10;
      const y = (oy + Math.floor(i / 3)) * 10;
      cells.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="9" height="9" fill="${hexCss(STICKER_HEX[colors[f * 9 + i]])}"/>`);
    }
  });
  ui.net.innerHTML = `<svg viewBox="0 0 120 90" aria-hidden="true"><g stroke="#191611" stroke-width="0.8">${cells.join("")}</g></svg>`;
}

function newScramble() {
  scramble = randomScramble(20);
  ui.scramble.textContent = scramble.map(pretty).join("  ");
  renderNet(colorsAfter(scramble));
}

// --- the clock -------------------------------------------------------------

function setClock(text: string) {
  ui.clock.value = text;
  ui.clock.innerHTML = [...text].map((ch) => `<span class="${/\d/.test(ch) ? "d" : "p"}">${ch}</span>`).join("");
}

type Phase = "idle" | "holding" | "ready" | "running" | "stopped";
const HOLD_MS = 300;
let phase: Phase = "idle";
let holdTimer = 0;
let startedAt = 0;
let frame = 0;

function idleHint() {
  hint(touch ? "[ HOLD THE TIMER, LET GO TO START ]" : "[ HOLD SPACE, LET GO TO START ]");
}

function setPhase(next: Phase) {
  phase = next;
  ui.pad.classList.toggle("timer-pad--holding", next === "holding");
  ui.pad.classList.toggle("timer-pad--ready", next === "ready");
  ui.page.classList.toggle("timer-page--running", next === "running" || next === "ready");
}

function press() {
  if (phase === "running") return stop();
  if (phase !== "idle") return;
  setPhase("holding");
  hint("[ KEEP HOLDING ]");
  clearTimeout(holdTimer);
  holdTimer = window.setTimeout(() => {
    if (phase !== "holding") return;
    setPhase("ready");
    setClock("0.00");
    hint("[ LET GO ]");
  }, HOLD_MS);
}

function release() {
  if (phase === "holding") {
    clearTimeout(holdTimer);
    setPhase("idle");
    idleHint();
  } else if (phase === "ready") start();
  else if (phase === "stopped") setPhase("idle");
}

function start() {
  dismissPost();
  setPhase("running");
  startedAt = performance.now();
  hint(touch ? "[ TAP TO STOP ]" : "[ ANY KEY TO STOP ]");
  const tick = () => {
    setClock(formatMs(performance.now() - startedAt));
    frame = requestAnimationFrame(tick);
  };
  tick();
}

function stop() {
  const ms = Math.round(performance.now() - startedAt);
  cancelAnimationFrame(frame);
  setPhase("stopped");
  setClock(formatMs(ms));
  record(ms);
}

function cancel() {
  clearTimeout(holdTimer);
  cancelAnimationFrame(frame);
  const last = times.at(-1);
  setClock(formatMs(last ? last.ms : 0));
  setPhase("idle");
  hint("[ CANCELLED. THAT ONE DOESN'T COUNT ]");
}

// --- your times ------------------------------------------------------------

type Solve = { ms: number; scramble: string; at: number };
const TIMES_KEY = "cube.times";
const isSolve = (v: unknown): v is Solve =>
  !!v && typeof (v as Solve).ms === "number" && typeof (v as Solve).at === "number";
let times: Solve[] = store.get<unknown[]>(TIMES_KEY, []).filter(isSolve);

function saveTimes() {
  times = times.slice(-1000);
  store.set(TIMES_KEY, times);
}

function renderTimes() {
  const ms = times.map((t) => t.ms);
  const stats: [string, number | null | string][] = [
    ["Best", best(ms)],
    ["Ao5", averageOf(ms, 5)],
    ["Ao12", averageOf(ms, 12)],
    ["Mean", mean(ms)],
    ["Solves", String(ms.length)],
  ];
  ui.stats.replaceChildren(
    ...stats.map(([label, value]) => {
      const div = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = typeof value === "string" ? value : formatMs(value);
      div.append(dt, dd);
      return div;
    }),
  );

  const fastest = best(ms);
  const rows = times
    .map((t, i) => ({ t, n: i + 1 }))
    .reverse()
    .slice(0, 200)
    .map(({ t, n }) => {
      const li = document.createElement("li");
      li.className = "timer-row";
      if (t.ms === fastest) li.classList.add("timer-row--best");
      li.title = t.scramble;
      const num = document.createElement("span");
      num.className = "timer-row__n";
      num.textContent = String(n);
      const time = document.createElement("span");
      time.className = "timer-row__time";
      time.textContent = formatMs(t.ms);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "timer-row__del";
      del.textContent = "×";
      del.setAttribute("aria-label", `Delete solve ${n} (${formatMs(t.ms)})`);
      del.addEventListener("click", () => {
        times = times.filter((x) => x !== t);
        saveTimes();
        renderTimes();
      });
      li.append(num, time, del);
      return li;
    });
  ui.history.replaceChildren(...rows);
  ui.historyEmpty.hidden = times.length > 0;
  ui.clear.hidden = times.length === 0;
}

let clearArmed = 0;
ui.clear.addEventListener("click", () => {
  if (!clearArmed) {
    ui.clear.textContent = "Sure? Clear all";
    ui.clear.classList.add("cube-btn--on");
    clearArmed = window.setTimeout(disarmClear, 3000);
    return;
  }
  disarmClear();
  times = [];
  saveTimes();
  renderTimes();
});
function disarmClear() {
  clearTimeout(clearArmed);
  clearArmed = 0;
  ui.clear.textContent = "Clear all";
  ui.clear.classList.remove("cube-btn--on");
}

function record(ms: number) {
  times.push({ ms, scramble: scramble.join(" "), at: Date.now() });
  saveTimes();
  renderTimes();
  newScramble();

  const prevBest = best(times.slice(0, -1).map((t) => t.ms));
  const pb = prevBest !== null && ms < prevBest;
  if (ms < MIN_MS) {
    hint("[ UNDER 3 SECONDS IS FASTER THAN THE WORLD RECORD. NOT GOING ON THE BOARD ]");
  } else if (board && qualifies(board, ms)) {
    offerPost(ms, pb);
  } else {
    hint(pb ? "[ NEW PERSONAL BEST ]" : "[ HOLD AGAIN FOR THE NEXT ONE ]", pb ? "win" : "plain");
  }
}

// --- the shared board ------------------------------------------------------

let board: Entry[] | null = null;
let pending: number | null = null;
const NAME_KEY = "cube.name";

function renderBoard(mine?: number | null) {
  if (!board) return;
  const fmtDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
  ui.board.replaceChildren(
    ...board.map((e) => {
      const li = document.createElement("li");
      li.className = "timer-row";
      if (e.rank === mine) li.classList.add("timer-row--you");
      const cells: [string, string][] = [
        ["n", String(e.rank)],
        ["name", e.name],
        ["time", formatMs(e.ms)],
        ["date", fmtDate.format(e.at)],
      ];
      for (const [cls, text] of cells) {
        const span = document.createElement("span");
        span.className = `timer-row__${cls}`;
        span.textContent = text;
        li.append(span);
      }
      return li;
    }),
  );
  ui.boardNote.hidden = board.length > 0;
  ui.boardNote.textContent = "[ NOBODY YET. BE FIRST ]";
}

async function loadBoard() {
  const r = await fetchBoard();
  if (!r.ok) {
    ui.boardNote.hidden = false;
    ui.boardNote.textContent = `[ ${r.error} ]`;
    return;
  }
  board = r.top;
  renderBoard();
}

function offerPost(ms: number, pb: boolean) {
  pending = ms;
  ui.post.hidden = false;
  hint(`[ ${formatMs(ms)}${pb ? ". NEW PERSONAL BEST" : ""}. THAT'S TOP 10 ]`, "win");
  const saved = store.get<string>(NAME_KEY, "");
  ui.name.value = saved;
  // With a name already saved, Enter posts it; otherwise start typing.
  if (saved) (ui.post.querySelector("[type=submit]") as HTMLButtonElement).focus({ preventScroll: true });
  else ui.name.focus({ preventScroll: true });
}

function dismissPost() {
  pending = null;
  ui.post.hidden = true;
  if (ui.post.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
}

ui.post.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (pending === null) return;
  const name = cleanName(ui.name.value);
  if (!name) {
    hint("[ NAME: LETTERS, NUMBERS AND SPACES, UP TO 12 ]", "alert");
    ui.name.focus();
    return;
  }
  const ms = pending;
  store.set(NAME_KEY, name);
  const buttons = [...ui.post.querySelectorAll("button")];
  buttons.forEach((b) => (b.disabled = true));
  hint("[ POSTING ]");
  const r = await postScore(name, ms);
  buttons.forEach((b) => (b.disabled = false));
  if (!r.ok) {
    hint(`[ ${r.error} ]`, "alert");
    return;
  }
  dismissPost();
  board = r.top;
  renderBoard(r.rank);
  if (r.rank) hint(`[ YOU'RE #${r.rank} ON THE BOARD ]`, "win");
  else hint("[ SOMEONE GOT THERE FIRST. NOT QUITE TOP 10 NOW ]");
});

$("skip").addEventListener("click", () => {
  dismissPost();
  idleHint();
});

// --- input -----------------------------------------------------------------

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

window.addEventListener("keydown", (e) => {
  if (typing(e.target)) {
    if (e.key === "Escape" && pending !== null) {
      dismissPost();
      idleHint();
    }
    return;
  }
  if (phase === "running") {
    e.preventDefault();
    if (e.key === "Escape") cancel();
    else stop();
    return;
  }
  if (e.key === "Escape" && (phase === "holding" || phase === "ready")) {
    cancel();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) press();
  }
});

window.addEventListener("keyup", (e) => {
  if (typing(e.target)) return;
  if (e.code === "Space") {
    e.preventDefault();
    release();
  } else if (phase === "stopped") setPhase("idle");
});

ui.pad.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || ui.post.contains(e.target as Node)) return;
  e.preventDefault();
  press();
});
// While it's running, a tap anywhere stops it.
document.addEventListener("pointerdown", (e) => {
  if (phase === "running" && !ui.pad.contains(e.target as Node)) stop();
});
window.addEventListener("pointerup", () => release());
window.addEventListener("pointercancel", () => phase !== "running" && release());
ui.pad.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("blur", () => {
  if (phase === "holding" || phase === "ready") cancel();
});

$("new-scramble").addEventListener("click", (e) => {
  newScramble();
  (e.currentTarget as HTMLElement).blur();
});

// --- go --------------------------------------------------------------------

newScramble();
renderTimes();
setClock(formatMs(times.at(-1)?.ms ?? 0));
idleHint();
loadBoard();
