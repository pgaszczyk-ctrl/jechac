import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Kontrakt GLB: forward = -Z, origin na ziemi pod środkiem,
// węzły: wheel_FL wheel_FR wheel_RL wheel_RR (pivot; dziecko "spin" się obraca), steering_wheel, driver.

export type DriverId = 'general' | 'gryzek' | 'runomistrz' | 'teczka';
export const DRIVERS: { id: DriverId; name: string; tagline: string; color: string }[] = [
  { id: 'general', name: 'General G.', tagline: 'Dowodzi z tylnego siedzenia toru', color: '#ff2638' },
  { id: 'gryzek', name: 'Gryzek', tagline: 'Orzech, gogle, numer 7', color: '#ff8a1f' },
  { id: 'runomistrz', name: 'Runomistrz', tagline: 'Para, runy i rury', color: '#2f6bff' },
  { id: 'teczka', name: 'Tęczka', tagline: 'Kolory na pełnym gazie', color: '#00d8c8' },
];

const mat = (c: number | string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.55, metalness: 0.05, ...o });

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: number[] = [0, 0, 0], rot: number[] = [0, 0, 0], name = '') {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.rotation.set(rot[0], rot[1], rot[2]);
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const sph = (r: number, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const cyl = (r1: number, r2: number, h: number, s = 10) => new THREE.CylinderGeometry(r1, r2, h, s);
const cone = (r: number, h: number, s = 6) => new THREE.ConeGeometry(r, h, s);

function label(text: string, bg: string, fg: string, w = 0.5, h = 0.5) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = bg;
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = fg;
  x.font = 'bold 96px Georgia, serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
}

function base(g: THREE.Group, body: number, trim: number, hub: number) {
  const tire = mat(0x1d1d22, { roughness: 0.95 });
  const hubM = mat(hub, { metalness: 0.6, roughness: 0.4 });
  const W: [string, number, number, number][] = [
    ['wheel_FL', -0.88, 0.36, -1.0],
    ['wheel_FR', 0.88, 0.36, -1.0],
    ['wheel_RL', -0.92, 0.4, 0.95],
    ['wheel_RR', 0.92, 0.4, 0.95],
  ];
  for (const [n, x, r, z] of W) {
    const piv = new THREE.Group();
    piv.name = n;
    piv.position.set(x, r, z);
    const spin = new THREE.Group();
    spin.name = 'spin';
    piv.add(spin);
    const wd = n.includes('R') && n[6] === 'R' && n[5] === 'R' ? 0.42 : 0.3;
    add(spin, cyl(r, r, wd, 12), tire, [0, 0, 0], [0, 0, Math.PI / 2]);
    add(spin, cyl(r * 0.55, r * 0.55, wd + 0.04, 8), hubM, [0, 0, 0], [0, 0, Math.PI / 2]);
    add(spin, box(0.06, r * 1.3, 0.06), hubM, [x < 0 ? -0.2 : 0.2, 0, 0]);
    g.add(piv);
  }
  add(g, box(0.1, 0.1, 1.9), mat(0x333333), [0, 0.38, -1.0], [0, 0, 0]);
  add(g, box(1.5, 0.28, 2.9), mat(body), [0, 0.45, 0.05]);
  add(g, box(1.7, 0.1, 0.5), mat(trim), [0, 0.38, 1.3]);
  const sw = new THREE.Group();
  sw.name = 'steering_wheel';
  sw.position.set(0, 1.0, -0.55);
  sw.rotation.x = -0.9;
  add(sw, new THREE.TorusGeometry(0.28, 0.035, 6, 14), mat(0x222222));
  add(sw, cyl(0.05, 0.05, 0.12, 6), mat(trim), [0, 0, 0], [Math.PI / 2, 0, 0]);
  g.add(sw);
  add(g, cyl(0.04, 0.04, 0.7, 6), mat(0x333333), [0, 0.75, -0.7], [-0.9, 0, 0]);
  const driver = new THREE.Group();
  driver.name = 'driver';
  driver.position.set(0, 0.6, 0.35);
  g.add(driver);
  return driver;
}

function arms(driver: THREE.Group, c: number) {
  for (const s of [-1, 1]) add(driver, cyl(0.07, 0.07, 0.7, 6), mat(c), [s * 0.38, 0.55, -0.35], [-1.15, 0, s * 0.12]);
}

function general(): THREE.Group {
  const g = new THREE.Group();
  const cream = 0xfff3d6, maroon = 0xff2638, gold = 0xffc928;
  const d = base(g, maroon, cream, gold);
  add(g, box(1.1, 0.3, 1.2), mat(maroon), [0, 0.5, -1.4], [0.15, 0, 0]);
  for (const s of [-1, 1]) {
    add(g, box(0.5, 0.55, 0.12), mat(cream), [s * 0.55, 0.6, -1.9], [0.2, s * 0.3, s * 0.2]);
    add(g, box(0.12, 0.4, 0.9), mat(cream), [s * 0.5, 0.6, 1.5]);
  }
  add(g, box(1.7, 0.08, 0.55), mat(maroon), [0, 1.3, 1.6], [0.1, 0, 0]);
  add(d, box(0.7, 0.8, 0.45), mat(cream), [0, 0.5, 0.05]);
  add(d, sph(0.34), mat(0x2b2b31), [0, 1.15, -0.05]);
  add(d, box(0.4, 0.4, 0.15), mat(cream), [0, 1.1, -0.32]);
  for (const s of [-1, 1]) {
    add(d, sph(0.06, 6, 4), mat(0xe8a317, { emissive: 0xaa6600 }), [s * 0.13, 1.2, -0.4]);
    add(d, cone(0.1, 0.55, 5), mat(cream), [s * 0.4, 1.5, -0.05], [0, 0, -s * 0.55]);
    add(d, cone(0.07, 0.4, 5), mat(cream), [s * 0.34, 1.35, 0.1], [0, 0, -s * 0.9]);
    add(d, sph(0.13, 6, 4), mat(gold), [s * 0.45, 0.85, 0.0]);
  }
  add(d, cone(0.1, 0.4, 4), mat(maroon), [0, 1.62, -0.1]);
  const cape = add(d, box(1.1, 0.95, 0.08), mat(maroon, { side: THREE.DoubleSide }), [0, 0.45, 0.42], [-0.18, 0, 0]);
  cape.name = 'cape';
  arms(d, cream);
  return g;
}

function gryzek(): THREE.Group {
  const g = new THREE.Group();
  const wal = 0xff8a1f, teal = 0x12c9a0, gold = 0xffc928;
  const d = base(g, wal, teal, gold);
  const shell = add(g, sph(1, 12, 9), mat(wal), [0, 0.8, 0.1]);
  shell.scale.set(0.95, 0.55, 1.55);
  add(g, box(1.1, 0.12, 1.4), mat(teal), [0, 0.78, 0.25]);
  const n7 = label('7', '#fff6dc', '#0a9d7c', 0.5, 0.5);
  n7.position.set(0, 0.75, -1.55);
  n7.rotation.set(-0.35, Math.PI, 0);
  g.add(n7);
  for (const s of [-1, 1]) add(g, cyl(0.12, 0.12, 0.3, 8), mat(gold, { metalness: 0.7 }), [s * 0.4, 0.55, 1.65], [Math.PI / 2, 0, 0]);
  add(d, box(0.7, 0.55, 0.5), mat(0xe9dcc0), [0, 0.35, 0.05]);
  const hd = add(d, sph(0.42, 12, 9), mat(0xd9732a), [0, 0.95, -0.05]);
  hd.scale.set(1.0, 0.92, 1.0);
  add(d, sph(0.38, 10, 7), mat(0x3a2418), [0, 1.15, 0.12]);
  add(d, box(0.2, 0.5, 0.3), mat(0xf3ead6), [0, 0.95, -0.28]);
  add(d, sph(0.14, 8, 6), mat(0xf3ead6), [0, 0.8, -0.38]);
  add(d, sph(0.05, 6, 4), mat(0xd98a8a), [0, 0.86, -0.5]);
  for (const s of [-1, 1]) {
    add(d, sph(0.06, 6, 4), mat(0x111111), [s * 0.17, 1.02, -0.4]);
    add(d, sph(0.12, 6, 5), mat(0x8c4a4a), [s * 0.36, 1.3, 0.0]);
    add(d, new THREE.TorusGeometry(0.14, 0.04, 6, 10), mat(gold, { metalness: 0.7 }), [s * 0.18, 1.32, -0.28], [0.3, 0, 0]);
    add(d, cyl(0.12, 0.12, 0.04, 10), mat(0x12c9a0, { emissive: 0x0a6a55 }), [s * 0.18, 1.32, -0.3], [Math.PI / 2 + 0.3, 0, 0]);
  }
  add(d, new THREE.TorusGeometry(0.34, 0.1, 6, 12), mat(teal), [0, 0.62, -0.02], [Math.PI / 2, 0, 0]);
  add(d, box(0.25, 0.04, 0.6), mat(teal), [0.3, 0.7, 0.45], [0, -0.5, 0.2]);
  arms(d, 0xe9dcc0);
  return g;
}

function runomistrz(): THREE.Group {
  const g = new THREE.Group();
  const navy = 0x2457ff, gold = 0xffc928, copper = 0xb87333;
  const d = base(g, navy, gold, gold);
  add(g, box(1.2, 0.5, 0.2), mat(navy), [0, 0.7, -1.45], [-0.3, 0, 0]);
  add(g, box(0.5, 0.3, 0.05), mat(gold, { metalness: 0.6 }), [0, 0.78, -1.58], [-0.3, 0, 0]);
  for (const s of [-1, 1]) {
    add(g, cyl(0.17, 0.17, 0.5, 8), mat(0x33ccff, { emissive: 0x1188cc, emissiveIntensity: 1.2, transparent: true, opacity: 0.85 }), [s * 0.6, 1.0, 1.2]);
    add(g, cyl(0.2, 0.2, 0.08, 8), mat(gold, { metalness: 0.7 }), [s * 0.6, 1.28, 1.2]);
    add(g, cyl(0.2, 0.2, 0.08, 8), mat(gold, { metalness: 0.7 }), [s * 0.6, 0.72, 1.2]);
    add(g, cyl(0.06, 0.06, 0.9, 6), mat(copper, { metalness: 0.8 }), [s * 0.3, 0.8, 1.3], [Math.PI / 2, 0, 0]);
    add(g, box(0.08, 0.06, 1.2), mat(gold), [s * 0.78, 0.5, 0.0]);
  }
  add(g, cyl(0.38, 0.38, 0.12, 12), mat(gold, { metalness: 0.7 }), [0, 1.0, 1.55], [Math.PI / 2, 0, 0], 'gear');
  add(g, cyl(0.55, 0.55, 0.5, 8), mat(0x2a2a30), [0, 0.8, 1.35]);
  add(d, box(0.75, 0.8, 0.48), mat(navy), [0, 0.5, 0.05]);
  add(d, box(0.78, 0.12, 0.5), mat(0xff2638), [0, 0.88, 0.05]);
  add(d, sph(0.34, 10, 8), mat(0xf0c9a8), [0, 1.2, -0.05]);
  add(d, cone(0.3, 0.55, 6), mat(0xeeeeee), [0, 0.95, -0.28], [Math.PI + 0.25, 0, 0]);
  add(d, sph(0.14, 6, 5), mat(0xeeeeee), [0, 1.0, -0.35]);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    add(d, new THREE.IcosahedronGeometry(0.2, 0), mat(0xe8e6e0), [Math.cos(a) * 0.3, 1.48 + (i % 2) * 0.05, Math.sin(a) * 0.3 + 0.05]);
  }
  add(d, new THREE.IcosahedronGeometry(0.26, 0), mat(0xe8e6e0), [0, 1.55, 0.05]);
  add(d, new THREE.TorusGeometry(0.17, 0.04, 6, 10), mat(gold, { metalness: 0.7 }), [0, 1.42, -0.3], [0.3, 0, 0]);
  for (const s of [-1, 1]) add(d, box(0.14, 0.04, 0.04), mat(0xe8e6e0), [s * 0.1, 1.28, -0.38], [0, 0, s * 0.3]);
  arms(d, navy);
  return g;
}

