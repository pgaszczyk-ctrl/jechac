import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Kontrakt GLB: forward = -Z, origin na ziemi pod środkiem,
// węzły: wheel_FL wheel_FR wheel_RL wheel_RR (pivot; dziecko "spin" się obraca), steering_wheel, driver.

export type DriverId = 'general' | 'gryzek' | 'runomistrz' | 'teczka' | 'czarlie' | 'niutu';
export const DRIVERS: { id: DriverId; name: string; tagline: string; color: string }[] = [
  { id: 'general', name: 'General G.', tagline: 'Dowodzi z tylnego siedzenia toru', color: '#ff2638' },
  { id: 'gryzek', name: 'Gryzek', tagline: 'Orzech, gogle, numer 7', color: '#ff8a1f' },
  { id: 'runomistrz', name: 'Runomistrz', tagline: 'Para, runy i rury', color: '#2f6bff' },
  { id: 'teczka', name: 'Tęczka', tagline: 'Kolory na pełnym gazie', color: '#00d8c8' },
  { id: 'czarlie', name: 'Czarlie B.', tagline: 'Drewniana skrzynka i zygzak', color: '#f5b921' },
  { id: 'niutu', name: 'Niutu', tagline: 'Kosmiczny kot w fiolecie', color: '#9461e6' },
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
  x.font = "96px 'Lilita One', 'Arial Black', Impact, sans-serif";
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

// burty wycięte z profilu (z, y) — wspólne dla bolidów o kanciastym nadwoziu
function sidePanels(g: THREE.Group, P: number[][], c: number, x = 0.74) {
  const sh = new THREE.Shape();
  P.forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2); // kształt (x,y) -> (z,y), grubość wzdłuż -x
  for (const s of [-1, 1]) add(g, geo, mat(c), [s * x + 0.04, 0, 0]);
}
const wheelSpokes = (g: THREE.Group, c: number) => {
  for (const n of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) {
    const spin = g.getObjectByName(n)!.getObjectByName('spin')!;
    const s = n.endsWith('L') ? -1 : 1;
    for (let k = 0; k < 4; k++) add(spin, box(0.03, 0.5, 0.045), mat(c, { metalness: 0.6, roughness: 0.35 }), [s * 0.2, 0, 0], [(k * Math.PI) / 4, 0, 0]);
  }
};
const laurel = (x: CanvasRenderingContext2D) => {
  x.strokeStyle = x.fillStyle = '#ffc928';
  x.lineWidth = 6;
  for (const s of [-1, 1])
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 2 + s * (0.35 + k * 0.42);
      x.beginPath();
      x.ellipse(64 + Math.cos(a) * 40, 68 + Math.sin(a) * 40, 12, 5, a + s * 1.0, 0, 7);
      x.fill();
    }
};
const runes = (x: CanvasRenderingContext2D) => {
  x.strokeStyle = '#ffc928';
  x.lineWidth = 7;
  x.lineCap = 'round';
  const R: number[][][] = [
    [[0, 0, 0, 1], [0, 0, 0.6, 0.25], [0.6, 0.25, 0, 0.5], [0, 0.5, 0.6, 1]],
    [[0, 0, 0, 1], [0, 0, 0.6, 0.3], [0.6, 0.3, 0, 0.55]],
    [[0.3, 0, 0.3, 1], [0, 0.3, 0.3, 0], [0.6, 0.3, 0.3, 0]],
    [[0, 0, 0, 1], [0, 0.5, 0.6, 0], [0, 0.5, 0.6, 1]],
  ];
  R.forEach((r, i) => {
    for (const l of r) {
      x.beginPath();
      x.moveTo(10 + i * 29 + l[0] * 20, 40 + l[1] * 48);
      x.lineTo(10 + i * 29 + l[2] * 20, 40 + l[3] * 48);
      x.stroke();
    }
  });
};
const runeTree = (x: CanvasRenderingContext2D) => {
  x.strokeStyle = '#ffc928';
  x.lineWidth = 9;
  x.lineCap = 'round';
  for (const l of [[64, 18, 64, 112], [64, 40, 36, 22], [64, 40, 92, 22], [64, 66, 36, 48], [64, 66, 92, 48], [64, 92, 40, 106], [64, 92, 88, 106]]) {
    x.beginPath();
    x.moveTo(l[0], l[1]);
    x.lineTo(l[2], l[3]);
    x.stroke();
  }
};
const disc = (text: string, fg: string) => (x: CanvasRenderingContext2D) => {
  x.fillStyle = '#fff3d6';
  x.beginPath();
  x.arc(64, 64, 56, 0, 7);
  x.fill();
  x.lineWidth = 6;
  x.strokeStyle = '#ffc928';
  x.stroke();
  x.fillStyle = fg;
  x.font = "84px 'Lilita One', 'Arial Black', Impact, sans-serif";
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 64, 70);
};
const acorn = (x: CanvasRenderingContext2D) => {
  x.fillStyle = '#fff3d6';
  x.beginPath();
  x.ellipse(64, 76, 22, 30, 0, 0, 7);
  x.fill();
  x.fillStyle = '#c9952a';
  x.beginPath();
  x.ellipse(64, 50, 28, 16, 0, 0, 7);
  x.fill();
  x.fillRect(61, 26, 6, 12);
  laurel(x);
};
const RAINBOW = [0xff2638, 0xff9500, 0xffe600, 0x2fd14a, 0x1e90ff, 0xb44dff];
const rainbowCloud = (x: CanvasRenderingContext2D) => {
  RAINBOW.forEach((c, i) => {
    x.strokeStyle = '#' + c.toString(16).padStart(6, '0');
    x.lineWidth = 7;
    x.beginPath();
    x.arc(64, 84, 50 - i * 7, Math.PI, 0);
    x.stroke();
  });
  x.fillStyle = '#fff';
  for (const [cx, cy, r] of [[24, 88, 14], [40, 80, 16], [52, 92, 13], [100, 90, 12], [88, 86, 12]]) {
    x.beginPath();
    x.arc(cx, cy, r, 0, 7);
    x.fill();
  }
};
const place = (m: THREE.Object3D, parent: THREE.Object3D, pos: number[], rot: number[] = [0, 0, 0]) => {
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
};

