// The 3D cube: rendering, the turn queue, drag-to-turn, painting, and the
// set-piece animations (fly-in assembly, exploded view, solved celebration).
//
// The meshes are the source of truth. Every cubie keeps an integer `coord`
// and a quaternion snapped to 90° steps after each turn; a sticker's facelet
// is just (cubie coord, sticker normal rotated by the cubie).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { HalftonePass } from "three/addons/postprocessing/HalftonePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import { parseMove, nameTurn, frameFromVectors, remapMove, type Axis, type ViewFrame } from "./notation.ts";
import { faceletIndex, UNPAINTED, type Vec3 } from "./facelets.ts";
import { AXIS_INDEX } from "./rotate.ts";
import { Confetti } from "../fx/confetti.ts";
import { createSkins, outlineMaterial, studioScene, type Skin, type SkinName } from "./skins.ts";
import { STICKER_HEX } from "./colors.ts";

// Ink + paper from kevs_site, plus printed-ink takes on the six cube colours.
export const PAPER = 0xf2f2f0;
const INK = 0x191611;
export { STICKER_HEX };
const BLANK_HEX = 0x8c8273;

const FLOOR_Y = -2.35;
const QUARTER = Math.PI / 2;
const AXES: Axis[] = ["x", "y", "z"];
const AXIS_VEC: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export type Screen = "off" | "dots" | "ink";
export type MoveSource = "drag" | "queue";

export interface CubeViewOptions {
  /** Drag-to-turn and painting. Off for the guide's demo cube. */
  interactive?: boolean;
  background?: number;
  /** Camera distance multiplier (smaller = bigger cube). */
  fit?: number;
}

interface Cubie extends THREE.Group {
  userData: {
    coord: Vec3;
    home: Vec3;
    startCoord: Vec3;
    body: THREE.Mesh;
    outline: THREE.Mesh;
    filler: THREE.Mesh;
    skin: SkinName;
    /** Seconds until this cubie takes the new skin, or null. */
    skinDelay: number | null;
    popX: number;
    popV: number;
  };
}
interface Sticker extends THREE.Mesh {
  userData: { cubie: Cubie; localNormal: THREE.Vector3; color: number; center: boolean; pop: number };
}

interface TurnAnim {
  cubies: Cubie[];
  axis: Axis;
  from: number;
  to: number;
  quarters: number;
  layer: number | null;
  duration: number;
  elapsed: number;
  ease: (t: number) => number;
  name: string | null;
  source: MoveSource;
  resolve: () => void;
}

interface Fly {
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  fromScale: number;
  arc: THREE.Vector3;
  delay: number;
  duration: number;
  midpoint?: () => void;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeInOutBack = (t: number, c1 = 1.1) => {
  const c2 = c1 * 1.525;
  return t < 0.5
    ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2
    : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
};
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number, c1 = 1.5) => 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function roundedSquare(size: number, radius: number): THREE.Shape {
  const h = size / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + radius, -h);
  s.lineTo(h - radius, -h);
  s.quadraticCurveTo(h, -h, h, -h + radius);
  s.lineTo(h, h - radius);
  s.quadraticCurveTo(h, h, h - radius, h);
  s.lineTo(-h + radius, h);
  s.quadraticCurveTo(-h, h, -h, h - radius);
  s.lineTo(-h, -h + radius);
  s.quadraticCurveTo(-h, -h, -h + radius, -h);
  return s;
}

function snapQuaternion(q: THREE.Quaternion) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const e = m.elements;
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) e[i] = Math.round(e[i]);
  q.setFromRotationMatrix(m);
}

function dominantAxis(v: THREE.Vector3): { axis: Axis; sign: number } {
  const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const i = a.indexOf(Math.max(...a));
  return { axis: AXES[i], sign: Math.sign(v.getComponent(i)) || 1 };
}

export class CubeView {
  onMove?: (name: string, source: MoveSource) => void;
  onPaint?: () => void;

  paintMode = false;
  paintColor = 0;
  /** Multiplier on turn durations (higher = faster). */
  speed = 1;

  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private controls: OrbitControls;
  private composer: EffectComposer;
  private halftone: HalftonePass;
  private screen: Screen = "off";

  private root = new THREE.Group();
  private pivot = new THREE.Group();
  private cubies: Cubie[] = [];
  private stickers: Sticker[] = [];
  private hitTargets: THREE.Object3D[] = [];
  private skins = createSkins(STICKER_HEX, BLANK_HEX);
  private skinName: SkinName = "classic";
  private core!: THREE.Mesh;
  private envs!: Record<Skin["env"], THREE.Texture | null>;
  private get skin(): Skin {
    return this.skins[this.skinName];
  }
  private confetti: Confetti;