function teczka(): THREE.Group {
  const g = new THREE.Group();
  const teal = 0x00d8c8, gold = 0xffc928;
  const rainbow = [0xff2638, 0xff9500, 0xffe600, 0x2fd14a, 0x1e90ff, 0xb44dff];
  const d = base(g, teal, teal, gold);
  add(g, box(1.2, 0.3, 1.1), mat(teal), [0, 0.52, -1.4], [0.12, 0, 0]);
  add(g, box(0.8, 0.2, 0.05), mat(0xf1e8d0), [0, 0.5, -1.97], [0.12, 0, 0]);
  rainbow.forEach((c, i) => {
    for (const s of [-1, 1]) add(g, box(0.04, 0.05, 2.0), mat(c), [s * 0.76, 0.34 + i * 0.05, 0.1]);
    add(g, box(1.7, 0.04, 0.09), mat(c), [0, 1.18 - i * 0.045 + 0.0, 1.72], [0.1, 0, 0]);
  });
  add(g, box(1.8, 0.35, 0.08), mat(teal), [0, 1.0, 1.65], [0.1, 0, 0]);
  rainbow.forEach((c, i) => add(g, box(1.8, 0.04, 0.09), mat(c), [0, 0.88 + i * 0.05, 1.7], [0.1, 0, 0]));
  for (const s of [-1, 1]) {
    add(g, box(0.06, 0.55, 0.08), mat(0x888888), [s * 0.6, 0.75, 1.5]);
    add(g, cyl(0.1, 0.1, 0.4, 8), mat(0x777777, { metalness: 0.8 }), [s * 0.25, 0.55, 1.6], [Math.PI / 2, 0, 0]);
  }
  add(d, box(0.7, 0.7, 0.45), mat(teal), [0, 0.45, 0.05]);
  add(d, box(0.5, 0.2, 0.4), mat(0xf26b5b), [0, 0.12, -0.2]);
  add(d, sph(0.33, 10, 8), mat(0xf0c0a0), [0, 1.1, -0.05]);
  add(d, sph(0.38, 8, 6), mat(0x2a3fd0), [0, 1.22, 0.1]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(d, new THREE.IcosahedronGeometry(0.2, 0), mat(0x2a3fd0), [Math.cos(a) * 0.32, 1.28, Math.sin(a) * 0.32 + 0.05]);
  }
  rainbow.forEach((c, i) => add(d, box(0.5, 0.045, 0.12), mat(c), [-0.25, 1.52 - i * 0.045, -0.2 + i * 0.02], [0, 0, 0.3]));
  add(d, new THREE.TorusGeometry(0.17, 0.04, 6, 10), mat(gold, { metalness: 0.7 }), [0, 1.4, -0.28], [0.3, 0, 0]);
  add(d, box(0.1, 0.1, 0.02), mat(0xfb8c00), [0.18, 1.0, -0.37]);
  arms(d, teal);
  return g;
}

