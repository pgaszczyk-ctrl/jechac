import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { kerbW, surfY, Track, nearestGlobal, CELL } from './track';
import { pip, hash } from './geo';
import { buildPois, Poi, Bld } from './poi';
import { buildDecor } from './decor';

// wesoła, nasycona paleta (gra dla dzieci)
const WALLS = ['#ffd166', '#ff9f6b', '#ff7b9c', '#7bdff2', '#a8f08f', '#f7aef8', '#fff07a', '#8fc9ff', '#ffb3c6', '#c9b6ff'];
const ROOFS = ['#e63946', '#f77f00', '#2a9d8f', '#3a86ff', '#9d4edd', '#d62828'];

interface Buf {
  pos: number[];
  col: number[];
}

function ribbon(b: Buf, pts: number[][], w: number, y: number, c: THREE.Color, closed: boolean, off = 0, nor?: number[][]) {
  const n = pts.length;
  const L: number[][] = [];
  const R: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const bb = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let tx = bb[0] - a[0];
    let tz = bb[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const nx = -tz;
    const nz = tx;
    const cx = pts[i][0] + nx * off;
    const cz = pts[i][1] + nz * off;
    L.push([cx + nx * (w / 2), cz + nz * (w / 2)]);
    R.push([cx - nx * (w / 2), cz - nz * (w / 2)]);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const q = [L[i], R[i], L[j], R[i], R[j], L[j]];
    for (const p of q) {
      b.pos.push(p[0], y, p[1]);
      b.col.push(c.r, c.g, c.b);
    }
  }
}

// pas między dwoma odsunięciami od linii środkowej (wzdłuż normalnych trasy)
function strip(b: Buf, track: Track, a: (i: number) => number, c: (i: number) => number, y: number, col: THREE.Color) {
  const n = track.N;
  const P = (i: number, o: number) => [track.pts[i][0] + track.nor[i][0] * o, track.pts[i][1] + track.nor[i][1] * o, surfY(track, i, o)];
  for (let i = 0; i < (track.closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    const q = [P(i, a(i)), P(i, c(i)), P(j, a(j)), P(i, c(i)), P(j, c(j)), P(j, a(j))];
    for (const p of q) {
      b.pos.push(p[0], y + p[2], p[1]);
      b.col.push(col.r, col.g, col.b);
    }
  }
}

function toMesh(b: Buf, extra: Partial<THREE.MeshLambertMaterialParameters> = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, ...extra }));
}

function checker(label: string, bg = '#222') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = bg;
  x.fillRect(0, 0, 512, 128);
  x.fillStyle = '#fff';
  x.font = "84px 'Lilita One', 'Arial Black', Impact, sans-serif";
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(label, 256, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function gate(track: Track, idx: number, label: string): THREE.Group {
  const g = new THREE.Group();
  const p = track.pts[idx];
  const t = track.tan[idx];
  const half = track.width / 2;
  const rot = Math.atan2(-t[0], -t[1]);
  g.position.set(p[0], track.y[idx], p[1]);
  g.rotation.y = rot;
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 32;
  const x = cv.getContext('2d')!;
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 4; j++) {
      x.fillStyle = (i + j) % 2 ? '#fff' : '#111';
      x.fillRect(i * 8, j * 8, 8, 8);
    }
  const ct = new THREE.CanvasTexture(cv);
  ct.colorSpace = THREE.SRGBColorSpace;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(track.width, 2.4), new THREE.MeshBasicMaterial({ map: ct, side: THREE.DoubleSide }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.09;
  g.add(line);
  const pm = new THREE.MeshLambertMaterial({ color: 0xd33 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), pm);
    post.position.set(s * (half + 0.9), 3, 0);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(track.width + 3, 1.6, 0.5), new THREE.MeshLambertMaterial({ color: 0x222222 }));
  beam.position.y = 6;
  g.add(beam);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(track.width + 2.6, 1.4), new THREE.MeshBasicMaterial({ map: checker(label) }));
  face.position.set(0, 6, 0.27);
  g.add(face);
  return g;
}

