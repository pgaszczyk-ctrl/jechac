// Charakterystyczne punkty z OSM: witryny z szyldami na fasadach i wieże kościołów.
import * as THREE from 'three';
import { Track } from './track';
import { pip } from './geo';

export interface Poi {
  x: number;
  z: number;
  cls: string;
  sub: string;
  name: string;
  rank: number;
}
export interface Bld {
  poly: number[][];
  h: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  spire?: boolean;
}

interface Kind {
  label: string;
  icon: string;
  col: string;
}
const K = (label: string, icon: string, col: string): Kind => ({ label, icon, col });
const KIND: Record<string, Kind> = {
  shop: K('Sklep', '🛍', '#d9662b'),
  grocery: K('Spożywczy', '🛒', '#2e8b57'),
  supermarket: K('Market', '🛒', '#2e8b57'),
  convenience: K('Spożywczy', '🛒', '#2e8b57'),
  clothing_store: K('Odzież', '👕', '#8e44ad'),
  bakery: K('Piekarnia', '🥐', '#b9770e'),
  butcher: K('Mięsny', '🥩', '#a93226'),
  alcohol_shop: K('Alkohole', '🍷', '#6c3483'),
  restaurant: K('Restauracja', '🍴', '#c0392b'),
  fast_food: K('Bar', '🍔', '#e67e22'),
  cafe: K('Kawiarnia', '☕', '#6e4b2a'),
  ice_cream: K('Lody', '🍦', '#e884b0'),
  bar: K('Pub', '🍺', '#7d5a00'),
  beer: K('Pub', '🍺', '#7d5a00'),
  bank: K('Bank', '🏦', '#1f4e8c'),
  pharmacy: K('Apteka', '✚', '#1e8449'),
  hospital: K('Szpital', '✚', '#c0392b'),
  doctors: K('Przychodnia', '✚', '#2874a6'),
  dentist: K('Dentysta', '🦷', '#2874a6'),
  school: K('Szkoła', '🎓', '#2e6f95'),
  college: K('Uczelnia', '🎓', '#2e6f95'),
  university: K('Uczelnia', '🎓', '#2e6f95'),
  kindergarten: K('Przedszkole', '🧸', '#d68910'),
  library: K('Biblioteka', '📚', '#5d4037'),
  lodging: K('Hotel', '🛏', '#34495e'),
  fuel: K('Stacja paliw', '⛽', '#b03a2e'),
  cinema: K('Kino', '🎬', '#641e16'),
  theatre: K('Teatr', '🎭', '#641e16'),
  museum: K('Muzeum', '🏛', '#566573'),
  art_gallery: K('Galeria', '🖼', '#566573'),
  post: K('Poczta', '✉', '#b9770e'),
  police: K('Policja', '★', '#1b2631'),
  town_hall: K('Urząd', '🏛', '#566573'),
  hairdresser: K('Fryzjer', '✂', '#7b241c'),
  laundry: K('Pralnia', '🧺', '#2e86c1'),
  music: K('Muzyczny', '♪', '#6c3483'),
  place_of_worship: K('Kościół', '✝', '#5d4037'),
};