const MAKERS: Record<DriverId, () => THREE.Group> = { general, gryzek, runomistrz, teczka };

export function makeKart(id: DriverId): THREE.Group {
  const g = MAKERS[id]();
  g.name = 'kart_' + id;
  return g;
}

export function steerKart(k: THREE.Object3D, steer: number, spin: number) {
  for (const n of ['wheel_FL', 'wheel_FR']) {
    const w = k.getObjectByName(n);
    if (w) w.rotation.y = steer * 0.45; // steer > 0 = w lewo, tak jak obrót gokarta i kierownicy
  }
  for (const n of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) {
    const s = k.getObjectByName(n)?.getObjectByName('spin');
    if (s) s.rotation.x += spin;
  }
  const sw = k.getObjectByName('steering_wheel');
  if (sw) sw.rotation.z = steer * 0.9;
  const cape = k.getObjectByName('cape');
  if (cape) cape.rotation.x = -0.18 - Math.min(0.5, Math.abs(spin) * 2);
}

export function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xeaf6ff, 0xa9d68a, 1.35));
  const d = new THREE.DirectionalLight(0xfff2dd, 2.0);
  d.position.set(40, 90, 30);
  scene.add(d);
}

export function renderThumbnails(): Record<DriverId, string> {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(320, 240);
  r.setPixelRatio(1);
  const out: any = {};
  for (const d of DRIVERS) {
    const s = new THREE.Scene();
    addLights(s);
    const k = makeKart(d.id);
    k.rotation.y = Math.PI + 0.55;
    s.add(k);
    const cam = new THREE.PerspectiveCamera(32, 320 / 240, 0.1, 50);
    cam.position.set(4.6, 3.4, 5.2);
    cam.lookAt(0, 0.8, 0);
    r.render(s, cam);
    out[d.id] = r.domElement.toDataURL('image/png');
  }
  r.dispose();
  return out;
}

export async function exportAllGlb() {
  const ex = new GLTFExporter();
  for (const d of DRIVERS) {
    const buf = (await ex.parseAsync(makeKart(d.id), { binary: true })) as ArrayBuffer;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    a.download = `kart_${d.id}.glb`;
    a.click();
    await new Promise((r) => setTimeout(r, 250));
  }
}
