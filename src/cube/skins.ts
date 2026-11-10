// Skins: a body material, six sticker materials (U R F D L B colour order:
// white red green yellow orange blue), and a blank for unpainted stickers.
import * as THREE from "three";

export const SKINS = ["classic", "toon", "metal", "glass"] as const;
export type SkinName = (typeof SKINS)[number];

export interface Skin {
  body: THREE.Material;
  /** Black inner mechanism that plugs the gaps between cubies; null shows through. */
  core: THREE.Material | null;
  stickers: THREE.Material[];
  blank: THREE.Material;
  /** Ink inverted-hull outline around each cubie. */
  outline: boolean;
  bodyCastsShadow: boolean;
  envIntensity: number;
  /** Which reflection environment: soft room, contrasty studio, or none. */
  env: "room" | "studio" | "none";
  stickerScale: number;
  /** Turns wind up and overshoot, like a cartoon. */
  bouncy: boolean;
}

const INK = 0x191611;

function toonRamp(): THREE.DataTexture {
  // Three hard bands of light: shadow, mid, lit.
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function createSkins(classicHex: number[], blankHex: number): Record<SkinName, Skin> {
  const ramp = toonRamp();

  const classic: Skin = {
    body: new THREE.MeshPhysicalMaterial({ color: INK, roughness: 0.42, clearcoat: 0.35 }),
    core: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.9 }),
    stickers: classicHex.map(
      (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
    ),
    blank: new THREE.MeshPhysicalMaterial({ color: blankHex, roughness: 0.9 }),
    outline: false,
    bodyCastsShadow: true,
    envIntensity: 0.55,
    env: "room",
    stickerScale: 1,
    bouncy: false,
  };

  // Flat bands of colour, fat ink outlines, punchier stickers.
  const toonHex = [0xffffff, 0xff3f3a, 0x22cc66, 0xffd600, 0xff8c1a, 0x2d7dff];
  const toon: Skin = {
    body: new THREE.MeshToonMaterial({ color: 0x23201a, gradientMap: ramp }),
    core: new THREE.MeshToonMaterial({ color: 0x23201a, gradientMap: ramp }),
    stickers: toonHex.map((c) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp })),
    blank: new THREE.MeshToonMaterial({ color: 0xb8ad9c, gradientMap: ramp }),
    outline: true,
    bodyCastsShadow: true,
    envIntensity: 0,
    env: "none",
    stickerScale: 1.03,
    bouncy: true,
  };

  // Brushed gunmetal body; chrome, gold and anodised-aluminium stickers.
  const metalStickers: [number, number, number][] = [
    // colour, metalness, roughness
    [0xf2f2f2, 1, 0.08], // chrome
    [0xff3344, 0.8, 0.26],
    [0x22cc77, 0.8, 0.26],
    [0xffcc55, 1, 0.16], // gold
    [0xff8a2a, 0.8, 0.26],
    [0x3a74ff, 0.8, 0.26],
  ];
  const metal: Skin = {
    body: new THREE.MeshPhysicalMaterial({
      color: 0x8a8e96,
      metalness: 1,
      roughness: 0.2,
      anisotropy: 0.85,
    }),
    core: new THREE.MeshStandardMaterial({ color: 0x2b2c30, metalness: 0.6, roughness: 0.6 }),
    stickers: metalStickers.map(
      ([color, metalness, roughness]) =>
        new THREE.MeshPhysicalMaterial({ color, metalness, roughness, clearcoat: 1, clearcoatRoughness: 0.08 }),
    ),
    blank: new THREE.MeshPhysicalMaterial({ color: 0x8a8d93, metalness: 1, roughness: 0.6 }),
    outline: false,
    bodyCastsShadow: true,
    envIntensity: 1.15,
    env: "studio",
    stickerScale: 1,
    bouncy: false,
  };

  // Ice-blue glass cubies with opaque inlays, shrunk a little so more glass
  // shows. Opaque stickers are what the glass refracts, so you see the far
  // side of the cube bent (with rainbow dispersion) through the near side.
  const glass: Skin = {
    body: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.03,
      transmission: 1,
      thickness: 1.2,
      ior: 1.52,
      dispersion: 4,
      attenuationColor: new THREE.Color(0x9fd4e6),
      attenuationDistance: 1.1,
      iridescence: 0.35,
      iridescenceIOR: 1.3,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    }),
    core: null,
    stickers: classicHex.map(
      (c) =>
        new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }),
    ),
    blank: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.55, transmission: 0.9, thickness: 0.2 }),
    outline: false,
    bodyCastsShadow: false,
    envIntensity: 1,
    env: "studio",
    stickerScale: 0.9,
    bouncy: false,
  };

  return { classic, toon, metal, glass };
}

export const outlineMaterial = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

/**
 * A dark studio with a few bright softboxes. Polished metal and glass only
 * look like metal and glass when they have hard highlights to reflect.
 */
export function studioScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(20, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0x6f6b64, side: THREE.BackSide }),
  );
  scene.add(room);
  const panel = (w: number, h: number, intensity: number, pos: [number, number, number], warm = false) => {
    const m = new THREE.MeshBasicMaterial({ color: warm ? 0xffe2c0 : 0xffffff, side: THREE.DoubleSide });
    m.color.multiplyScalar(intensity);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  panel(10, 10, 3.5, [0, 9.5, 0]); // overhead box
  panel(2, 12, 7, [8, 1, 4]); // key strip, right
  panel(2, 12, 4.5, [-8, 1, 3], true); // fill strip, left
  panel(14, 2, 4, [0, 3, -9]); // rim, behind
  panel(12, 6, 2.2, [0, -9, 4], true); // floor bounce
  panel(6, 6, 1.6, [2, 2, 9.5]); // front fill
  return scene;
}