  private queue: { name: string; scale: number; resolve: () => void }[] = [];
  private anim: TurnAnim | null = null;
  private flights = new Map<Cubie, Fly>();
  private flightTime = 0;
  private flightDone: (() => void) | null = null;

  private spacing = 1;
  private spacingTarget = 1;
  private pop = 0;
  private popVel = 0;
  private tilt = new THREE.Vector3();
  private tiltVel = new THREE.Vector3();
  private spin = { from: 0, t: 1, duration: 1.4 };

  // Looking around turns the cube itself (not the camera), so it can go any
  // way up while the light and its shadow stay put.
  private viewQuat = new THREE.Quaternion();
  /** Spin left over after a flick, in px/s of drag. */
  private viewVel = new THREE.Vector2();
  private upright: { from: THREE.Quaternion; t: number; done: () => void } | null = null;
  private look: null | { pointerId: number; x: number; y: number; lastT: number } = null;
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpE = new THREE.Euler();

  private drag: null | {
    pointerId: number;
    startX: number;
    startY: number;
    hitLocal: THREE.Vector3;
    normal: THREE.Vector3;
    cubie: Cubie;
    turning: boolean;
    axis?: Axis;
    layer?: number;
    screenDir?: THREE.Vector2;
    pxPerUnit?: number;
    angleSign?: number;
    angle: number;
    velocity: number;
    lastT: number;
  } = null;
  private painting: number | null = null;

  private raycaster = new THREE.Raycaster();
  private timer = new THREE.Timer();
  private time = 0;
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private dpr = Math.min(window.devicePixelRatio, 2);

  private opts: Required<CubeViewOptions>;