// baner przed nawrotem: żółta tablica UWAGA ze strzałkami i migającymi lampami
function warnBanner(track: Track, idx: number, dir: number, lampA: THREE.Material, lampB: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const p = track.pts[idx], t = track.tan[idx];
  const half = track.width / 2;
  g.position.set(p[0], 0, p[1]);
  g.rotation.y = Math.atan2(-t[0], -t[1]);
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 160;
  const x = cv.getContext('2d')!;
  x.fillStyle = '#ffd400';
  x.fillRect(0, 0, 1024, 160);
  x.fillStyle = '#111';
  for (let i = 0; i < 26; i++) {
    // ukośne pasy ostrzegawcze na górze i dole
    x.save();
    x.transform(1, 0, -0.6, 1, 0, 0);
    x.fillRect(i * 44 + 10, 0, 22, 18);
    x.fillRect(i * 44 + 96, 142, 22, 18);
    x.restore();
  }
  x.font = "92px 'Lilita One', 'Arial Black', Impact, sans-serif";
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const arrow = dir > 0 ? '»»' : '««';
  x.fillText(dir > 0 ? 'UWAGA! NAWRÓT ' + arrow : arrow + ' UWAGA! NAWRÓT', 512, 84);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.MeshLambertMaterial({ color: 0xffd400 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.4, 0.5), pm);
    post.position.set(s * (half + 0.9), 3.2, 0);
    g.add(post);
  }
  const W = track.width + 2.6;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 2, 0.4), new THREE.MeshLambertMaterial({ color: 0x222228 }));
  beam.position.y = 6.2;
  g.add(beam);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.8), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, 6.2, 0.22);
  g.add(face);
  const lg = new THREE.SphereGeometry(0.32, 8, 6);
  for (let k = 0; k < 8; k++) {
    const lamp = new THREE.Mesh(lg, k % 2 ? lampA : lampB);
    lamp.position.set(-W / 2 + 0.5 + (k * (W - 1)) / 7, 7.45, 0.1);
    g.add(lamp);
  }
  return g;
}

