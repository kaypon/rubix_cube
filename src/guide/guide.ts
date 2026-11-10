// The "How to solve" side panel: written steps plus a small demo cube that
// loops whichever sequence you tap. The demo cube is its own CubeView, built
// the first time the panel opens and paused whenever it's closed.

import { CubeView } from "../cube/CubeView.ts";
import { invertMove, parseAlg } from "../cube/notation.ts";
import type { SkinName } from "../cube/skins.ts";
import { COMPUTER, INTRO, NOTATION, STEPS, type Demo } from "./content.ts";

const DARK_BG = 0x121212;
const pretty = (m: string) => m.replace("'", "′");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Guide {
  readonly isOpen = () => this.open;
  private open = false;
  private mini: CubeView | null = null;
  private skin: SkinName = "classic";
  private token = 0;
  private demoButtons: HTMLButtonElement[] = [];
  private current: { demo: Demo; button?: HTMLButtonElement } | null = null;

  constructor(
    private panel: HTMLElement,
    private opener: HTMLButtonElement,
    private onToggle: (open: boolean) => void,
  ) {
    this.render();
    opener.addEventListener("click", () => this.toggle());
    panel.querySelector(".cube-guide__close")!.addEventListener("click", () => this.toggle(false));
  }

  setSkin(name: SkinName) {
    this.skin = name;
    this.mini?.setSkin(name);
  }

  toggle(force?: boolean) {
    const open = force ?? !this.open;
    if (open === this.open) return;
    this.open = open;
    this.panel.classList.toggle("cube-guide--open", open);
    this.panel.inert = !open;
    this.opener.setAttribute("aria-expanded", String(open));
    this.opener.classList.toggle("cube-btn--on", open);
    this.onToggle(open);
    if (open) {
      this.ensureMini();
      this.mini!.setActive(true);
      (this.panel.querySelector(".cube-guide__close") as HTMLElement).focus({ preventScroll: true });
      const { demo, button } = this.current ?? {
        demo: STEPS[0].demos[0],
        button: this.demoButtons.find((b) => b.dataset.step === "0"),
      };
      this.play(demo, button);
    } else {
      this.token++; // stops the loop
      this.mini?.setActive(false);
      this.opener.focus({ preventScroll: true });
    }
  }

  private ensureMini() {
    if (this.mini) return;
    const host = this.panel.querySelector<HTMLElement>(".cube-guide__stage")!;
    this.mini = new CubeView(host, { interactive: false, background: DARK_BG, fit: 0.7 });
    this.mini.speed = 1.5;
    this.mini.canvas.setAttribute("role", "img");
    this.mini.canvas.setAttribute("aria-label", "Demo cube playing the selected sequence. Drag to look around.");
    if (this.skin !== "classic") this.mini.setSkin(this.skin);
    this.mini.setActive(this.open);
  }

  /** Loop one sequence: set the case up instantly, play it, pause, repeat. */
  private async play(demo: Demo, button?: HTMLButtonElement) {
    this.ensureMini();
    const mini = this.mini!;
    const my = ++this.token;
    this.current = { demo, button };
    this.demoButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));

    const moves = parseAlg(demo.alg);
    const setup = [...(demo.hold ? [demo.hold] : []), ...[...moves].reverse().map(invertMove)];
    const caption = this.panel.querySelector(".cube-guide__moves")!;
    const chips = moves.map((m) => el("span", "cube-guide__move", pretty(m)));
    caption.replaceChildren(...chips);

    while (my === this.token) {
      mini.resetInstant();
      mini.applyInstant(setup);
      chips.forEach((c) => c.classList.remove("cube-guide__move--done", "cube-guide__move--now"));
      await sleep(700);
      for (let i = 0; i < moves.length; i++) {
        if (my !== this.token) return;
        chips[i].classList.add("cube-guide__move--now");
        await mini.enqueue(moves[i]);
        chips[i].classList.replace("cube-guide__move--now", "cube-guide__move--done");
      }
      await sleep(1600);
    }
  }

  private demoButton(demo: Demo, step: string): HTMLButtonElement {
    const b = el("button", "cube-guide__demo", demo.label);
    b.type = "button";
    b.dataset.step = step;
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", `Play ${demo.label} on the demo cube`);
    b.addEventListener("click", () => this.play(demo, b));
    this.demoButtons.push(b);
    return b;
  }

  private render() {
    const body = this.panel.querySelector<HTMLElement>(".cube-guide__body")!;
    const frag = document.createDocumentFragment();

    INTRO.forEach((t) => frag.append(el("p", undefined, t)));

    const notation = el("section", "cube-guide__section");
    notation.append(el("h3", "cube-guide__heading", "Reading moves"));
    NOTATION.body.forEach((t) => notation.append(el("p", undefined, t)));
    const row = el("div", "cube-guide__chips");
    NOTATION.moves.forEach((m) => row.append(this.demoButton({ label: pretty(m), alg: m }, `n-${m}`)));
    notation.append(row);
    frag.append(notation);

    const list = el("ol", "cube-guide__steps");
    STEPS.forEach((step, i) => {
      const li = el("li", "cube-guide__step");
      li.append(el("h3", "cube-guide__heading", step.title));
      step.body.forEach((t) => li.append(el("p", undefined, t)));
      const demos = el("div", "cube-guide__chips");
      step.demos.forEach((d) => demos.append(this.demoButton(d, String(i))));
      li.append(demos);
      list.append(li);
    });
    frag.append(list);

    const computer = el("section", "cube-guide__section");
    computer.append(el("h3", "cube-guide__heading", "How the Solve button does it"));
    COMPUTER.forEach((t) => computer.append(el("p", undefined, t)));
    frag.append(computer);

    body.replaceChildren(frag);
  }
}