function general(): THREE.Group {
  const g = new THREE.Group();
  const cream = 0xf4e4c0, red = 0xe0213a, gold = 0xffc928, dark = 0x2c2c34;
  const amber = mat(0xffb400, { emissive: 0xff8a00, emissiveIntensity: 1.4 });
  const d = base(g, cream, red, gold);
  wheelRings(g, cream);
  // kanciaste burty: ostry nos, niski kokpit, wysoki tył z czerwonym pasem
  sidePanels(g, [[-2.15, 0.2], [-2.0, 0.34], [-1.2, 0.8], [-0.9, 0.8], [-0.5, 0.5], [0.55, 0.5], [0.95, 0.9], [1.6, 0.9], [1.65, 0.24]], cream);
  for (const s of [-1, 1]) {
    // dwa „kły" przedniej osłony z ciemnymi wlotami
    add(g, box(0.52, 0.42, 1.0), mat(cream), [s * 0.42, 0.52, -1.55], [0.28, -s * 0.22, 0]);
    add(g, box(0.34, 0.07, 0.06), mat(dark), [s * 0.44, 0.44, -2.02], [0.28, -s * 0.22, 0]);
    add(g, box(0.34, 0.07, 0.06), mat(dark), [s * 0.44, 0.56, -1.98], [0.28, -s * 0.22, 0]);
    add(g, box(0.03, 0.3, 0.5), mat(red), [s * 0.8, 0.6, 1.3]);
    for (const k of [0, 1]) add(g, box(0.03, 0.2, 0.07), mat(dark), [s * 0.8, 0.42, 0.25 + k * 0.16], [0.5, 0, 0]);
    add(g, sph(0.07, 6, 4), mat(gold, { metalness: 0.7 }), [s * 0.8, 0.36, -1.0]);
    add(g, sph(0.07, 6, 4), mat(gold, { metalness: 0.7 }), [s * 0.84, 0.4, 0.95]);
    // tylne skrzydło na wspornikach
    add(g, box(0.08, 0.75, 0.12), mat(cream), [s * 0.5, 1.15, 1.6], [0.35, 0, 0]);
    add(g, box(0.07, 0.34, 0.62), mat(red), [s * 0.98, 1.5, 1.85]);
  }
  add(g, box(0.24, 0.3, 1.15), mat(red), [0, 0.5, -1.6], [0.3, 0, 0]); // czerwony klin na nosie
  add(g, box(1.95, 0.09, 0.55), mat(red), [0, 1.5, 1.85], [0.08, 0, 0]);
  // tył: beżowa rama i złote żebra
  add(g, box(1.3, 0.5, 0.12), mat(cream), [0, 0.62, 1.66]);
  for (let k = 0; k < 3; k++) add(g, box(0.8, 0.05, 0.05), mat(gold, { metalness: 0.6 }), [0, 0.5 + k * 0.12, 1.74]);
  add(g, box(0.5, 0.16, 0.1), mat(dark), [0, 0.32, 1.72]);
  // kierowca: czteroręki generał w zbroi, z peleryną i pagonami
  add(d, box(0.62, 0.7, 0.42), mat(dark), [0, 0.42, 0.05]);
  add(d, box(0.5, 0.36, 0.1), mat(cream), [0, 0.55, -0.2]);
  add(d, box(0.3, 0.2, 0.1), mat(cream), [0, 0.26, -0.2]);
  const cape = add(d, box(1.35, 1.05, 0.08), mat(red, { side: THREE.DoubleSide }), [0, 0.42, 0.44], [-0.18, 0, 0]);
  cape.name = 'cape';
  place(badge(laurel, 0.5, 0.5), cape, [0, 0.05, 0.05]);
  add(d, box(1.3, 0.14, 0.5), mat(red), [0, 0.86, 0.2], [0.1, 0, 0]); // kołnierz peleryny
  for (const s of [-1, 1]) {
    add(d, box(0.4, 0.5, 0.6), mat(red), [s * 0.56, 0.62, 0.12], [0, 0, s * 0.25]);
    add(d, cyl(0.2, 0.22, 0.09, 8), mat(gold, { metalness: 0.6 }), [s * 0.56, 0.95, 0.02]);
    for (let k = 0; k < 4; k++) add(d, box(0.05, 0.12, 0.05), mat(gold), [s * (0.44 + k * 0.08), 0.86, -0.2]);
    // dolna para rąk
    add(d, cyl(0.065, 0.065, 0.62, 6), mat(cream), [s * 0.3, 0.3, -0.36], [-1.3, 0, s * 0.2]);
    add(d, sph(0.09, 6, 4), mat(gold, { metalness: 0.6 }), [s * 0.34, 0.36, -0.1]);
    add(d, sph(0.1, 6, 4), mat(cream), [s * 0.26, 0.4, -0.66]);
    add(d, sph(0.1, 6, 4), mat(cream), [s * 0.36, 0.72, -0.66]);
    add(d, sph(0.09, 6, 4), mat(gold, { metalness: 0.6 }), [s * 0.4, 0.62, -0.05]);
    // hełm: rogi, płyty czoła, skośne bursztynowe oczy, słuchawka z laurem
    add(d, cone(0.1, 0.7, 4), mat(cream), [s * 0.46, 1.52, 0.02], [0.15, 0, -s * 0.55]);
    add(d, cone(0.08, 0.45, 4), mat(cream), [s * 0.4, 1.36, 0.22], [0.5, 0, -s * 0.8]);
    add(d, box(0.2, 0.1, 0.55), mat(cream), [s * 0.17, 1.46, -0.1], [-0.25, 0, s * 0.3]);
    add(d, box(0.15, 0.06, 0.03), amber, [s * 0.12, 1.2, -0.39], [0, 0, s * 0.4]);
    add(d, box(0.14, 0.2, 0.14), mat(cream), [s * 0.2, 1.08, -0.3], [0, 0, s * 0.2]);
    add(d, cyl(0.13, 0.13, 0.08, 10), mat(dark), [s * 0.36, 1.14, 0.06], [0, 0, Math.PI / 2]);
    add(d, new THREE.TorusGeometry(0.1, 0.025, 6, 10), mat(gold, { metalness: 0.7 }), [s * 0.4, 1.14, 0.06], [0, Math.PI / 2, 0]);
  }
  add(d, sph(0.36), mat(dark), [0, 1.2, 0.0]);
  add(d, box(0.4, 0.2, 0.12), mat(cream), [0, 1.3, -0.32], [-0.15, 0, 0]);
  add(d, box(0.26, 0.24, 0.12), mat(cream), [0, 0.98, -0.34]);
  for (let k = -1; k <= 1; k++) add(d, box(0.035, 0.16, 0.02), mat(dark), [k * 0.07, 0.97, -0.405]);
  add(d, box(0.09, 0.42, 0.7), mat(red), [0, 1.6, -0.02], [-0.2, 0, 0]); // czerwony grzebień
  arms(d, cream);
  return g;
}