export function buildWorld(track: Track, els: any[]): THREE.Group {
  const root = new THREE.Group();
  const half = track.width / 2;
  const P = (p: any) => track.proj.toXZ(p.lat, p.lon);

  const blocked = (poly: number[][]) => {
    let minx = 1e18, maxx = -1e18, minz = 1e18, maxz = -1e18;
    for (const p of poly) {
      minx = Math.min(minx, p[0]);
      maxx = Math.max(maxx, p[0]);
      minz = Math.min(minz, p[1]);
      maxz = Math.max(maxz, p[1]);
    }
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4);
      for (let s = 0; s <= steps; s++) {
        const t = steps ? s / steps : 0;
        const n = nearestGlobal(track, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        if (n && n.d < half + 1.5) return true;
      }
    }
    const c0 = Math.floor(minx / CELL), c1 = Math.floor(maxx / CELL), d0 = Math.floor(minz / CELL), d1 = Math.floor(maxz / CELL);
    if ((c1 - c0 + 1) * (d1 - d0 + 1) > 600) return false;
    for (let cx = c0; cx <= c1; cx++)
      for (let cz = d0; cz <= d1; cz++) {
        const l = track.grid.get(cx + ',' + cz);
        if (l) for (const i of l) if (pip(track.pts[i], poly)) return true;
      }
    return false;
  };

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: 0x7fd957 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(track.pts[0][0], -0.02, track.pts[0][1]);
  root.add(ground);

  // areas
  const area: Buf = { pos: [], col: [] };
  const geos: THREE.BufferGeometry[] = [];
  const roads: Buf = { pos: [], col: [] };
  const trees: number[][] = [];
  const pois: Poi[] = [];
  const blds: Bld[] = [];
  const roadCol = new THREE.Color(0x8d93ab);
  const bridgeCol = new THREE.Color(0xd9dbe6);
  const waterCol = new THREE.Color(0x35b6ff);
  const rails: Buf = { pos: [], col: [] };
  const bridgePts: number[][] = []; // punkty mostów co ~3 m, do rozpoznania trasy na moście
  let nBridges = 0;
  let nb = 0;

  for (const e of els) {
    const tg = e.tags || {};
    if (e.type === 'node' && tg.natural === 'tree') {
      const p = P(e);
      const n = nearestGlobal(track, p[0], p[1]);
      if (!n || n.d > half + 2.5) trees.push(p);
      continue;
    }
    if (e.type === 'node' && tg.poi) {
      const p = P(e);
      pois.push({ x: p[0], z: p[1], cls: tg.poi, sub: tg.sub ?? '', name: tg.name ?? '', rank: tg.rank ?? 99 });
      continue;
    }
    if (e.type !== 'way' || !e.geometry || e.geometry.length < 2) continue;
    if (tg.highway) {
      const w = /^(motorway|trunk|primary)/.test(tg.highway) ? 12 : /^(secondary|tertiary)/.test(tg.highway) ? 9 : tg.highway === 'service' || tg.highway === 'pedestrian' ? 4.5 : 6.5;
      const line = e.geometry.map(P);
      if (tg.bridge) {
        // most/wiadukt: jasna płyta, barierki po bokach
        nBridges++;
        ribbon(roads, line, w + 1.2, 0.04, bridgeCol, false);
        for (let k = 1; k < line.length; k++) {
          const a = line[k - 1], b = line[k];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
          for (let d = 0; d <= len; d += 3) bridgePts.push([a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len, (b[0] - a[0]) / len, (b[1] - a[1]) / len]);
          for (const s of [-1, 1]) {
            const o = s * (w / 2 + 0.6);
            const p0 = [a[0] + nx * o, a[1] + nz * o], p1 = [b[0] + nx * o, b[1] + nz * o];
            const nearTrack = (x: number, z: number) => {
              const q = nearestGlobal(track, x, z);
              return !!q && q.d < half + 4;
            };
            if (nearTrack(p0[0], p0[1]) || nearTrack(p1[0], p1[1]) || nearTrack((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)) continue;
            for (const [p, y] of [[p0, 0], [p1, 0], [p0, 1.1], [p1, 0], [p1, 1.1], [p0, 1.1]] as [number[], number][]) {
              rails.pos.push(p[0], y, p[1]);
              rails.col.push(0.93, 0.95, 1);
            }
          }
        }
      } else ribbon(roads, line, w, 0.03, roadCol, false);
      continue;
    }
    if (tg.waterway) {
      const w = tg.waterway === 'river' ? 16 : tg.waterway === 'canal' ? 9 : 3.5;
      ribbon(area, e.geometry.map(P), w, 0.015, waterCol, false);
      continue;
    }
    const closed = e.geometry.length > 3;
    if (!closed) continue;
    const poly: number[][] = e.geometry.map(P);
    if (poly.length > 1 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) poly.pop();
    if (poly.length < 3) continue;
    if (tg.building) {
      if (blocked(poly)) continue;
      let h = parseFloat(tg.height);
      if (!(h > 0)) {
        const lv = parseFloat(tg['building:levels']);
        h = lv > 0 ? lv * 3.2 + 1 : /^(house|detached|garage|garages|shed|roof)$/.test(tg.building) ? 4 + hash(e.id) * 2.5 : 8 + hash(e.id) * 10;
      }
      h = Math.min(h, 120);
      const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], -p[1])));
      let g: THREE.BufferGeometry;
      try {
        g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      } catch {
        continue;
      }
      g.rotateX(-Math.PI / 2);
      g.deleteAttribute('uv');
      let wc = new THREE.Color(WALLS[Math.floor(hash(e.id + 7) * WALLS.length)]);
      const bc = tg['building:colour'];
      if (typeof bc === 'string' && /^#[0-9a-f]{6}$/i.test(bc)) wc = new THREE.Color(bc).lerp(new THREE.Color(0xfff2c9), 0.2);
      {
        let x0 = 1e18, x1 = -1e18, z0 = 1e18, z1 = -1e18;
        for (const q of poly) {
          x0 = Math.min(x0, q[0]);
          x1 = Math.max(x1, q[0]);
          z0 = Math.min(z0, q[1]);
          z1 = Math.max(z1, q[1]);
        }
        blds.push({ poly, h, x0, x1, z0, z1 });
      }
      const rc = new THREE.Color(ROOFS[Math.floor(hash(e.id + 3) * ROOFS.length)]);
      const nrm = g.getAttribute('normal');
      const cols = new Float32Array(nrm.count * 3);
      for (let i = 0; i < nrm.count; i++) {
        const c = nrm.getY(i) > 0.7 ? rc : wc;
        cols[i * 3] = c.r;
        cols[i * 3 + 1] = c.g;
        cols[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geos.push(g);
      nb++;
      continue;
    }
    let col: number | null = null;
    let y = 0.01;
    if (tg.natural === 'water') (col = 0x35b6ff), (y = 0.015);
    else if (tg.leisure === 'pitch') col = 0x4fd16a;
    else if (tg.leisure || tg.landuse || tg.natural === 'wood') col = tg.landuse === 'cemetery' ? 0x74c98a : tg.natural === 'wood' || tg.landuse === 'forest' ? 0x3fb24f : 0x5fcf4f;
    if (col !== null) {
      const sg = new THREE.ShapeGeometry(new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], -p[1]))));
      sg.rotateX(-Math.PI / 2);
      const pa = sg.getAttribute('position');
      const c = new THREE.Color(col);
      for (let i = 0; i < pa.count; i++) {
        area.pos.push(pa.getX(i), y, pa.getZ(i));
        area.col.push(c.r, c.g, c.b);
      }
    }
  }
  if (area.pos.length) root.add(toMesh(area));
  if (roads.pos.length) root.add(toMesh(roads));
  if (rails.pos.length) root.add(toMesh(rails));
  if (geos.length) {
    const m = mergeGeometries(geos, false);
    if (m) root.add(new THREE.Mesh(m, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })));
  }
  console.log('buildings', nb, 'trees', trees.length);
  if (pois.length) root.add(buildPois(track, pois, blds));
  // dekoracje stawiamy tylko tam, gdzie nie ma budynku ani innego fragmentu trasy
  const decor = buildDecor(track, (x, z) => {
    const n = nearestGlobal(track, x, z);
    if (n && n.d < half + 0.8) return true;
    for (const b of blds) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pip([x, z], b.poly)) return true;
    return false;
  });
  root.add(decor.group);
  const lampA = new THREE.MeshBasicMaterial({ color: 0xffe600 }), lampB = new THREE.MeshBasicMaterial({ color: 0x5a4a00 });
  for (const h of track.hairpins) root.add(warnBanner(track, h.i, h.dir, lampA, lampB));
  root.userData.update = (t: number) => {
    decor.update(t);
    const on = Math.floor(t * 3.2) % 2 === 0;
    lampA.color.set(on ? 0xffe600 : 0x5a4a00);
    lampB.color.set(on ? 0x5a4a00 : 0xff7a00);
  };

  // track surface
  const surf: Buf = { pos: [], col: [] };
  const pts = track.pts;
  const white = new THREE.Color(0xffffff);
  strip(surf, track, (i) => -track.wm[i], (i) => track.wp[i], 0.05, new THREE.Color(0x4a4e69));
  strip(surf, track, (i) => track.wp[i] - kerbW(track.wp[i]) - 0.3, (i) => track.wp[i] - kerbW(track.wp[i]), 0.07, white);
  strip(surf, track, (i) => -track.wm[i] + kerbW(track.wm[i]), (i) => -track.wm[i] + kerbW(track.wm[i]) + 0.3, 0.07, white);
  // pobocze: biało-czerwone tarki przy obu krawędziach
  {
    const kred = new THREE.Color(0xff2a3c), kwht = new THREE.Color(0xffffff);
    const P = (i: number, o: number) => [track.pts[i][0] + track.nor[i][0] * o, surfY(track, i, o) + 0.08, track.pts[i][1] + track.nor[i][1] * o];
    for (const s of [-1, 1])
      for (let i = 0; i < (track.closed ? track.N : track.N - 1); i++) {
        const j = (i + 1) % track.N;
        const wi = s > 0 ? track.wp[i] : track.wm[i], wj = s > 0 ? track.wp[j] : track.wm[j];
        const c = i % 2 ? kred : kwht;
        for (const p of [P(i, s * (wi - kerbW(wi))), P(i, s * wi), P(j, s * (wj - kerbW(wj))), P(i, s * wi), P(j, s * wj), P(j, s * (wj - kerbW(wj)))]) {
          surf.pos.push(p[0], p[1], p[2]);
          surf.col.push(c.r, c.g, c.b);
        }
      }
  }
  root.add(toMesh(surf));

  // odcinki trasy biegnące mostem: stalowe barierki i słupy zamiast biało-czerwonych band
  const bgrid = new Map<string, number[][]>();
  for (const p of bridgePts) {
    const k = Math.floor(p[0] / 8) + ',' + Math.floor(p[1] / 8);
    (bgrid.get(k) ?? bgrid.set(k, []).get(k)!).push(p);
  }
  // trasa jest "na moście" tylko wtedy, gdy biegnie wzdłuż niego (most przecinający trasę się nie liczy)
  const onBridge = track.pts.map((p, i) => {
    const cx = Math.floor(p[0] / 8), cz = Math.floor(p[1] / 8);
    const t = track.tan[i];
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const q of bgrid.get(cx + a + ',' + (cz + b)) ?? []) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 4 && Math.abs(q[2] * t[0] + q[3] * t[1]) > 0.85) return true;
    return false;
  });
  const steel = new THREE.Color(0x2f7fd6);
  const postM = new THREE.MeshLambertMaterial({ color: 0x2f7fd6 });
  const postG = new THREE.BoxGeometry(0.35, 3.2, 0.35);
  let trackBridge = 0;
  for (let i = 0; i < track.N; i++) {
    if (!onBridge[i]) continue;
    trackBridge++;
    if (i % 3) continue;
    for (const s of [-1, 1]) {
      const o = s * ((s > 0 ? track.wp[i] : track.wm[i]) + 0.3);
      const post = new THREE.Mesh(postG, postM);
      post.position.set(track.pts[i][0] + track.nor[i][0] * o, 1.6 + track.y[i], track.pts[i][1] + track.nor[i][1] * o);
      root.add(post);
    }
  }
  console.log('bridges', nBridges, 'track samples on bridge', trackBridge);

  // walls
  const wall: Buf = { pos: [], col: [] };
  const red = new THREE.Color(0xff2e4d);
  const wht = new THREE.Color(0xf0f0f0);
  const yel = new THREE.Color(0xffd400), blk = new THREE.Color(0x222228);
  const n = pts.length;
  // Banda nie może stać na jezdni innego fragmentu trasy (skrzyżowania trasy samej ze sobą,
  // domknięcie pętli, równoległe ulice blisko siebie): takie kawałki bandy pomijamy.
  const onOtherPart = (x: number, z: number, i: number, anyLevel = false) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const k of track.grid.get(cx + a + ',' + (cz + b)) ?? []) {
          let di = Math.abs(k - i);
          if (track.closed) di = Math.min(di, n - di);
          if (di < 6) continue; // sąsiedztwo tego samego odcinka
          if (!anyLevel && Math.abs(track.y[k] - track.y[i]) > 2) continue; // inny poziom (wiadukt)
          const dx = x - pts[k][0], dz = z - pts[k][1];
          const lat = dx * track.nor[k][0] + dz * track.nor[k][1];
          const lon = dx * track.tan[k][0] + dz * track.tan[k][1];
          if (Math.abs(lon) < 2.5 && lat < track.wp[k] + 0.1 && lat > -track.wm[k] - 0.1) return true;
        }
    return false;
  };
  for (const s of [-1, 1])
    for (let i = 0; i < (track.closed ? n : n - 1); i++) {
      const j = (i + 1) % n;
      const oi = s * ((s > 0 ? track.wp[i] : track.wm[i]) + 0.15), oj = s * ((s > 0 ? track.wp[j] : track.wm[j]) + 0.15);
      const a = [pts[i][0] + track.nor[i][0] * oi, pts[i][1] + track.nor[i][1] * oi];
      const b = [pts[j][0] + track.nor[j][0] * oj, pts[j][1] + track.nor[j][1] * oj];
      if (onOtherPart(a[0], a[1], i) || onOtherPart(b[0], b[1], j)) continue;
      // zapory szykan w żółto-czarne pasy, żeby było je widać z daleka
      const chic = (s > 0 ? track.wp[i] : track.wm[i]) < track.width / 2 - 0.05 && track.chicanes.some((q) => Math.abs(q - i) <= 8);
      const c = chic ? (i % 2 ? yel : blk) : onBridge[i] ? (Math.floor(i / 2) % 2 ? steel : wht) : Math.floor(i / 2) % 2 ? red : wht;
      const H = 0.95;
      const ya = surfY(track, i, oi), yb = surfY(track, j, oj);
      // profilowany zakręt: banda stoi na podmurówce od ziemi
      const ga = track.bank[i] ? 0 : ya, gb = track.bank[j] ? 0 : yb;
      const q = [[a, ga], [b, gb], [a, ya + H], [b, gb], [b, yb + H], [a, ya + H]] as [number[], number][];
      for (const [p, y] of q) {
        wall.pos.push(p[0], y, p[1]);
        wall.col.push(c.r, c.g, c.b);
      }
    }
  root.add(toMesh(wall));

  // wiadukty: boki ramp (pełne do ziemi), płyta nad przejazdem i filary
  const via: Buf = { pos: [], col: [] };
  const conc0 = new THREE.Color(0xc4c8d6), earth = new THREE.Color(0x58b84a);
  const cdist = (u: number, w: number) => (track.closed ? Math.min(Math.abs(u - w), n - Math.abs(u - w)) : Math.abs(u - w));
  const inTunnelRamp = (i: number) => track.tunnels.some((c) => cdist(i, c.k) <= 13);
  const pillarM = new THREE.MeshLambertMaterial({ color: 0xaab0c2, flatShading: true });
  let viaducts = 0;
  for (let i = 0; i < (track.closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    const ya = track.y[i], yb = track.y[j];
    if (ya < 0.05 && yb < 0.05) continue;
    if (ya >= 5 && (track.y[(i - 1 + n) % n] ?? 0) < ya && yb <= ya) viaducts++;
    const hill = inTunnelRamp(i);
    const conc = hill ? earth : conc0;
    for (const s of [-1, 1]) {
      const oi = s * ((s > 0 ? track.wp[i] : track.wm[i]) + 0.15), oj = s * ((s > 0 ? track.wp[j] : track.wm[j]) + 0.15);
      const a = [pts[i][0] + track.nor[i][0] * oi, pts[i][1] + track.nor[i][1] * oi];
      const b = [pts[j][0] + track.nor[j][0] * oj, pts[j][1] + track.nor[j][1] * oj];
      // nisko: nasyp do ziemi; wysoko: sama płyta, żeby dało się pod nią przejechać
      // nasyp rampy nie może stanąć na innej jezdni: tam zostaje sama płyta
      const clash = onOtherPart(a[0], a[1], i, true) || onOtherPart(b[0], b[1], j, true);
      const ba = ya < 2.8 && !clash ? 0 : Math.max(0, ya - 0.7), bb = yb < 2.8 && !clash ? 0 : Math.max(0, yb - 0.7);
      for (const [p, h] of [[a, ba], [b, bb], [a, ya], [b, bb], [b, yb], [a, ya]] as [number[], number][]) {
        via.pos.push(p[0], h, p[1]);
        via.col.push(conc.r, conc.g, conc.b);
      }
      if (ya >= 2.8 && i % 5 === 0 && !hill) {
        // filar pod krawędzią płyty, o ile nie stoi na dolnej jezdni
        let free = true;
        for (let k = 0; k < n && free; k++) {
          if (track.y[k] > 1) continue;
          const dx = a[0] - pts[k][0], dz = a[1] - pts[k][1];
          if (Math.hypot(dx, dz) < Math.max(track.wp[k], track.wm[k]) + 1) free = false;
        }
        if (free) {
          const pil = new THREE.Mesh(new THREE.BoxGeometry(0.9, ya - 0.7, 0.9), pillarM);
          pil.position.set(a[0], (ya - 0.7) / 2, a[1]);
          root.add(pil);
        }
      }
    }
  }
  // tunele: dolna jezdnia przejeżdża pod zielonym wzgórzem, górna biegnie po jego grzbiecie
  {
    const dark = new THREE.Color(0x3a3d4d), stone = new THREE.Color(0xd9d2c0);
    const L = 3, CEIL = 3.9, TOP = 4.0, half = track.width / 2;
    const quad = (p: number[][], c: THREE.Color) => {
      for (const k of [0, 1, 2, 0, 2, 3]) { via.pos.push(p[k][0], p[k][1], p[k][2]); via.col.push(c.r, c.g, c.b); }
    };
    for (const c of track.tunnels) {
      const at = (j: number, o: number, h: number) => {
        let q = c.i + j;
        q = track.closed ? ((q % n) + n) % n : Math.max(0, Math.min(n - 1, q));
        return [pts[q][0] + track.nor[q][0] * o, h, pts[q][1] + track.nor[q][1] * o];
      };
      const w = half + 0.25, W = half + 3, F = half + 8;
      for (let j = -L; j < L; j++) {
        for (const s of [-1, 1]) {
          quad([at(j, s * w, 0), at(j + 1, s * w, 0), at(j + 1, s * w, CEIL), at(j, s * w, CEIL)], dark); // ściana
          quad([at(j, s * W, TOP), at(j + 1, s * W, TOP), at(j + 1, s * F, 0), at(j, s * F, 0)], earth); // zbocze
        }
        quad([at(j, -w, CEIL), at(j + 1, -w, CEIL), at(j + 1, w, CEIL), at(j, w, CEIL)], dark); // strop
        quad([at(j, -W, TOP), at(j + 1, -W, TOP), at(j + 1, W, TOP), at(j, W, TOP)], earth); // grzbiet
      }
      for (const j of [-L, L]) {
        // portal: kamienne czoło z otworem na jezdnię
        quad([at(j, -W, CEIL), at(j, W, CEIL), at(j, W, TOP + 0.9), at(j, -W, TOP + 0.9)], stone);
        for (const s of [-1, 1]) {
          quad([at(j, s * w, 0), at(j, s * W, 0), at(j, s * W, CEIL), at(j, s * w, CEIL)], stone);
          quad([at(j, s * W, 0), at(j, s * F, 0), at(j, s * W, TOP), at(j, s * W, TOP)], earth);
        }
      }
    }
  }
  if (via.pos.length) root.add(toMesh(via));
  console.log('viaducts', viaducts);

  // gates
  root.add(gate(track, track.startIdx, 'START'));
  if (!track.closed) root.add(gate(track, track.finishIdx, 'META'));

  // trees
  const cnt = Math.min(trees.length, 4000);
  if (cnt) {
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2, 5.5, 5), new THREE.MeshLambertMaterial({ color: 0x2fbf55, flatShading: true }), cnt);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.3, 2, 5), new THREE.MeshLambertMaterial({ color: 0x6b4a2b }), cnt);
    const m = new THREE.Matrix4();
    for (let i = 0; i < cnt; i++) {
      const s = 0.8 + hash(i) * 0.6;
      m.compose(new THREE.Vector3(trees[i][0], 4.2 * s, trees[i][1]), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      crown.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(trees[i][0], 1 * s, trees[i][1]), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      trunk.setMatrixAt(i, m);
    }
    root.add(crown, trunk);
  }
  return root;
}
