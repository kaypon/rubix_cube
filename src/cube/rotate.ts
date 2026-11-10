import type { Axis } from "./notation.ts";
import type { Vec3 } from "./facelets.ts";

/** Rotate an integer vector by `quarters` × 90° about a positive axis. */
export function rotateVec(v: Vec3, axis: Axis, quarters: number): Vec3 {
  let [x, y, z] = v;
  const q = ((quarters % 4) + 4) % 4;
  for (let i = 0; i < q; i++) {
    if (axis === "x") [y, z] = [-z, y];
    else if (axis === "y") [x, z] = [z, -x];
    else [x, y] = [-y, x];
  }
  return [x + 0, y + 0, z + 0]; // +0 normalises -0
}

export const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