function gryzek(): THREE.Group {
  const g = new THREE.Group();
  const wal = 0xc8682a, walDark = 0x9a4c1c, teal = 0x10b8a6, gold = 0xffc928, cream = 0xfff0d6, fur = 0x4a2d1e, ginger = 0xee8a2e, leather = 0x6b3d22;
  const d = base(g, walDark, teal, gold);
  wheelRings(g, gold);
  // łupina orzecha: otwarta miska z turkusową wyściółką na krawędzi
  const bowl = add(g, new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, Math.PI * 0.36, Math.PI * 0.64), mat(wal, { side: THREE.DoubleSide }), [0, 0.66, 0.05]);
  bowl.scale.set(1.0, 0.62, 1.78);
  const rim = add(g, new THREE.TorusGeometry(1, 0.085, 6, 24), mat(teal), [0, 0.93, 0.05], [Math.PI / 2, 0, 0]);
  rim.scale.set(0.9, 1.6, 1.2);
  // bruzdy łupiny
  for (const z of [-1.0, -0.35, 0.4, 1.05]) {
    const r = add(g, new THREE.TorusGeometry(1, 0.025, 4, 20, Math.PI), mat(walDark), [0, 0.68, z], [0, 0, Math.PI]);
    const k = Math.sqrt(Math.max(0.05, 1 - ((z - 0.05) / 1.78) ** 2));
    r.scale.set(1.0 * k, 0.62 * k, 1);
  }
  // podwyższony tył łupiny i oparcie
  const back = add(g, sph(0.72, 12, 8), mat(wal), [0, 1.0, 1.5]);
  back.scale.set(1.0, 0.75, 0.4);
  add(g, box(0.95, 0.62, 0.2), mat(teal), [0, 1.05, 1.12], [-0.15, 0, 0]);
  // siódemka z przodu i na bokach, złote reflektory
  place(badge(disc('7', '#0a8f7f'), 0.5, 0.5), g, [0, 0.66, -1.74], [0.35, Math.PI, 0]);
  for (const s of [-1, 1]) {
    place(badge(disc('7', '#0a8f7f'), 0.46, 0.46), g, [s * 1.0, 0.62, 0.05], [0, s * (Math.PI / 2), 0]);
    add(g, cyl(0.17, 0.17, 0.14, 10), mat(gold, { metalness: 0.7, roughness: 0.3 }), [s * 0.5, 0.62, -1.55], [Math.PI / 2 - 0.3, 0, -s * 0.4]);
    add(g, cyl(0.12, 0.12, 0.15, 10), mat(cream, { emissive: 0x554422 }), [s * 0.52, 0.62, -1.58], [Math.PI / 2 - 0.3, 0, -s * 0.4]);
    add(g, cyl(0.11, 0.11, 0.3, 8), mat(gold, { metalness: 0.7 }), [s * 0.18, 0.42, 1.78], [Math.PI / 2, 0, 0]);
    add(g, cyl(0.075, 0.075, 0.32, 8), mat(0x1a1a1a), [s * 0.18, 0.42, 1.79], [Math.PI / 2, 0, 0]);
  }
  place(badge(acorn, 0.55, 0.55), g, [0, 0.9, 1.79], [-0.1, 0, 0]);
  add(g, cyl(0.1, 0.14, 0.4, 8), mat(gold, { metalness: 0.7 }), [0.7, 0.8, 1.62], [Math.PI / 2 - 0.3, 0, 0]); // trąbka wydechu
  // kierowca: trójkolorowa świnka morska w goglach i z turkusową chustą
  const body = add(d, sph(0.42, 10, 8), mat(cream), [0, 0.38, 0.05]);
  body.scale.set(1, 0.95, 0.85);
  add(d, new THREE.TorusGeometry(0.3, 0.1, 6, 12), mat(teal), [0, 0.68, 0.0], [Math.PI / 2, 0, 0]);
  add(d, box(0.6, 0.05, 0.22), mat(teal), [0.5, 0.74, 0.3], [0, -0.5, 0.25]);
  add(d, box(0.5, 0.05, 0.18), mat(teal), [0.45, 0.66, 0.42], [0, -0.8, -0.1]);
  const head = add(d, sph(0.47, 14, 10), mat(cream), [0, 1.1, -0.08]);
  head.scale.set(0.95, 0.95, 1);
  add(d, sph(0.43, 12, 9), mat(fur), [0.17, 1.17, 0.06]);
  add(d, sph(0.43, 12, 9), mat(ginger), [-0.17, 1.17, 0.06]);
  const blaze = add(d, sph(0.3, 10, 8), mat(cream), [0, 1.28, -0.16]);
  blaze.scale.set(0.5, 1, 1);
  const muzzle = add(d, sph(0.24, 10, 8), mat(0xfff6e6), [0, 0.98, -0.4]);
  muzzle.scale.set(1.35, 0.9, 0.8);
  add(d, sph(0.05, 6, 4), mat(0xf29aa6), [0, 1.04, -0.6]);
  add(d, box(0.11, 0.1, 0.03), mat(0xffffff), [0, 0.87, -0.56]);
  add(d, box(0.012, 0.1, 0.035), mat(0xbbbbbb), [0, 0.87, -0.56]);
  for (const s of [-1, 1]) {
    add(d, sph(0.075, 8, 6), mat(0x0e0b0a, { roughness: 0.2 }), [s * 0.25, 1.12, -0.43]);
    add(d, sph(0.022, 5, 4), mat(0xffffff), [s * 0.23, 1.15, -0.5]);
    const ear = add(d, sph(0.15, 8, 6), mat(s > 0 ? 0x8c5a5a : 0xf0a184), [s * 0.44, 1.46, 0.06]);
    ear.scale.set(1, 1, 0.45);
    // gogle na czole
    add(d, new THREE.TorusGeometry(0.15, 0.04, 6, 12), mat(gold, { metalness: 0.7, roughness: 0.3 }), [s * 0.17, 1.47, -0.28], [-0.75, 0, 0]);
    add(d, cyl(0.13, 0.13, 0.05, 12), mat(0x0fb0a0, { emissive: 0x064a44, roughness: 0.15 }), [s * 0.17, 1.47, -0.28], [Math.PI / 2 - 0.75, 0, 0]);
    add(d, cyl(0.1, 0.1, 0.1, 6), mat(leather), [s * 0.36, 0.42, -0.6], [1.15, 0, 0]); // mankiet
    add(d, box(0.2, 0.16, 0.34), mat(leather), [s * 0.2, -0.02, -0.72], [0.5, 0, 0]);
  }
  add(d, new THREE.TorusGeometry(0.44, 0.045, 5, 16), mat(leather), [0, 1.36, -0.02], [Math.PI / 2 - 0.3, 0, 0]);
  add(d, box(0.1, 0.1, 0.04), mat(gold, { metalness: 0.7 }), [0, 1.24, 0.4]);
  arms(d, cream);
  return g;
}

