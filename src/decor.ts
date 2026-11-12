// Losowe dekoracje wzdłuż trasy: skaczący kibice i pęki balonów.
import * as THREE from 'three';
import { Track } from './track';
import { hash } from './geo';

const SHIRTS = [0xff3b5c, 0xffb400, 0x00c2ff, 0x7bd82b, 0xff7ad9, 0x9b5cff, 0xff7a1a, 0xffffff];
const SKIN = [0xf6c9a4, 0xe0a67a, 0xb97a4f, 0x8a5a3a];
const BALLOON = [0xff2e63, 0xffd400, 0x00d1ff, 0x5dde3c, 0xff8a00, 0xb14cff, 0xff6ec7];

export function buildDecor(track: Track, blocked: (x: number, z: number) => boolean): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group();
  const half = track.width / 2;
  const fans: { x: number; z: number; rot: number; ph: number; s: number; shirt: number; skin: number }[] = [];
  const bal: { x: number; y: number; z: number; ph: number; col: number }[] = [];
  const posts: number[][] = [];
  const gates = track.closed ? [track.startIdx] : [track.startIdx, track.finishIdx];

  for (let i = 0; i < track.N; i += 3) {
    if (track.y[i] > 0.3) continue; // przy rampie i na wiadukcie nie stawiamy dekoracji
    const p = track.pts[i], n = track.nor[i], t = track.tan[i];
    const nearGate = gates.some((g) => Math.min(Math.abs(i - g), track.closed ? track.N - Math.abs(i - g) : 1e9) < 14);
    for (const s of [-1, 1]) {
      const r = hash(i * 13 + s * 5 + 3);
      if (nearGate || r < 0.2) {
        // grupka kibiców twarzą do toru, przy bramkach gęściej i w dwóch rzędach
        const cnt = nearGate ? 5 : 2 + Math.floor(hash(i + s * 3) * 4);
        for (let k = 0; k < cnt; k++)
          for (let row = 0; row < (nearGate ? 2 : 1); row++) {
            const along = (k - cnt / 2) * 0.95 + (hash(i * 31 + k) - 0.5) * 0.3;
            const d = half + 1.5 + row * 1.0 + hash(i * 17 + k + row) * 0.5;
            const x = p[0] + n[0] * s * d + t[0] * along, z = p[1] + n[1] * s * d + t[1] * along;
            if (blocked(x, z)) continue;
            const id = i * 101 + k * 7 + row + (s > 0 ? 50000 : 0);
            fans.push({ x, z, rot: Math.atan2(-n[0] * s, -n[1] * s), ph: hash(id) * 6.28, s: 0.85 + hash(id + 1) * 0.4, shirt: SHIRTS[Math.floor(hash(id + 2) * SHIRTS.length)], skin: SKIN[Math.floor(hash(id + 3) * SKIN.length)] });
          }
      } else if (r > 0.84) {
        const x = p[0] + n[0] * s * (half + 0.9), z = p[1] + n[1] * s * (half + 0.9);
        if (blocked(x, z)) continue;
        posts.push([x, z]);
        for (let k = 0; k < 3; k++) {
          const id = i * 211 + k + (s > 0 ? 7000 : 0);
          bal.push({ x: x + (hash(id) - 0.5) * 0.7, y: 2.7 + k * 0.5 + hash(id + 1) * 0.3, z: z + (hash(id + 2) - 0.5) * 0.7, ph: hash(id + 3) * 6.28, col: BALLOON[Math.floor(hash(id + 4) * BALLOON.length)] });
        }
      }
    }
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  let body: THREE.InstancedMesh | null = null, head: THREE.InstancedMesh | null = null, arms: THREE.InstancedMesh | null = null;
  if (fans.length) {
    const lam = () => new THREE.MeshLambertMaterial({ flatShading: true });
    body = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.34, 1.15, 6).translate(0, 0.6, 0), lam(), fans.length);
    head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.25, 7, 5).translate(0, 1.45, 0), lam(), fans.length);
    arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.13, 0.13).translate(0, 1.25, 0), lam(), fans.length);
    fans.forEach((f, i) => {
      body!.setColorAt(i, col.set(f.shirt));
      arms!.setColorAt(i, col.set(f.shirt));
      head!.setColorAt(i, col.set(f.skin));
    });
    for (const im of [body, head, arms]) {
      im.frustumCulled = false;
      group.add(im);
    }
  }
  let ball: THREE.InstancedMesh | null = null;
  if (bal.length) {
    ball = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 8, 6).scale(1, 1.2, 1), new THREE.MeshLambertMaterial({ emissive: 0x222222 }), bal.length);
    bal.forEach((b, i) => ball!.setColorAt(i, col.set(b.col)));
    ball.frustumCulled = false;
    group.add(ball);
    const strings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 3).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), bal.length);
    bal.forEach((b, i) => {
      m.compose(v.set(b.x, 0.9, b.z), q.identity(), sc.set(1, b.y - 1.3, 1));
      strings.setMatrixAt(i, m);
    });
    strings.frustumCulled = false;
    group.add(strings);
  }

  const update = (t: number) => {
    if (body && head && arms) {
      for (let i = 0; i < fans.length; i++) {
        const f = fans[i];
        const jump = Math.max(0, Math.sin(t * 5 + f.ph)) * 0.38;
        q.setFromAxisAngle(up, f.rot);
        m.compose(v.set(f.x, jump, f.z), q, sc.set(f.s, f.s, f.s));
        body.setMatrixAt(i, m);
        head.setMatrixAt(i, m);
        // ręce w górę przy wyskoku
        m.compose(v.set(f.x, jump + (jump > 0.05 ? 0.35 * f.s : 0), f.z), q, sc.set(f.s, f.s, f.s));
        arms.setMatrixAt(i, m);
      }
      body.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = arms.instanceMatrix.needsUpdate = true;
    }
    if (ball) {
      for (let i = 0; i < bal.length; i++) {
        const b = bal[i];
        m.compose(v.set(b.x + Math.sin(t * 1.3 + b.ph) * 0.12, b.y + Math.sin(t * 2 + b.ph) * 0.08, b.z + Math.cos(t * 1.1 + b.ph) * 0.12), q.identity(), sc.set(1, 1, 1));
        ball.setMatrixAt(i, m);
      }
      ball.instanceMatrix.needsUpdate = true;
    }
  };
  update(0);
  console.log('fans', fans.length, 'balloons', bal.length);
  return { group, update };
}
