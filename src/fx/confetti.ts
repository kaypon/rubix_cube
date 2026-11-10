// Sticker-sized paper squares in the cube's colours: they burst off the
// cube, tumble, land flat on the floor, lie there a beat, then shrink away.
import * as THREE from "three";

interface Bit {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  landed: boolean;
}

const MAX = 320;
const LIFE = 4.2;

export class Confetti {
  private mesh: THREE.InstancedMesh;
  private bits: Bit[] = [];
  private dummy = new THREE.Object3D();
  private colors: THREE.Color[];

  constructor(scene: THREE.Scene, hex: number[], private floorY: number) {
    this.colors = hex.map((h) => new THREE.Color(h));
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 }),
      MAX,
    );
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  burst(n: number) {
    for (let i = 0; i < n; i++) {
      if (this.bits.length >= MAX) this.bits.shift();
      const dir = new THREE.Vector3().randomDirection();
      dir.y = Math.abs(dir.y) * 1.4 + 0.3;
      dir.normalize();
      this.bits.push({
        pos: dir.clone().multiplyScalar(1.6),
        vel: dir.multiplyScalar(5 + Math.random() * 6),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 10),
        life: LIFE * (0.75 + Math.random() * 0.5),
        landed: false,
      });
      this.mesh.setColorAt(this.bits.length - 1, this.colors[i % this.colors.length]);
    }
    this.syncColors();
  }

  private syncColors() {
    this.bits.forEach((_, i) => this.mesh.setColorAt(i, this.colors[i % this.colors.length]));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    if (!this.bits.length && this.mesh.count === 0) return;
    let removed = false;
    for (const b of this.bits) {
      b.life -= dt;
      if (b.landed) continue;
      b.vel.y -= 14 * dt;
      // Paper flutter: heavy air drag, plus a sideways wobble on the way down.
      b.vel.multiplyScalar(Math.exp(-2.2 * dt));
      b.vel.x += Math.sin(b.life * 7 + b.spin.x) * 3 * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.rot.x += b.spin.x * dt;
      b.rot.y += b.spin.y * dt;
      b.rot.z += b.spin.z * dt;
      if (b.pos.y <= this.floorY + 0.01) {
        b.pos.y = this.floorY + 0.005 + Math.random() * 0.004;
        b.rot.set(-Math.PI / 2, 0, Math.random() * Math.PI);
        b.landed = true;
      }
    }
    const before = this.bits.length;
    this.bits = this.bits.filter((b) => b.life > 0);
    removed = this.bits.length !== before;

    this.bits.forEach((b, i) => {
      this.dummy.position.copy(b.pos);
      this.dummy.rotation.copy(b.rot);
      this.dummy.scale.setScalar(Math.min(1, b.life / 0.5));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.mesh.count = this.bits.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (removed) this.syncColors();
  }
}