  constructor(
    private host: HTMLElement,
    opts: CubeViewOptions = {},
  ) {
    this.opts = { interactive: true, background: PAPER, fit: 1, ...opts };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = "cube-canvas";
    host.appendChild(this.canvas);

    this.scene.background = new THREE.Color(this.opts.background);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envs = {
      room: pmrem.fromScene(new RoomEnvironment(), 0.04).texture,
      studio: pmrem.fromScene(studioScene(), 0.02).texture,
      none: null,
    };
    this.scene.environment = this.envs.room;
    this.scene.environmentIntensity = 0.55;

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(3.5, 9, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 14;
    key.shadow.blurSamples = 20;
    key.shadow.bias = -0.0005;
    const cam = key.shadow.camera;
    cam.left = cam.bottom = -8;
    cam.right = cam.top = 8;
    cam.near = 1;
    cam.far = 20;
    this.scene.add(key, new THREE.HemisphereLight(0xffffff, 0xd9d2c3, 0.5));

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.ShadowMaterial({ color: INK, opacity: 0.2 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.buildCube();
    this.root.add(this.pivot);
    // The fixed core you'd otherwise see into mid-turn.
    this.core = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.98, 0.98), this.skin.core ?? undefined);
    this.root.add(this.core);
    this.scene.add(this.root);

    this.confetti = new Confetti(this.scene, STICKER_HEX, FLOOR_Y);

    this.camera.position.set(5.6, 4.6, 7.4);
    // OrbitControls is kept for zoom (wheel, pinch) only; rotation is ours.
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableRotate = false;
    this.controls.enablePan = false;
    this.controls.enableZoom = this.opts.interactive;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.7;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 20;
    this.controls.target.set(0, -0.6, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.halftone = new HalftonePass({
      shape: 1,
      radius: 3.2 * this.dpr,
      rotateR: Math.PI / 12,
      rotateB: (Math.PI / 12) * 2,
      rotateG: (Math.PI / 12) * 3,
      scatter: 0,
      blending: 1,
      blendingMode: 1,
      greyscale: false,
      disable: false,
    });
    this.composer.addPass(this.halftone);
    this.composer.addPass(new OutputPass());

    if (this.opts.interactive) this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // --- construction -------------------------------------------------------

  private buildCube() {
    // Stickers (0.78 + bevel) stay inside the flat part of each face
    // (0.96 - 2 × 0.075 rounding), so no sticker rim pokes past the edge.
    const body = new RoundedBoxGeometry(0.96, 0.96, 0.96, 4, 0.075);
    const stickerGeo = new THREE.ExtrudeGeometry(roundedSquare(0.78, 0.11), {
      depth: 0.008,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 2,
      curveSegments: 6,
    });
    const zAxis = new THREE.Vector3(0, 0, 1);

    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          const cubie = new THREE.Group() as Cubie;
          cubie.position.set(x, y, z);
          const mesh = new THREE.Mesh(body, this.skin.body);
          mesh.castShadow = true;
          mesh.userData.cubie = cubie;
          cubie.add(mesh);
          this.hitTargets.push(mesh);
          const outline = new THREE.Mesh(body, outlineMaterial);
          outline.scale.setScalar(1.1);
          outline.visible = false;
          cubie.add(outline);
          const filler = this.makeFiller([x, y, z]);
          cubie.add(filler);
          cubie.userData = {
            coord: [x, y, z],
            home: [x, y, z],
            startCoord: [x, y, z],
            body: mesh,
            outline,
            filler,
            skin: this.skinName,
            skinDelay: null,
            popX: 0,
            popV: 0,
          };

          const coord = [x, y, z];
          for (let a = 0; a < 3; a++) {
            if (coord[a] === 0) continue;
            const n = new THREE.Vector3().setComponent(a, coord[a]);
            const color = this.homeColor(n);
            const s = new THREE.Mesh(stickerGeo, this.skin.stickers[color]) as unknown as Sticker;
            s.quaternion.setFromUnitVectors(zAxis, n);
            s.position.copy(n).multiplyScalar(0.47); // sunk: only ~0.01 proud of the face
            s.castShadow = true;
            s.userData = {
              cubie,
              localNormal: n,
              color,
              center: Math.abs(x) + Math.abs(y) + Math.abs(z) === 1,
              pop: 0,
            };
            cubie.add(s);
            this.stickers.push(s);
            this.hitTargets.push(s);
          }
          this.cubies.push(cubie);
          this.root.add(cubie);
        }
  }

  /**
   * A sharp-cornered box inside the cubie: flush (almost) against its
   * neighbours on every inner side, so the channels the rounded edges leave
   * are plugged, but pulled well back from the outside so it never shows
   * past the rounded body.
   */
  private makeFiller(coord: Vec3): THREE.Mesh {
    const INNER = 0.495;
    const OUTER = 0.36;
    const min = coord.map((c) => (c === -1 ? -OUTER : -INNER));
    const max = coord.map((c) => (c === 1 ? OUTER : INNER));
    const geo = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    geo.translate((max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2);
    const m = new THREE.Mesh(geo, this.skin.core ?? undefined);
    m.visible = this.innardsVisible(this.skin);
    return m;
  }

  /** Innards show only for opaque skins, once the cube is closed up and landed. */
  private innardsVisible(skin: Skin): boolean {
    return skin.core !== null && this.spacing < 1.04 && this.flights.size === 0;
  }

  private syncInnards() {
    if (this.skin.core) this.core.material = this.skin.core;
    this.core.visible = this.innardsVisible(this.skin);
    for (const c of this.cubies) c.userData.filler.visible = this.innardsVisible(this.skins[c.userData.skin]);
  }

  /** Colour id a sticker facing `n` has on a solved cube (U R F D L B order). */
  private homeColor(n: THREE.Vector3): number {
    const { axis, sign } = dominantAxis(n);
    return { x: sign > 0 ? 1 : 4, y: sign > 0 ? 0 : 3, z: sign > 0 ? 2 : 5 }[axis];
  }

  // --- state --------------------------------------------------------------

  get busy(): boolean {
    return this.anim !== null || this.queue.length > 0 || this.flights.size > 0 || this.drag?.turning === true;
  }

  private stickerFacelet(s: Sticker): number {
    const n = s.userData.localNormal.clone().applyQuaternion(s.userData.cubie.quaternion).round();
    return faceletIndex(s.userData.cubie.userData.coord, [n.x + 0, n.y + 0, n.z + 0]);
  }

  /** The 54 colour ids in facelet order. */
  colors(): number[] {
    const out = new Array<number>(54).fill(UNPAINTED);
    for (const s of this.stickers) out[this.stickerFacelet(s)] = s.userData.color;
    return out;
  }

  private setStickerColor(s: Sticker, color: number) {
    s.userData.color = color;
    const skin = this.skins[s.userData.cubie.userData.skin];
    s.material = color === UNPAINTED ? skin.blank : skin.stickers[color];
  }

  /** Blank every sticker except the six centers, ready to paint. */
  blank() {
    this.stickers.forEach((s, i) => {
      if (s.userData.center) return;
      this.setStickerColor(s, UNPAINTED);
      // Ripple outward from the top: each sticker pops after a short delay.
      s.userData.pop = -(0.02 + ((s.userData.cubie.userData.coord[1] * -1 + 1) * 0.09) + (i % 3) * 0.015);
    });
  }

  /** Show a given state (54 colour ids, facelet order) on a cube at rest. */
  setColors(colors: number[]) {
    this.resetInstant();
    this.stickers.forEach((s, i) => {
      const c = colors[this.stickerFacelet(s)];
      if (c === s.userData.color) return;
      this.setStickerColor(s, c);
      s.userData.pop = -(0.02 + (i % 9) * 0.02);
    });
  }

  // --- turns --------------------------------------------------------------

  /** Queue a move; resolves when it has finished animating. */
  enqueue(name: string, durationScale = 1): Promise<void> {
    parseMove(name); // throw early on bad input
    return new Promise((resolve) => this.queue.push({ name, scale: durationScale, resolve }));
  }

  /** Drop queued moves (the one in flight still lands). */
  clearQueue() {
    const q = this.queue;
    this.queue = [];
    q.forEach((m) => m.resolve());
  }

  /** Apply moves with no animation. */
  applyInstant(names: string[]) {
    for (const name of names) {
      const t = parseMove(name);
      const cubies = this.layerCubies(t.axis, t.layers);
      const q = new THREE.Quaternion().setFromAxisAngle(AXIS_VEC[t.axis], t.quarters * QUARTER);
      for (const c of cubies) {
        c.quaternion.premultiply(q);
        snapQuaternion(c.quaternion);
        const v = new THREE.Vector3(...c.userData.coord).applyQuaternion(q).round();
        c.userData.coord = [v.x + 0, v.y + 0, v.z + 0];
      }
    }
    this.layout();
  }

  private layerCubies(axis: Axis, layers: number[]): Cubie[] {
    const i = AXIS_INDEX[axis];
    return this.cubies.filter((c) => layers.includes(c.userData.coord[i]));
  }

  private startTurn(cubies: Cubie[], axis: Axis) {
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.updateMatrixWorld(true);
    for (const c of cubies) {
      c.userData.startCoord = [...c.userData.coord];
      this.pivot.attach(c);
    }
    return { cubies, axis };
  }

  private nextQueued() {
    const next = this.queue.shift();
    if (!next) return;
    const t = parseMove(next.name);
    const cubies = this.layerCubies(t.axis, t.layers);
    this.startTurn(cubies, t.axis);
    const half = Math.abs(t.quarters) === 2;
    this.anim = {
      cubies,
      axis: t.axis,
      from: 0,
      to: t.quarters * QUARTER,
      quarters: t.quarters,
      layer: t.layers.length === 1 ? t.layers[0] : null,
      duration: ((half ? 0.42 : 0.3) * next.scale) / this.speed,
      elapsed: 0,
      ease: this.skin.bouncy ? easeInOutBack : easeInOutCubic,
      name: next.name,
      source: "queue",
      resolve: next.resolve,
    };
  }

  private finishTurn(a: TurnAnim) {
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.setRotationFromAxisAngle(AXIS_VEC[a.axis], a.quarters * QUARTER);
    this.pivot.updateMatrixWorld(true);
    for (const c of a.cubies) {
      this.root.attach(c);
      snapQuaternion(c.quaternion);
      const v = new THREE.Vector3(...c.userData.startCoord)
        .applyAxisAngle(AXIS_VEC[a.axis], a.quarters * QUARTER)
        .round();
      c.userData.coord = [v.x + 0, v.y + 0, v.z + 0];
    }
    this.pivot.rotation.set(0, 0, 0);
    this.anim = null;
    this.layout();
    if (a.quarters % 4 !== 0 && !this.reducedMotion) {
      // A little kick in the turn direction; the spring settles it.
      // Counter-torque: the rest of the cube rocks against the turn.
      this.tiltVel[a.axis] -= Math.sign(a.to - a.from) * (a.layer === 0 ? 0.25 : 0.45);
    }
    if (a.name) this.onMove?.(a.name, a.source);
    a.resolve();
  }

  /** Put every cubie not mid-turn at its coordinate × current spacing. */
  private layout() {
    for (const c of this.cubies) {
      if (this.flights.has(c)) continue;
      const src = c.parent === this.pivot ? c.userData.startCoord : c.userData.coord;
      c.position.set(src[0], src[1], src[2]).multiplyScalar(this.spacing);
    }
  }

  // --- set pieces ---------------------------------------------------------

  /** Cubies fly in from all around and lock together. */
  assemble(): Promise<void> {
    if (this.reducedMotion) return Promise.resolve();
    const order = [...this.cubies].sort(() => Math.random() - 0.5);
    order.forEach((c, i) => {
      const dir = new THREE.Vector3().randomDirection();
      dir.y = Math.abs(dir.y) * 0.6 + 0.2;
      this.flights.set(c, {
        fromPos: dir.multiplyScalar(7 + Math.random() * 4),
        fromQuat: new THREE.Quaternion().random(),
        fromScale: 0.15,
        arc: new THREE.Vector3(),
        delay: 0.15 + i * 0.035,
        duration: 1.0,
      });
    });
    return this.startFlights();
  }

  /** Snap straight back to solved, abandoning anything queued or mid-turn. */
  resetInstant() {
    this.clearQueue();
    if (this.anim) {
      this.anim.elapsed = this.anim.duration;
      this.pivot.rotation.set(0, 0, 0);
      this.finishTurn(this.anim);
    }
    for (const c of this.cubies) {
      c.userData.coord = [...c.userData.home];
      c.quaternion.identity();
    }
    for (const s of this.stickers) this.setStickerColor(s, this.homeColor(s.userData.localNormal));
    this.layout();
  }

  /** Stop or restart rendering, e.g. while the cube is offscreen. */
  setActive(on: boolean) {
    this.renderer.setAnimationLoop(on ? (t) => this.frame(t) : null);
  }

  /** Burst apart and come back solved. */
  reset(): Promise<void> {
    this.clearQueue();
    const restore = () => {
      for (const c of this.cubies) {
        c.userData.coord = [...c.userData.home];
        c.quaternion.identity();
      }
      for (const s of this.stickers) this.setStickerColor(s, this.homeColor(s.userData.localNormal));
    };
    if (this.reducedMotion) {
      restore();
      this.layout();
      return Promise.resolve();
    }
    const starts = this.cubies.map((c) => ({ pos: c.position.clone(), quat: c.quaternion.clone() }));
    restore();
    this.cubies.forEach((c, i) => {
      const home = new THREE.Vector3(...c.userData.home);
      const out = home.lengthSq() ? home.clone().normalize() : new THREE.Vector3(0, 1, 0);
      this.flights.set(c, {
        fromPos: starts[i].pos,
        fromQuat: starts[i].quat,
        fromScale: 1,
        arc: out.multiplyScalar(2.6 + Math.random()),
        delay: Math.random() * 0.12,
        duration: 0.9,
      });
    });
    return this.startFlights();
  }

  private startFlights(): Promise<void> {
    this.flightTime = 0;
    return new Promise((resolve) => (this.flightDone = resolve));
  }

  private updateFlights(dt: number) {
    if (!this.flights.size) return;
    this.flightTime += dt;
    const target = new THREE.Vector3();
    const id = new THREE.Quaternion();
    for (const [c, f] of this.flights) {
      const p = clamp01((this.flightTime - f.delay) / f.duration);
      const e = f.arc.lengthSq() ? easeInOutCubic(p) : easeOutBack(p, 1.3);
      target.set(...c.userData.coord).multiplyScalar(this.spacing);
      c.position.lerpVectors(f.fromPos, target, e).addScaledVector(f.arc, Math.sin(Math.PI * clamp01(p)));
      c.quaternion.slerpQuaternions(f.fromQuat, id, easeOutCubic(p));
      c.scale.setScalar(f.fromScale + (1 - f.fromScale) * easeOutCubic(Math.min(1, p * 1.6)));
      if (p >= 1) {
        c.quaternion.identity();
        c.scale.setScalar(1);
        this.flights.delete(c);
      }
    }
    if (!this.flights.size) {
      this.layout();
      this.tiltVel.set(0.6, 0, -0.4);
      this.popVel = 1.2;
      const done = this.flightDone;
      this.flightDone = null;
      done?.();
    }
  }

  setExploded(on: boolean) {
    this.spacingTarget = on ? 1.6 : 1;
  }

  /** Solved: a pop, a full spin, confetti. */
  celebrate() {
    this.confetti.burst(220);
    if (this.reducedMotion) return;
    this.popVel = 5;
    this.spin = { from: 0, t: 0, duration: 1.5 };
  }

  get currentSkin(): SkinName {
    return this.skinName;
  }

  /** Swap skins in a wave that rolls diagonally across the cube. */
  setSkin(name: SkinName) {
    if (name === this.skinName) return;
    this.skinName = name;
    this.scene.environment = this.envs[this.skin.env];
    this.syncInnards();
    for (const c of this.cubies) {
      const [x, y, z] = c.userData.coord;
      c.userData.skinDelay = this.reducedMotion ? 0 : 0.06 * ((1 - y) * 1.6 + (x + 1) + (1 - z));
    }
  }

  private applyCubieSkin(c: Cubie) {
    const skin = this.skin;
    c.userData.skin = this.skinName;
    c.userData.body.material = skin.body;
    c.userData.body.castShadow = skin.bodyCastsShadow;
    c.userData.outline.visible = skin.outline;
    if (skin.core) c.userData.filler.material = skin.core;
    c.userData.filler.visible = this.innardsVisible(skin);
    for (const child of c.children) {
      const s = child as Sticker;
      if (!s.userData.localNormal) continue;
      this.setStickerColor(s, s.userData.color);
      s.scale.set(skin.stickerScale, skin.stickerScale, 1);
    }
  }

  private updateSkinWave(dt: number) {
    const target = this.skin.envIntensity;
    this.scene.environmentIntensity += (target - this.scene.environmentIntensity) * (1 - Math.exp(-dt * 5));
    for (const c of this.cubies) {
      const u = c.userData;
      if (u.skinDelay !== null) {
        u.skinDelay -= dt;
        if (u.skinDelay <= 0) {
          u.skinDelay = null;
          this.applyCubieSkin(c);
          if (!this.reducedMotion) u.popX = -0.28;
        }
      }
      if (u.popX === 0 && u.popV === 0) continue;
      u.popV += -u.popX * 260 * dt;
      u.popV *= Math.exp(-11 * dt);
      u.popX += u.popV * dt;
      if (Math.abs(u.popX) < 1e-4 && Math.abs(u.popV) < 1e-3) u.popX = u.popV = 0;
      if (!this.flights.has(c)) c.scale.setScalar(1 + u.popX);
    }
  }

  setScreen(screen: Screen) {
    this.screen = screen;
    this.halftone.uniforms.greyscale.value = screen === "ink";
  }

  resetCamera() {
    this.camera.position.set(5.6, 4.6, 7.4).setLength(this.fitDistance());
    this.controls.target.set(0, -0.6, 0);
  }

  /** Ease the cube back to white on top, green facing you. */
  uprightView(): Promise<void> {
    this.viewVel.set(0, 0);
    this.upright?.done();
    if (this.reducedMotion || this.viewQuat.angleTo(this.tmpQ.identity()) < 1e-3) {
      this.viewQuat.identity();
      this.upright = null;
      return Promise.resolve();
    }
    return new Promise((done) => (this.upright = { from: this.viewQuat.clone(), t: 0, done }));
  }

  /** Which cube axes currently point screen-up, screen-right and at you. */
  viewFrame(): ViewFrame {
    const inv = this.tmpQ.copy(this.viewQuat).invert();
    const dir = (x: number, y: number, z: number): [number, number, number] => {
      const v = this.tmpV.set(x, y, z).applyQuaternion(this.camera.quaternion).applyQuaternion(inv);
      return [v.x, v.y, v.z];
    };
    return frameFromVectors(dir(0, 1, 0), dir(1, 0, 0), dir(0, 0, 1));
  }

  /** A move named as you see it (U = whatever is on top now) in the cube's own notation. */
  relativeMove(name: string): string {
    return remapMove(name, this.viewFrame());
  }

  /** Turn the cube by a drag of (dx, dy) px about the screen's up and right axes. */
  private rotateView(dx: number, dy: number) {
    const k = (2 * Math.PI * 0.7) / Math.max(1, this.canvas.clientHeight);
    const up = this.tmpV.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.tmpQ.setFromAxisAngle(up, dx * k);
    const right = this.tmpV.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.tmpQ2.setFromAxisAngle(right, dy * k);
    this.viewQuat.premultiply(this.tmpQ).premultiply(this.tmpQ2).normalize();
  }

  // --- input --------------------------------------------------------------

  private pointerNdc(e: MouseEvent): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private hit(e: MouseEvent): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.pointerNdc(e), this.camera);
    return this.raycaster.intersectObjects(this.hitTargets, false)[0] ?? null;
  }

  private toScreen(local: THREE.Vector3): THREE.Vector2 {
    const p = this.root.localToWorld(local.clone()).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((p.x + 1) / 2) * r.width, ((1 - p.y) / 2) * r.height);
  }