function signTexture(k: Kind, name: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const x = c.getContext('2d')!;
  x.fillStyle = k.col;
  x.fillRect(0, 0, 512, 96);
  x.strokeStyle = '#fff8';
  x.lineWidth = 6;
  x.strokeRect(5, 5, 502, 86);
  let text = (name || k.label).trim();
  if (text.length > 24) text = text.slice(0, 23) + '…';
  text = k.icon + ' ' + text;
  let fs = 58;
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  do {
    x.font = `bold ${fs}px 'Lilita One', 'Arial Black', 'Segoe UI Emoji', sans-serif`;
    fs -= 4;
  } while (x.measureText(text).width > 470 && fs > 18);
  x.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildPois(track: Track, pois: Poi[], blds: Bld[]): THREE.Group {
  const g = new THREE.Group();
  const cand: (Poi & { k: Kind; d: number; ti: number })[] = [];
  for (const p of pois) {
    const k = KIND[p.cls] ?? KIND[p.sub];
    if (!k) continue;
    let bd = 1e18, bi = 0;
    for (let i = 0; i < track.N; i += 2) {
      const d = (track.pts[i][0] - p.x) ** 2 + (track.pts[i][1] - p.z) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bd > 55 * 55) continue;
    cand.push({ ...p, k, d: Math.sqrt(bd), ti: bi });
  }
  cand.sort((a, b) => a.d - b.d);
  const placed: number[][] = [];
  const glass = new THREE.MeshLambertMaterial({ color: 0xcfeaf7, emissive: 0x35505c });
  const door = new THREE.MeshLambertMaterial({ color: 0x3b2a1e });
  const stone = new THREE.MeshLambertMaterial({ color: 0xcdbfa8, flatShading: true });
  const roofM = new THREE.MeshLambertMaterial({ color: 0x8c3b2e, flatShading: true });
  let n = 0;
  for (const c of cand) {
    if (n >= 90) break;
    const tp = track.pts[c.ti];
    let best: { b: Bld; a: number[]; e: number[]; len: number; t: number; nx: number; nz: number } | null = null;
    let bs = 1e18;
    for (const b of blds) {
      if (c.x < b.x0 - 14 || c.x > b.x1 + 14 || c.z < b.z0 - 14 || c.z > b.z1 + 14) continue;
      const inside = pip([c.x, c.z], b.poly);
      let cx = 0, cz = 0;
      for (const q of b.poly) {
        cx += q[0];
        cz += q[1];
      }
      cx /= b.poly.length;
      cz /= b.poly.length;
      if (inside && c.cls === 'place_of_worship' && !b.spire && b.x1 - b.x0 > 8) {
        b.spire = true;
        const th = b.h + 9;
        const tower = new THREE.Mesh(new THREE.BoxGeometry(4.5, th, 4.5), stone);
        tower.position.set(cx, th / 2, cz);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(3.6, 9, 4), roofM);
        cone.position.set(cx, th + 4.5, cz);
        cone.rotation.y = Math.PI / 4;
        g.add(tower, cone);
      }
      for (let i = 0; i < b.poly.length; i++) {
        const a = b.poly[i], e = b.poly[(i + 1) % b.poly.length];
        const dx = e[0] - a[0], dz = e[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 3) continue;
        const t = Math.max(0, Math.min(1, ((c.x - a[0]) * dx + (c.z - a[1]) * dz) / (len * len)));
        const qx = a[0] + dx * t, qz = a[1] + dz * t;
        const dq = Math.hypot(c.x - qx, c.z - qz);
        if (!inside && dq > 12) continue;
        let nx = -dz / len, nz = dx / len;
        if (nx * (cx - qx) + nz * (cz - qz) > 0) {
          nx = -nx;
          nz = -nz;
        }
        const facing = nx * (tp[0] - qx) + nz * (tp[1] - qz) > 0;
        const score = dq + 0.6 * Math.hypot(tp[0] - qx, tp[1] - qz) + (facing ? 0 : 40);
        if (score < bs) {
          bs = score;
          best = { b, a, e, len, t, nx, nz };
        }
      }
    }
    if (!best || best.b.h < 3) continue;
    const w = Math.max(2.4, Math.min(6, best.len - 0.6));
    const half = Math.min(0.5, w / 2 / best.len);
    const t = Math.max(half, Math.min(1 - half, best.t));
    const px = best.a[0] + (best.e[0] - best.a[0]) * t, pz = best.a[1] + (best.e[1] - best.a[1]) * t;
    if (placed.some((q) => Math.hypot(q[0] - px, q[1] - pz) < w * 0.5 + 2.6)) continue;
    placed.push([px, pz]);
    const s = new THREE.Group();
    s.position.set(px + best.nx * 0.1, 0, pz + best.nz * 0.1);
    s.rotation.y = Math.atan2(best.nx, best.nz);
    s.scale.y = Math.min(1, best.b.h / 4.3);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(w - 1.5, 1.9), glass);
    win.position.set(0.55, 1.45, 0.03);
    const dr = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.2), door);
    dr.position.set(-w / 2 + 0.65, 1.1, 0.03);
    const aw = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.1, 1.3), new THREE.MeshLambertMaterial({ color: c.k.col }));
    aw.position.set(0, 2.75, 0.6);
    aw.rotation.x = 0.32;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, w * (96 / 512) < 0.8 ? 0.8 : w * (96 / 512)), new THREE.MeshBasicMaterial({ map: signTexture(c.k, c.name) }));
    sign.position.set(0, 3.55, 0.06);
    s.add(win, dr, aw, sign);
    g.add(s);
    n++;
  }
  console.log('pois', pois.length, 'storefronts', n);
  return g;
}