function runomistrz(): THREE.Group {
  const g = new THREE.Group();
  const navy = 0x2a46c4, navyDark = 0x1b2c80, gold = 0xffc928, copper = 0xe8853a, wine = 0xc0263e, hair = 0xf0ede6, skin = 0xf4c9a4;
  const tube = () => mat(0x55dcff, { emissive: 0x22aaff, emissiveIntensity: 1.5, transparent: true, opacity: 0.9 });
  const G = (o: Partial<THREE.MeshStandardMaterialParameters> = {}) => mat(gold, { metalness: 0.7, roughness: 0.3, ...o });
  const d = base(g, navy, gold, gold);
  wheelRings(g, gold);
  wheelSpokes(g, gold);
  sidePanels(g, [[-2.05, 0.24], [-2.0, 0.52], [-1.25, 0.88], [-0.75, 0.88], [-0.4, 0.56], [0.5, 0.56], [0.8, 0.98], [1.62, 0.98], [1.64, 0.24]], navy);
  for (const s of [-1, 1]) {
    // złote okucia burt, runy, zębatka przy kokpicie
    add(g, box(0.04, 0.05, 3.6), G(), [s * 0.8, 0.27, -0.2]);
    add(g, box(0.04, 0.05, 1.0), G(), [s * 0.8, 0.57, 0.05]);
    add(g, box(0.04, 0.05, 0.85), G(), [s * 0.8, 0.98, 1.2]);
    place(badge(runes, 1.0, 1.0), g, [s * 0.805, 0.42, 0.15], [0, s * (Math.PI / 2), 0]);
    add(g, cyl(0.2, 0.2, 0.06, 10), G(), [s * 0.82, 0.78, 0.62], [0, 0, Math.PI / 2]);
    for (let k = 0; k < 8; k++) add(g, box(0.06, 0.08, 0.07), G(), [s * 0.82, 0.78 + Math.sin((k * Math.PI) / 4) * 0.22, 0.62 + Math.cos((k * Math.PI) / 4) * 0.22], [(-k * Math.PI) / 4, 0, 0]);
    // reflektory
    add(g, cyl(0.17, 0.17, 0.16, 10), G(), [s * 0.52, 0.5, -1.98], [Math.PI / 2, 0, 0]);
    add(g, cyl(0.12, 0.12, 0.17, 10), mat(0xfff0b0, { emissive: 0xffc040, emissiveIntensity: 1.2 }), [s * 0.52, 0.5, -2.0], [Math.PI / 2, 0, 0]);
    // świecące lampy elektronowe ze złotymi kapslami
    add(g, cyl(0.15, 0.15, 0.48, 10), tube(), [s * 0.62, 1.22, 1.25]);
    add(g, cyl(0.19, 0.19, 0.09, 10), G(), [s * 0.62, 1.5, 1.25]);
    add(g, cyl(0.19, 0.19, 0.09, 10), G(), [s * 0.62, 0.95, 1.25]);
    add(g, cyl(0.07, 0.12, 0.14, 8), G(), [s * 0.62, 1.6, 1.25]);
    add(g, sph(0.07, 6, 5), G(), [s * 0.62, 1.7, 1.25]);
    // miedziane rury: od lamp do kotła i w dół po bokach
    add(g, cyl(0.055, 0.055, 0.75, 6), mat(copper, { metalness: 0.75, roughness: 0.3 }), [s * 0.36, 1.1, 1.32], [0, 0, Math.PI / 2]);
    add(g, cyl(0.055, 0.055, 0.5, 6), mat(copper, { metalness: 0.75, roughness: 0.3 }), [s * 0.74, 0.86, 1.6]);
    add(g, sph(0.075, 6, 5), mat(copper, { metalness: 0.75 }), [s * 0.74, 1.1, 1.6]);
    add(g, cyl(0.055, 0.055, 0.9, 6), mat(copper, { metalness: 0.75, roughness: 0.3 }), [s * 0.5, 1.0, 0.75], [Math.PI / 2, 0, 0]);
    add(g, box(0.16, 0.1, 0.04), mat(0xff3030, { emissive: 0xcc0000 }), [s * 0.5, 0.42, 1.69]);
    place(badge(runes, 0.5, 0.5), g, [s * 0.4, 0.62, 1.69]);
  }
  // przednia tarcza z runą-drzewem, zderzak z półzębatką
  add(g, box(0.72, 0.62, 0.08), mat(navy), [0, 0.78, -1.5], [-0.42, 0, 0]);
  add(g, box(0.8, 0.06, 0.1), G(), [0, 1.04, -1.37], [-0.42, 0, 0]);
  place(badge(runeTree, 0.5, 0.5), g, [0, 0.8, -1.56], [0.42, Math.PI, 0]);
  add(g, box(1.7, 0.09, 0.1), G(), [0, 0.3, -2.08]);
  add(g, cyl(0.26, 0.26, 0.06, 12), G(), [0, 0.3, -2.06], [Math.PI / 2, 0, 0]);
  add(g, box(1.5, 0.3, 0.1), mat(navyDark), [0, 0.5, -2.0]);
  // kocioł i wielka zębatka z tyłu
  add(g, cyl(0.46, 0.46, 0.7, 10), mat(0x33343c, { metalness: 0.4 }), [0, 0.95, 1.3]);
  add(g, cyl(0.4, 0.4, 0.1, 12), G(), [0, 1.05, 1.7], [Math.PI / 2, 0, 0], 'gear');
  for (let k = 0; k < 10; k++) add(g, box(0.1, 0.1, 0.1), G(), [Math.cos((k * Math.PI) / 5) * 0.43, 1.05 + Math.sin((k * Math.PI) / 5) * 0.43, 1.7], [0, 0, (k * Math.PI) / 5]);
  add(g, box(1.5, 0.5, 0.08), mat(navy), [0, 0.52, 1.64]);
  for (let k = -3; k <= 3; k++) add(g, box(0.035, 0.2, 0.03), G(), [k * 0.07, 0.36, 1.69]);
  // kierowca: siwy mag w goglach, z brodą i monoklem
  add(d, box(0.76, 0.8, 0.48), mat(navy), [0, 0.5, 0.05]);
  add(d, box(0.05, 0.7, 0.02), G(), [0, 0.5, -0.2]);
  add(d, new THREE.TorusGeometry(0.32, 0.11, 6, 12), mat(wine), [0, 0.9, 0.04], [Math.PI / 2, 0, 0]);
  add(d, box(0.5, 0.4, 0.06), mat(wine), [0.22, 0.72, 0.3], [0.2, 0, -0.2]);
  add(d, sph(0.36, 12, 9), mat(skin), [0, 1.2, -0.05]);
  add(d, sph(0.08, 6, 5), mat(0xeeb48c), [0, 1.14, -0.42]);
  // rozwiana czupryna do tyłu
  const H: number[][] = [[0, 1.55, 0.05, 0.3], [-0.26, 1.5, 0.0, 0.24], [0.26, 1.5, 0.0, 0.24], [-0.36, 1.32, 0.12, 0.22], [0.36, 1.32, 0.12, 0.22], [0, 1.45, 0.3, 0.3], [-0.24, 1.3, 0.36, 0.24], [0.24, 1.3, 0.36, 0.24], [0, 1.2, 0.45, 0.24], [0.12, 1.66, -0.12, 0.18], [-0.14, 1.64, -0.14, 0.17]];
  for (const h of H) add(d, new THREE.IcosahedronGeometry(h[3], 0), mat(hair), [h[0], h[1], h[2]]);
  // broda, wąsy, groźne brwi
  add(d, cone(0.3, 0.6, 7), mat(hair), [0, 0.9, -0.26], [Math.PI + 0.25, 0, 0]);
  for (const s of [-1, 1]) {
    const m = add(d, sph(0.14, 8, 6), mat(hair), [s * 0.14, 1.06, -0.4]);
    m.scale.set(1.5, 0.6, 0.7);
    m.rotation.z = -s * 0.35;
    add(d, box(0.2, 0.055, 0.05), mat(hair), [s * 0.15, 1.3, -0.38], [0, 0, s * 0.4]);
    add(d, sph(0.045, 6, 4), mat(0x2a4a8a), [s * 0.14, 1.22, -0.38]);
    add(d, sph(0.09, 6, 5), mat(skin), [s * 0.37, 1.18, 0.0]);
    // gogle na czole
    add(d, new THREE.TorusGeometry(0.13, 0.04, 6, 12), G(), [s * 0.16, 1.45, -0.27], [-0.6, 0, 0]);
    add(d, cyl(0.11, 0.11, 0.05, 12), mat(0x3aa0e0, { emissive: 0x0a3a66, roughness: 0.15 }), [s * 0.16, 1.45, -0.27], [Math.PI / 2 - 0.6, 0, 0]);
    // miedziane rękawice z nitami
    add(d, cyl(0.12, 0.1, 0.3, 8), mat(copper, { metalness: 0.75, roughness: 0.3 }), [s * 0.36, 0.44, -0.56], [1.15, 0, s * 0.12]);
    add(d, sph(0.11, 6, 5), mat(navyDark), [s * 0.34, 0.36, -0.72]);
    add(d, box(0.2, 0.2, 0.42), mat(0x6b3d22), [s * 0.2, 0.0, -0.66], [0.4, 0, 0]);
    add(d, box(0.22, 0.06, 0.1), G(), [s * 0.2, 0.08, -0.6], [0.4, 0, 0]);
    add(d, sph(0.14, 8, 6), mat(navy), [s * 0.42, 0.78, 0.0]);
    add(d, new THREE.TorusGeometry(0.1, 0.02, 5, 10), G(), [s * 0.44, 0.62, -0.2], [1.15, 0, 0]);
  }
  add(d, new THREE.TorusGeometry(0.075, 0.015, 5, 12), G(), [-0.14, 1.22, -0.41]); // monokl
  add(d, cyl(0.008, 0.008, 0.3, 4), G(), [-0.22, 1.08, -0.38], [0, 0, 0.3]);
  add(d, new THREE.TorusGeometry(0.36, 0.035, 5, 16), mat(0x6b3d22), [0, 1.4, -0.03], [Math.PI / 2 - 0.25, 0, 0]);
  arms(d, navy);
  return g;
}