  private bindPointer() {
    // Capture phase on the host so we decide before OrbitControls sees it.
    this.host.addEventListener(
      "pointerdown",
      (e) => {
        // A second finger means pinch-zoom: stop looking around.
        if (this.look && e.pointerId !== this.look.pointerId) this.look = null;
        if (e.target !== this.canvas || this.drag || !e.isPrimary) return;
        const hit = this.flights.size ? null : this.hit(e);
        if (!hit) {
          this.look = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, lastT: performance.now() };
          this.viewVel.set(0, 0);
          if (this.upright) {
            this.upright.done();
            this.upright = null;
          }
          return;
        }
        this.controls.enabled = false;
        if (this.paintMode) {
          this.painting = e.pointerId;
          this.paintAt(hit);
          return;
        }
        if (this.busy) return;
        const rootQuatInv = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
        const n = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld).applyQuaternion(rootQuatInv);
        const { axis, sign } = dominantAxis(n);
        this.drag = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          hitLocal: this.root.worldToLocal(hit.point.clone()),
          normal: new THREE.Vector3().setComponent(AXIS_INDEX[axis], sign),
          cubie: hit.object.userData.cubie as Cubie,
          turning: false,
          angle: 0,
          velocity: 0,
          lastT: performance.now(),
        };
      },
      { capture: true },
    );

    window.addEventListener("pointermove", (e) => {
      if (this.painting === e.pointerId) {
        const hit = this.hit(e);
        if (hit) this.paintAt(hit);
        return;
      }
      if (this.look && this.look.pointerId === e.pointerId) {
        const l = this.look;
        const dx = e.clientX - l.x;
        const dy = e.clientY - l.y;
        const now = performance.now();
        const dt = Math.max(1, now - l.lastT) / 1000;
        this.viewVel.set(dx / dt, dy / dt).multiplyScalar(0.5).addScaledVector(this.viewVel, 0.5);
        this.rotateView(dx, dy);
        l.x = e.clientX;
        l.y = e.clientY;
        l.lastT = now;
        return;
      }
      if (this.drag && this.drag.pointerId === e.pointerId) this.dragMove(e);
      else if (e.target === this.canvas && !this.drag) this.hover(e);
    });

    const end = (e: PointerEvent) => {
      if (this.look && this.look.pointerId === e.pointerId) {
        // Only a drag that was still moving when you let go keeps spinning.
        if (e.type === "pointercancel" || performance.now() - this.look.lastT > 80) this.viewVel.set(0, 0);
        else this.viewVel.clampLength(0, 1600);
        this.look = null;
      }
      if (this.painting === e.pointerId) this.painting = null;
      if (this.drag && this.drag.pointerId === e.pointerId) this.dragEnd(e.type === "pointercancel");
      this.controls.enabled = true;
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);

    // Lost? Double-click (or double-tap) off the cube to stand it back up.
    this.canvas.addEventListener("dblclick", (e) => {
      if (!this.hit(e)) this.uprightView();
    });
  }

  private hover(e: PointerEvent) {
    const hit = this.hit(e);
    if (this.paintMode) {
      const s = hit?.object as Sticker | undefined;
      this.canvas.style.cursor = s?.userData.localNormal && !s.userData.center ? "crosshair" : hit ? "not-allowed" : "grab";
    } else {
      this.canvas.style.cursor = hit ? "pointer" : "grab";
    }
  }

  private paintAt(hit: THREE.Intersection) {
    const s = hit.object as Sticker;
    if (!s.userData.localNormal || s.userData.center || s.userData.color === this.paintColor) return;
    this.setStickerColor(s, this.paintColor);
    s.userData.pop = 1;
    this.onPaint?.();
  }

  private dragMove(e: PointerEvent) {
    const d = this.drag!;
    const drag = new THREE.Vector2(e.clientX - d.startX, e.clientY - d.startY);

    if (!d.turning) {
      if (drag.length() < 8) return;
      if (this.busy) return;
      // Which of the two in-face directions does the drag follow on screen?
      const p0 = this.toScreen(d.hitLocal);
      let best: { t: THREE.Vector3; s: THREE.Vector2; score: number } | null = null;
      for (const a of AXES) {
        if (Math.abs(d.normal[a]) > 0) continue;
        const t = AXIS_VEC[a];
        const s = this.toScreen(d.hitLocal.clone().add(t)).sub(p0);
        const score = Math.abs(drag.dot(s)) / (s.length() || 1);
        if (!best || score > best.score) best = { t, s, score };
      }
      if (!best) return;
      // Positive rotation about n × t moves the touched point along +t.
      const r = new THREE.Vector3().crossVectors(d.normal, best.t);
      const { axis, sign } = dominantAxis(r);
      d.axis = axis;
      d.angleSign = sign;
      d.layer = d.cubie.userData.coord[AXIS_INDEX[axis]];
      d.pxPerUnit = best.s.length();
      d.screenDir = best.s.clone().normalize();
      d.turning = true;
      this.startTurn(this.layerCubies(axis, [d.layer]), axis);
    }

    const along = drag.dot(d.screenDir!) / d.pxPerUnit!; // world units along +t
    const angle = (d.angleSign! * along) / 1.35;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT) / 1000;
    d.velocity = d.velocity * 0.6 + ((angle - d.angle) / dt) * 0.4;
    d.angle = angle;
    d.lastT = now;
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.rotation[d.axis!] = angle;
  }

  private dragEnd(cancelled: boolean) {
    const d = this.drag!;
    this.drag = null;
    if (!d.turning) return;
    // A flick carries the turn through; a slow release snaps to the nearest.
    const flick = cancelled ? 0 : THREE.MathUtils.clamp(d.velocity * 0.09, -0.45, 0.45);
    const quarters = cancelled ? 0 : Math.round(d.angle / QUARTER + flick);
    const cubies = this.pivot.children.filter((c) => (c as Cubie).userData.coord) as Cubie[];
    this.anim = {
      cubies,
      axis: d.axis!,
      from: d.angle,
      to: quarters * QUARTER,
      quarters,
      layer: d.layer!,
      duration: THREE.MathUtils.clamp(Math.abs(quarters * QUARTER - d.angle) * 0.22, 0.12, 0.32),
      elapsed: 0,
      ease: (t) => easeOutBack(t, 1.4),
      name: nameTurn(d.axis!, d.layer!, quarters),
      source: "drag",
      resolve: () => {},
    };
  }

  // --- frame loop ---------------------------------------------------------

  private fitDistance(): number {
    const aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight);
    return (13.6 * this.opts.fit) / Math.min(1, aspect * 1.4);
  }

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.camera.position.setLength(this.fitDistance());
    this.controls.minDistance = this.fitDistance() * 0.7;
    this.controls.maxDistance = this.fitDistance() * 1.8;
  }

  private frame(timestamp: number) {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    this.time += dt;

    if (!this.anim && !this.drag?.turning && !this.flights.size) this.nextQueued();
    if (this.anim) {
      const a = this.anim;
      a.elapsed += dt;
      const p = clamp01(a.elapsed / a.duration);
      this.pivot.rotation.set(0, 0, 0);
      this.pivot.rotation[a.axis] = a.from + (a.to - a.from) * a.ease(p);
      if (p >= 1) this.finishTurn(a);
    }

    // Spacing: eased toward the explode target, plus a springy "pop".
    this.spacing += (this.spacingTarget - this.spacing) * (1 - Math.exp(-dt * 7));
    this.popVel += -this.pop * 90 * dt;
    this.popVel *= Math.exp(-7 * dt);
    this.pop += this.popVel * dt;
    const base = this.spacing;
    this.spacing = base + this.pop;
    this.layout();
    this.updateFlights(dt);
    this.spacing = base;

    // Root: idle float, spring tilt from turns, celebration spin.
    const k = 60;
    const damp = 9;
    this.tiltVel.addScaledVector(this.tilt, -k * dt).multiplyScalar(Math.exp(-damp * dt));
    this.tilt.addScaledVector(this.tiltVel, dt);
    if (this.spin.t < 1) this.spin.t = Math.min(1, this.spin.t + dt / this.spin.duration);
    const spinY = this.spin.t < 1 ? easeInOutCubic(this.spin.t) * Math.PI * 2 : 0;

    if (this.upright) {
      const u = this.upright;
      u.t = Math.min(1, u.t + dt / 0.7);
      this.viewQuat.slerpQuaternions(u.from, this.tmpQ.identity(), easeInOutCubic(u.t));
      if (u.t >= 1) {
        this.viewQuat.identity();
        this.upright = null;
        u.done();
      }
    } else if (!this.look && this.viewVel.lengthSq() > 1) {
      this.rotateView(this.viewVel.x * dt, this.viewVel.y * dt);
      this.viewVel.multiplyScalar(Math.exp(-dt * 6));
    }

    // World-vertical celebration spin, then where you've turned it, then the
    // springy tilt from turns (in the cube's own axes).
    const tiltQ = this.tmpQ2.setFromEuler(this.tmpE.set(this.tilt.x * 0.12, this.tilt.y * 0.12, this.tilt.z * 0.12));
    this.root.quaternion
      .setFromAxisAngle(AXIS_VEC.y, spinY)
      .multiply(this.viewQuat)
      .multiply(tiltQ);
    this.root.position.y = this.reducedMotion ? 0 : Math.sin(this.time * 1.2) * 0.06;

    for (const s of this.stickers) {
      const u = s.userData;
      if (u.pop === 0) continue;
      if (u.pop < 0) {
        u.pop += dt; // waiting out a ripple delay
        if (u.pop >= 0) u.pop = 1;
        continue;
      }
      u.pop = Math.max(0, u.pop - dt * 4);
      const v = (u.pop > 0 ? 1 + Math.sin(u.pop * Math.PI) * 0.22 : 1) * this.skins[u.cubie.userData.skin].stickerScale;
      s.scale.set(v, v, 1);
    }

    this.updateSkinWave(dt);
    this.syncInnards();
    this.confetti.update(dt);
    this.controls.update();

    if (this.screen === "off") this.renderer.render(this.scene, this.camera);
    else this.composer.render();
  }
}

