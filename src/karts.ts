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