function teczka(): THREE.Group {
  const g = new THREE.Group();
  const teal = 0x12cfc0, tealDark = 0x0a9a90, gold = 0xffc928, steel = 0x9aa1ad, hairC = 0x2a55e6, skin = 0xf7c8a4, coral = 0xff6b5a, leather = 0x7a4a2a;
  const d = base(g, teal, teal, gold);
  wheelRings(g, gold);
  sidePanels(g, [[-2.05, 0.24], [-1.95, 0.56], [-1.3, 0.82], [-0.9, 0.82], [-0.45, 0.5], [0.25, 0.5], [0.9, 1.02], [1.38, 0.92], [1.48, 0.24]], teal);
  for (const s of [-1, 1]) {
    // tęczowy łuk na burcie
    RAINBOW.forEach((c, i) => add(g, new THREE.TorusGeometry(0.7 - i * 0.075, 0.04, 4, 18, Math.PI), mat(c), [s * 0.8, 0.27, 0.62], [0, Math.PI / 2, 0]));
    add(g, box(0.34, 0.14, 0.05), mat(0xfff0d0), [s * 0.58, 0.4, -2.17]); // kratki wlotów
    add(g, box(0.34, 0.03, 0.06), mat(tealDark), [s * 0.58, 0.4, -2.18]);
    add(g, box(0.1, 0.3, 0.12), mat(teal), [s * 0.86, 0.98, -0.55], [0, 0, s * 0.2]); // lusterka
    add(g, sph(0.05, 6, 4), mat(gold, { metalness: 0.7 }), [s * 0.8, 0.7, -1.2]);
    // silnik: rury, tłumiki, wsporniki skrzydła
    add(g, cyl(0.12, 0.12, 0.4, 10), mat(steel, { metalness: 0.8, roughness: 0.3 }), [s * 0.2, 0.52, 1.78], [Math.PI / 2, 0, 0]);
    add(g, cyl(0.085, 0.085, 0.42, 10), mat(0x1c1c20), [s * 0.2, 0.52, 1.79], [Math.PI / 2, 0, 0]);
    add(g, cyl(0.06, 0.06, 1.0, 6), mat(steel, { metalness: 0.8 }), [s * 0.5, 0.75, 1.2], [Math.PI / 2 - 0.2, 0, 0]);
    add(g, cyl(0.045, 0.045, 0.75, 6), mat(steel, { metalness: 0.8 }), [s * 0.62, 0.98, 1.62], [0.25, 0, 0]);
    add(g, box(0.07, 0.42, 0.6), mat(teal), [s * 0.98, 1.34, 1.82], [0.2, 0, 0]);
    add(g, cyl(0.05, 0.05, 0.3, 6), mat(gold, { metalness: 0.7 }), [s * 0.7, 0.5, 1.5], [Math.PI / 2, 0, 0]);
  }
  // nos z tęczą i chmurką, szeroki przedni zderzak
  add(g, box(1.15, 0.3, 1.0), mat(teal), [0, 0.52, -1.5], [-0.14, 0, 0]);
  place(badge(rainbowCloud, 0.7, 0.7), g, [0, 0.7, -1.55], [-Math.PI / 2 - 0.14, 0, Math.PI]);
  add(g, box(1.85, 0.3, 0.32), mat(teal), [0, 0.4, -2.0]);
  add(g, box(0.5, 0.12, 0.2), mat(tealDark), [0, 0.3, -2.1]);
  // blok silnika, czerwona lampa, tylne skrzydło z tęczą
  add(g, box(0.95, 0.5, 0.62), mat(0x5a606c, { metalness: 0.5 }), [0, 0.72, 1.36]);
  for (let k = 0; k < 4; k++) add(g, box(0.7, 0.03, 0.05), mat(steel, { metalness: 0.7 }), [0, 0.6 + k * 0.08, 1.69]);
  add(g, box(0.4, 0.12, 0.06), mat(0xff3030, { emissive: 0xcc0000 }), [0, 1.02, 1.68]);
  add(g, box(1.9, 0.09, 0.5), mat(teal), [0, 1.36, 1.84], [0.2, 0, 0]);
  add(g, box(1.9, 0.3, 0.07), mat(teal), [0, 1.25, 2.06]);
  RAINBOW.forEach((c, i) => {
    add(g, box(1.8, 0.04, 0.03), mat(c), [0, 1.36 - i * 0.045, 2.1]);
    add(g, box(0.07, 0.03, 0.5), mat(c), [-0.75 + i * 0.075, 1.42, 1.84], [0.2, 0, 0]);
  });
  add(g, box(0.8, 0.75, 0.14), mat(0x6a707c), [0, 1.0, 0.98], [-0.12, 0, 0]); // fotel
  // kierowca: dziewczyna z burzą niebieskich włosów, tęczową grzywką i goglami
  add(d, box(0.66, 0.66, 0.44), mat(teal), [0, 0.42, 0.05]);
  for (const s of [-1, 1]) {
    add(d, box(0.08, 0.66, 0.46), mat(leather), [s * 0.2, 0.42, 0.05]); // szelki
    add(d, box(0.09, 0.09, 0.03), mat(gold, { metalness: 0.7 }), [s * 0.2, 0.55, -0.19]);
    add(d, cyl(0.11, 0.1, 0.62, 8), mat(coral), [s * 0.18, 0.06, -0.42], [1.25, 0, 0]);
    add(d, box(0.2, 0.2, 0.36), mat(teal), [s * 0.18, -0.04, -0.82], [0.3, 0, 0]);
    add(d, box(0.21, 0.05, 0.14), mat(0xffe600), [s * 0.18, 0.06, -0.8], [0.3, 0, 0]);
    add(d, sph(0.15, 8, 6), mat(teal), [s * 0.42, 0.66, 0.0]);
    add(d, sph(0.11, 6, 5), mat(leather), [s * 0.35, 0.36, -0.7]); // rękawiczka
    add(d, cyl(0.09, 0.09, 0.1, 6), mat(0xff6b5a), [s * 0.36, 0.44, -0.56], [1.15, 0, 0]);
    // oczy, brwi
    const eye = add(d, sph(0.07, 8, 6), mat(0x1c62d8, { roughness: 0.2 }), [s * 0.15, 1.17, -0.33]);
    eye.scale.set(1, 1.2, 0.5);
    add(d, sph(0.03, 6, 4), mat(0x10131c), [s * 0.15, 1.17, -0.37]);
    add(d, box(0.15, 0.03, 0.03), mat(0x1c3fb0), [s * 0.15, 1.28, -0.34], [0, 0, s * 0.25]);
    // gogle na włosach
    add(d, new THREE.TorusGeometry(0.14, 0.04, 6, 12), mat(gold, { metalness: 0.7, roughness: 0.3 }), [s * 0.17, 1.58, -0.2], [-1.0, 0, 0]);
    add(d, cyl(0.12, 0.12, 0.05, 12), mat(0x14c8b8, { emissive: 0x075a52, roughness: 0.15 }), [s * 0.17, 1.58, -0.2], [Math.PI / 2 - 1.0, 0, 0]);
  }
  add(d, sph(0.35, 12, 9), mat(skin), [0, 1.15, -0.03]);
  add(d, sph(0.04, 6, 4), mat(0xeeb08c), [0, 1.1, -0.38]);
  add(d, box(0.14, 0.025, 0.03), mat(0xc0504a), [0, 1.0, -0.34]);
  // włosy: duża czupryna z kosmykami po bokach i z tyłu
  const HB: number[][] = [[0, 1.42, 0.08, 0.36], [-0.3, 1.3, 0.1, 0.27], [0.3, 1.3, 0.1, 0.27], [-0.4, 1.08, 0.12, 0.2], [0.4, 1.08, 0.12, 0.2], [0, 1.25, 0.34, 0.32], [-0.26, 1.08, 0.36, 0.24], [0.26, 1.08, 0.36, 0.24], [0, 0.98, 0.4, 0.22], [0.22, 1.52, -0.14, 0.2], [-0.42, 1.2, -0.1, 0.16], [0.44, 1.2, -0.08, 0.16]];
  for (const h of HB) add(d, new THREE.IcosahedronGeometry(h[3], 0), mat(hairC), [h[0], h[1], h[2]]);
  // tęczowa grzywka zaczesana na bok
  RAINBOW.forEach((c, i) => add(d, box(0.42, 0.05, 0.14), mat(c), [-0.16, 1.5 - i * 0.045, -0.27 - i * 0.012], [0.25, 0, 0.42]));
  RAINBOW.slice(0, 4).forEach((c, i) => add(d, box(0.1, 0.022, 0.02), mat(c), [0.24, 1.08 - i * 0.025, -0.28], [0, -0.6, 0.3])); // paski na policzku
  // tęczowa chusta powiewająca za plecami
  add(d, new THREE.TorusGeometry(0.27, 0.07, 6, 12), mat(0xff5a8a), [0, 0.8, 0.02], [Math.PI / 2, 0, 0]);
  RAINBOW.forEach((c, i) => add(d, box(0.06, 0.035, 0.75), mat(c), [0.18 + i * 0.055, 0.92 - i * 0.012, 0.62], [0.12, 0.25, 0]));
  add(d, new THREE.TorusGeometry(0.37, 0.035, 5, 16), mat(leather), [0, 1.45, 0.0], [Math.PI / 2 - 0.5, 0, 0]);
  arms(d, skin);
  return g;
}

