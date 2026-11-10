/// <reference lib="webworker" />
// Kociemba two-phase solver (cubejs) off the main thread: building its
// pruning tables takes a second or two, and solving can take a few hundred ms.
//
// cubejs is old CoffeeScript output that hangs itself off `this.Cube`, which
// is undefined once a bundler turns it into an ES module. So we load the two
// source files as text and run them with an explicit `this` instead.
import cubeSrc from "cubejs/lib/cube.js?raw";
import solveSrc from "cubejs/lib/solve.js?raw";
import type CubeType from "cubejs";

const scope: { Cube?: typeof CubeType } = {};
new Function(cubeSrc).call(scope);
new Function(solveSrc).call(scope);
const Cube = scope.Cube!;

let ready = false;
function warm() {
  if (!ready) {
    Cube.initSolver();
    ready = true;
  }
}

self.onmessage = (e: MessageEvent<{ id: number; facelets?: string }>) => {
  const { id, facelets } = e.data;
  try {
    warm();
    if (facelets === undefined) {
      self.postMessage({ id, ok: true, moves: "" });
      return;
    }
    const moves: string = Cube.fromString(facelets).solve();
    self.postMessage({ id, ok: true, moves });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  }
};
