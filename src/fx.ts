// Dym spod kół: pula niskopoligonowych kłębów (jeden InstancedMesh, bufor kołowy).
import * as THREE from 'three';

const N = 260;
const LIFE = 0.85;

export class Smoke {
  mesh: THREE.InstancedMesh;
  private px = new Float32Array(N);
  private py = new Float32Array(N);
  private pz = new Float32Array(N);
  private age = new Float32Array(N).fill(LIFE);
  private head = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.6, depthWrite: false }),
      N
    );
    this.mesh.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) this.mesh.setMatrixAt(i, this.m);
  }

  emit(x: number, y: number, z: number) {
    const i = this.head;
    this.head = (this.head + 1) % N;
    this.px[i] = x + (Math.random() - 0.5) * 0.3;
    this.py[i] = y;
    this.pz[i] = z + (Math.random() - 0.5) * 0.3;
    this.age[i] = 0;
  }

  update(dt: number) {
    for (let i = 0; i < N; i++) {
      if (this.age[i] >= LIFE) continue;
      this.age[i] += dt;
      const t = this.age[i] / LIFE;
      this.py[i] += 1.1 * dt;
      // rośnie, a pod koniec życia szybko znika
      const sc = t >= 1 ? 0 : (0.4 + 1.9 * t) * (t > 0.65 ? (1 - t) / 0.35 : 1);
      this.m.compose(this.v.set(this.px[i], this.py[i], this.pz[i]), this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