// okrągła plakietka z literą albo znakiem (rysowana na płótnie)
function badge(draw: (x: CanvasRenderingContext2D) => void, w = 0.5, h = 0.5) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
}
const wheelRings = (g: THREE.Group, c: number) => {
  for (const n of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) {
    const spin = g.getObjectByName(n)!.getObjectByName('spin')!;
    const s = n.endsWith('L') ? -1 : 1;
    add(spin, new THREE.TorusGeometry(0.2, 0.035, 6, 14), mat(c, { metalness: 0.6, roughness: 0.35 }), [s * 0.2, 0, 0], [0, Math.PI / 2, 0]);
  }
};

function czarlie(): THREE.Group {
  const g = new THREE.Group();
  const yel = 0xf5b921, brown = 0x4a2c1a, steel = 0xb9bec8, skin = 0xf4bd8f, leather = 0x7a4326, cream = 0xf3e6c4;
  const d = base(g, yel, yel, steel);
  // boki z deski: niski nos, garb przy kierownicy, wycięcie kokpitu, wysoki tył
  const sh = new THREE.Shape();
  const P: number[][] = [[-1.85, 0.26], [-1.78, 0.55], [-0.8, 1.0], [-0.55, 1.0], [-0.2, 0.64], [0.5, 0.64], [0.85, 1.1], [1.45, 1.05], [1.52, 0.26]];
  P.forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
  for (const s of [-1, 1]) {
    const side = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false });
    side.rotateY(-Math.PI / 2); // kształt (x,y) -> (z,y), grubość wzdłuż -x
    add(g, side, mat(yel), [s * 0.74 + 0.04, 0, 0]);
    // zygzak na burcie
    for (let k = 0; k < 9; k++) add(g, box(0.03, 0.075, 0.3), mat(brown), [s * 0.8, 0.47, -0.75 + k * 0.215], [k % 2 ? 0.8 : -0.8, 0, 0]);
    // nity
    for (const [z, y] of [[-1.7, 0.36], [-0.85, 0.9], [0.9, 0.98], [1.4, 0.95], [1.42, 0.36]]) add(g, sph(0.035, 6, 4), mat(steel, { metalness: 0.7 }), [s * 0.8, y, z]);
    // stalowe osie wystające z kadłuba
    add(g, cyl(0.05, 0.05, 0.3, 6), mat(steel, { metalness: 0.7 }), [s * 0.8, 0.36, -1.0], [0, 0, Math.PI / 2]);
    add(g, cyl(0.05, 0.05, 0.3, 6), mat(steel, { metalness: 0.7 }), [s * 0.8, 0.4, 0.95], [0, 0, Math.PI / 2]);
  }
  add(g, box(1.48, 0.06, 1.08), mat(yel), [0, 0.76, -1.28], [-0.43, 0, 0]); // maska
  add(g, box(1.48, 0.5, 0.08), mat(yel), [0, 0.5, -1.8]); // przód
  add(g, box(1.48, 0.78, 0.08), mat(yel), [0, 0.66, 1.5]); // tył
  const letterB = (x: CanvasRenderingContext2D) => {
    x.fillStyle = '#f3e6c4';
    x.beginPath();
    x.ellipse(64, 64, 60, 50, 0, 0, 7);
    x.fill();
    x.lineWidth = 5;
    x.strokeStyle = '#4a2c1a';
    x.stroke();
    x.fillStyle = '#4a2c1a';
    x.font = "84px 'Lilita One', 'Arial Black', Impact, sans-serif";
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('B', 64, 70);
  };
  const bf = badge(letterB, 0.62, 0.52);
  bf.position.set(0, 0.5, -1.845);
  bf.rotation.y = Math.PI;
  g.add(bf);
  const br = badge(letterB, 0.62, 0.52);
  br.position.set(0, 0.62, 1.545);
  g.add(br);
  // skórzane oparcie
  add(g, box(0.95, 0.75, 0.2), mat(leather, { roughness: 0.5 }), [0, 1.0, 1.2], [-0.12, 0, 0]);
  add(g, cyl(0.1, 0.1, 0.95, 8), mat(leather, { roughness: 0.5 }), [0, 1.38, 1.24], [0, 0, Math.PI / 2]);
  // kierowca: wielka okrągła głowa, czubek włosów, żółta koszulka z zygzakiem
  add(d, box(0.66, 0.6, 0.44), mat(yel), [0, 0.38, 0.05]);
  for (let k = 0; k < 6; k++)
    for (const z of [-0.18, 0.28]) add(d, box(0.14, 0.06, 0.02), mat(brown), [-0.275 + k * 0.11, 0.3, z], [0, 0, k % 2 ? 0.75 : -0.75]);
  add(d, box(0.5, 0.08, 0.3), mat(yel), [0, 0.7, 0.02]);
  add(d, box(0.6, 0.22, 0.5), mat(0x2b2b30), [0, 0.06, -0.08]); // spodenki
  for (const s of [-1, 1]) {
    add(d, cyl(0.09, 0.08, 0.6, 6), mat(skin), [s * 0.17, 0.02, -0.5], [1.25, 0, 0]);
    add(d, box(0.17, 0.14, 0.32), mat(leather), [s * 0.17, -0.08, -0.85]);
    add(d, box(0.17, 0.05, 0.1), mat(cream), [s * 0.17, -0.02, -0.98]);
    add(d, sph(0.13, 8, 6), mat(yel), [s * 0.4, 0.62, 0.0]); // rękaw
    add(d, sph(0.13, 8, 6), mat(skin), [s * 0.56, 1.2, 0.05]); // ucho
    const eye = add(d, sph(0.055, 8, 6), mat(0x16110d, { roughness: 0.3 }), [s * 0.17, 1.33, -0.49]);
    eye.scale.set(0.8, 1.35, 0.5);
    add(d, box(0.14, 0.022, 0.02), mat(brown), [s * 0.19, 1.47, -0.47], [0, 0, -s * 0.35]); // brew
  }
  add(d, sph(0.54, 16, 12), mat(skin), [0, 1.25, 0.0]);
  add(d, sph(0.08, 8, 6), mat(0xeea77c), [0, 1.22, -0.55]); // nos
  const mouth = add(d, sph(0.13, 10, 6), mat(0x7a2418), [0, 1.04, -0.46]);
  mouth.scale.set(1.1, 0.75, 0.5);
  add(d, box(0.14, 0.03, 0.03), mat(0xf7f2e8), [0, 1.09, -0.52]);
  const tuft = add(d, sph(0.26, 10, 7), mat(0x7b4a25), [0.02, 1.78, -0.2]);
  tuft.scale.set(1.15, 0.5, 0.85);
  const curl = add(d, sph(0.15, 8, 6), mat(0x7b4a25), [0.2, 1.84, -0.34]);
  curl.scale.set(1.1, 0.6, 0.8);
  arms(d, skin);
  return g;
}

function niutu(): THREE.Group {
  const g = new THREE.Group();
  const lilac = 0xc2a0f0, mid = 0x9461e6, deep = 0x5a2aa6, gold = 0xf0cc6a, dark = 0x2e1b52;
  const glow = mat(0xfff0c4, { emissive: 0xffd98a, emissiveIntensity: 1.3 });
  const glass = () => mat(0xc79bff, { transparent: true, opacity: 0.55, roughness: 0.12, metalness: 0.1 });
  const eyeMark = (x: CanvasRenderingContext2D) => {
    x.strokeStyle = '#f0cc6a';
    x.lineWidth = 8;
    x.beginPath();
    x.ellipse(64, 64, 46, 22, 0, 0, 7);
    x.stroke();
    x.beginPath();
    x.arc(64, 64, 11, 0, 7);
    x.stroke();
  };
  const d = base(g, mid, deep, deep);
  wheelRings(g, gold);
  // nos z emblematem oka i przednie skrzydło z lampami
  add(g, box(0.74, 0.3, 1.15), mat(deep), [0, 0.56, -1.45], [-0.16, 0, 0]);
  add(g, box(0.5, 0.2, 0.5), mat(mid), [0, 0.5, -2.05], [-0.3, 0, 0]);
  const em = badge(eyeMark, 0.5, 0.5);
  em.position.set(0, 0.74, -1.45);
  em.rotation.set(-Math.PI / 2 - 0.16, 0, Math.PI);
  g.add(em);
  add(g, box(1.95, 0.14, 0.42), mat(lilac), [0, 0.3, -2.0]);
  for (const s of [-1, 1]) {
    add(g, box(0.46, 0.07, 0.05), glow, [s * 0.62, 0.31, -2.215]);
    add(g, box(0.14, 0.3, 0.5), mat(deep), [s * 0.95, 0.38, -1.95]);
    // przezroczyste zbiorniki po bokach ze złotymi obręczami
    add(g, new THREE.CapsuleGeometry(0.27, 0.95, 4, 12), glass(), [s * 0.98, 0.66, 0.2], [Math.PI / 2, 0, 0]);
    for (const z of [-0.3, 0.7]) add(g, new THREE.TorusGeometry(0.28, 0.03, 6, 14), mat(gold, { metalness: 0.7, roughness: 0.3 }), [s * 0.98, 0.66, z]);
    add(g, box(0.14, 0.38, 1.75), mat(lilac), [s * 0.72, 0.72, 0.05]); // burty kokpitu
    add(g, box(0.04, 0.05, 1.3), mat(gold, { metalness: 0.6 }), [s * 0.8, 0.5, 0.05]);
    add(g, box(0.36, 0.09, 0.05), glow, [s * 0.42, 0.72, 1.71]); // tylne lampy
    add(g, box(0.08, 0.6, 0.12), mat(deep), [s * 0.55, 1.05, 1.5], [0.2, 0, 0]); // wsporniki skrzydła
    add(g, box(0.06, 0.3, 0.6), mat(deep), [s * 0.97, 1.36, 1.6]);
  }
  add(g, box(1.3, 0.55, 0.7), mat(deep), [0, 0.66, 1.33]);
  add(g, new THREE.TorusGeometry(0.13, 0.04, 6, 12), mat(gold, { metalness: 0.7 }), [0, 0.5, 1.7]);
  add(g, box(1.95, 0.07, 0.55), mat(mid), [0, 1.36, 1.6], [0.1, 0, 0]); // tylne skrzydło
  for (const k of [0, 1]) add(g, box(0.06, 0.02, 0.34), mat(gold, { metalness: 0.6 }), [0.6 + k * 0.14, 1.4, 1.6], [0.1, 0.5, 0]);
  add(g, box(0.85, 0.8, 0.16), mat(dark), [0, 1.0, 0.95], [-0.12, 0, 0]); // fotel
  // kierowca: fioletowy kot w kurtce ze złotymi lamówkami
  add(d, box(0.66, 0.66, 0.44), mat(deep), [0, 0.4, 0.05]);
  add(d, box(0.68, 0.05, 0.46), mat(gold, { metalness: 0.5 }), [0, 0.7, 0.05]);
  add(d, box(0.05, 0.6, 0.02), mat(gold, { metalness: 0.5 }), [0, 0.4, -0.18]);
  const head = add(d, sph(0.44, 14, 10), mat(lilac), [0, 1.14, -0.02]);
  head.scale.set(1.12, 0.95, 1);
  const muzzle = add(d, sph(0.17, 8, 6), mat(0xdcc8fa), [0, 1.0, -0.38]);
  muzzle.scale.set(1.2, 0.75, 0.7);
  add(d, sph(0.04, 6, 4), mat(0xb46ad6), [0, 1.05, -0.5]);
  const fe = badge(eyeMark, 0.2, 0.2);
  fe.position.set(0, 1.4, -0.4);
  fe.rotation.set(0.45, Math.PI, 0);
  d.add(fe);
  const hair = add(d, sph(0.24, 8, 6), mat(0xd3b8f7), [0.05, 1.56, -0.18]);
  hair.scale.set(1.2, 0.6, 1);
  for (const s of [-1, 1]) {
    // duże spiczaste uszy z ciemnym środkiem
    add(d, cone(0.2, 0.5, 4), mat(lilac), [s * 0.34, 1.62, 0.02], [0, Math.PI / 4, -s * 0.38]);
    add(d, cone(0.11, 0.32, 4), mat(deep), [s * 0.33, 1.58, -0.05], [0, Math.PI / 4, -s * 0.38]);
    // skośne fioletowe oczy
    const eye = add(d, sph(0.1, 8, 6), mat(0x7a2fe0, { emissive: 0x4a12a8, emissiveIntensity: 0.8, roughness: 0.2 }), [s * 0.2, 1.2, -0.4]);
    eye.scale.set(1.25, 0.8, 0.45);
    eye.rotation.z = s * 0.35;
    add(d, sph(0.035, 6, 4), mat(0x150a2a), [s * 0.2, 1.2, -0.45]);
    add(d, box(0.22, 0.03, 0.03), mat(dark), [s * 0.21, 1.3, -0.42], [0, 0, s * 0.35]);
    for (const k of [0, 1]) add(d, box(0.12, 0.022, 0.02), mat(deep), [s * 0.42, 1.02 + k * 0.07, -0.22], [0, s * 0.9, s * 0.2]); // paski na policzkach
    // słuchawki
    add(d, cyl(0.14, 0.14, 0.08, 10), mat(deep), [s * 0.5, 1.12, 0.05], [0, 0, Math.PI / 2]);
    add(d, new THREE.TorusGeometry(0.14, 0.03, 6, 12), mat(gold, { metalness: 0.7 }), [s * 0.54, 1.12, 0.05], [0, Math.PI / 2, 0]);
    add(d, sph(0.13, 8, 6), mat(deep), [s * 0.4, 0.62, 0.0]);
    add(d, new THREE.TorusGeometry(0.085, 0.025, 6, 10), mat(gold, { metalness: 0.6 }), [s * 0.36, 0.42, -0.6], [1.15, 0, 0]);
    add(d, box(0.2, 0.2, 0.5), mat(deep), [s * 0.17, -0.02, -0.55], [0.25, 0, 0]);
    add(d, box(0.2, 0.04, 0.2), mat(gold, { metalness: 0.5 }), [s * 0.17, 0.1, -0.7], [0.25, 0, 0]);
  }
  // puszysty ogon zwinięty w zawijas za fotelem
  const tail: number[][] = [[0.3, 0.3, 0.6], [0.38, 0.55, 0.78], [0.42, 0.85, 0.85], [0.4, 1.15, 0.8], [0.33, 1.38, 0.66], [0.25, 1.48, 0.46], [0.2, 1.4, 0.3], [0.2, 1.24, 0.3]];
  tail.forEach((p, i) => add(d, sph(0.15 + Math.sin((i / 7) * Math.PI) * 0.06, 8, 6), mat(deep), p));
  arms(d, lilac);
  return g;
}

const MAKERS: Record<DriverId, () => THREE.Group> = { general, gryzek, runomistrz, teczka, czarlie, niutu };

export function makeKart(id: DriverId): THREE.Group {
  const g = MAKERS[id]();
  g.name = 'kart_' + id;
  return g;
}

// węzły wyszukujemy raz na kart, a nie w każdej klatce
interface KartNodes { fw: THREE.Object3D[]; spins: THREE.Object3D[]; sw?: THREE.Object3D; cape?: THREE.Object3D }
export function steerKart(k: THREE.Object3D, steer: number, spin: number) {
  let n = k.userData.nodes as KartNodes | undefined;
  if (!n) {
    const get = (name: string) => k.getObjectByName(name);
    n = {
      fw: ['wheel_FL', 'wheel_FR'].map(get).filter(Boolean) as THREE.Object3D[],
      spins: ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map((w) => get(w)?.getObjectByName('spin')).filter(Boolean) as THREE.Object3D[],
      sw: get('steering_wheel'),
      cape: get('cape'),
    };
    k.userData.nodes = n;
  }
  for (const w of n.fw) w.rotation.y = steer * 0.45; // steer > 0 = w lewo, tak jak obrót gokarta i kierownicy
  for (const w of n.spins) w.rotation.x += spin;
  if (n.sw) n.sw.rotation.z = steer * 0.9;
  if (n.cape) n.cape.rotation.x = -0.18 - Math.min(0.5, Math.abs(spin) * 2);
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
