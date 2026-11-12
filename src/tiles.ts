// Dane miasta z kafli wektorowych OpenFreeMap (schemat OpenMapTiles, z14).
// Te same kafle rysują mapę 2D, więc nie zależymy od Overpassa.
import { VectorTile } from '@mapbox/vector-tile';
// @ts-ignore brak typów nazwanych eksportów
import { PbfReader } from 'pbf';
import { hash } from './geo';

export const Z = 14;
export const EXT = 4096;
const WORLD = 2 ** Z * EXT; // globalne jednostki siatki kafli

export interface RoadPt {
  gx: number;
  gy: number;
  b: boolean; // punkt na krawędzi kafla (powstał z przycięcia)
}
export interface TileData {
  key: string;
  roads: { pts: RoadPt[]; cls: string; bridge: boolean }[];
  waterways: { pts: number[][]; cls: string }[]; // rzeki, strumienie, kanały (linie)
  buildings: { ring: number[][]; h: number; colour?: string }[]; // ring w jednostkach globalnych
  pois: { gx: number; gy: number; cls: string; sub: string; name: string; rank: number }[];
  areas: { ring: number[][]; kind: 'water' | 'wood' | 'grass' }[];
}

export const g2ll = (gx: number, gy: number) => ({
  lon: (gx / WORLD) * 360 - 180,
  lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / WORLD))) * 180) / Math.PI,
});
export const lon2tx = (lon: number) => Math.floor(((lon + 180) / 360) * 2 ** Z);
export const lat2ty = (lat: number) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** Z);

let template: Promise<string> | null = null;
function tileUrl(): Promise<string> {
  if (!template)
    template = fetch('https://tiles.openfreemap.org/planet')
      .then((r) => r.json())
      .then((j) => j.tiles[0] as string)
      .catch((e) => {
        template = null;
        throw e;
      });
  return template;
}

const cache = new Map<string, Promise<TileData>>();

export function loadTile(tx: number, ty: number): Promise<TileData> {
  const key = tx + '/' + ty;
  let p = cache.get(key);
  if (!p) {
    p = fetchTile(tx, ty, key).catch((e) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, p);
  }
  return p;
}

const ROAD = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'busway', 'raceway']);

function ringArea(r: { x: number; y: number }[]) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x - r[i].x) * (r[i].y + r[j].y);
  return a / 2;
}

// przycięcie odcinka do [0,EXT]^2 (Liang–Barsky); zwraca t0,t1 albo null
function clipSeg(ax: number, ay: number, bx: number, by: number): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const P = [-dx, dx, -dy, dy];
  const Q = [ax, EXT - ax, ay, EXT - ay];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) {
      if (Q[i] < 0) return null;
    } else {
      const t = Q[i] / P[i];
      if (P[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [t0, t1];
}

async function fetchTile(tx: number, ty: number, key: string): Promise<TileData> {
  const url = (await tileUrl()).replace('{z}', String(Z)).replace('{x}', String(tx)).replace('{y}', String(ty));
  const r = await fetch(url);
  if (!r.ok) throw new Error('tile ' + r.status);
  const vt = new VectorTile(new PbfReader(await r.arrayBuffer()));
  const ox = tx * EXT, oy = ty * EXT;
  const out: TileData = { key, roads: [], waterways: [], buildings: [], areas: [], pois: [] };

  const tr = vt.layers.transportation;
  if (tr)
    for (let i = 0; i < tr.length; i++) {
      const f = tr.feature(i);
      if (f.type !== 2) continue;
      const p = f.properties as any;
      if (p.brunnel === 'tunnel') continue;
      const ok = ROAD.has(p.class) || (p.class === 'path' && p.subclass === 'pedestrian');
      if (!ok) continue;
      const sc = (EXT / tr.extent);
      for (const line of f.loadGeometry()) {
        let cur: RoadPt[] = [];
        const flush = () => {
          if (cur.length > 1) out.roads.push({ pts: cur, cls: p.class === 'path' ? 'pedestrian' : p.class, bridge: p.brunnel === 'bridge' });
          cur = [];
        };
        for (let k = 1; k < line.length; k++) {
          const ax = line[k - 1].x * sc, ay = line[k - 1].y * sc, bx = line[k].x * sc, by = line[k].y * sc;
          const c = clipSeg(ax, ay, bx, by);
          if (!c) {
            flush();
            continue;
          }
          const mk = (t: number): RoadPt => {
            const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
            const onB = x <= 0.001 || x >= EXT - 0.001 || y <= 0.001 || y >= EXT - 0.001;
            return { gx: ox + x, gy: oy + y, b: onB };
          };
          if (c[0] > 0 || cur.length === 0) {
            flush();
            cur.push(mk(c[0]));
          }
          cur.push(mk(c[1]));
          if (c[1] < 1) flush();
        }
        flush();
      }
    }

  const ww = vt.layers.waterway;
  if (ww) {
    const sc = EXT / ww.extent;
    for (let i = 0; i < ww.length; i++) {
      const f = ww.feature(i);
      const p = f.properties as any;
      if (f.type !== 2 || p.brunnel === 'tunnel') continue;
      for (const line of f.loadGeometry()) out.waterways.push({ pts: line.map((q: any) => [ox + q.x * sc, oy + q.y * sc]), cls: String(p.class ?? 'stream') });
    }
  }

  const polys = (layer: any, cb: (ring: number[][], props: any) => void) => {
    if (!layer) return;
    const sc = EXT / layer.extent;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      for (const ring of f.loadGeometry()) {
        if (ring.length < 4 || ringArea(ring) <= 0) continue; // tylko pierścienie zewnętrzne
        let cx = 0, cy = 0;
        for (const q of ring) {
          cx += q.x;
          cy += q.y;
        }
        cx = (cx / ring.length) * sc;
        cy = (cy / ring.length) * sc;
        // deduplikacja z sąsiednim kaflem (bufor): bierzemy tylko te, których środek leży w tym kaflu
        if (cx < 0 || cx >= EXT || cy < 0 || cy >= EXT) continue;
        cb(ring.map((q: any) => [ox + q.x * sc, oy + q.y * sc]), f.properties);
      }
    }
  };
  polys(vt.layers.building, (ring, p) => {
    if (p.hide_3d) return;
    out.buildings.push({ ring, h: Math.max(0, (p.render_height ?? 6) - (p.render_min_height ?? 0)), colour: p.colour });
  });
  const pl = vt.layers.poi;
  if (pl) {
    const sc = EXT / pl.extent;
    for (let i = 0; i < pl.length; i++) {
      const f = pl.feature(i);
      if (f.type !== 1) continue;
      const p = f.properties as any;
      const q = f.loadGeometry()[0][0];
      const x = q.x * sc, y = q.y * sc;
      if (x < 0 || x >= EXT || y < 0 || y >= EXT) continue;
      out.pois.push({ gx: ox + x, gy: oy + y, cls: String(p.class ?? ''), sub: String(p.subclass ?? ''), name: String(p.name ?? ''), rank: +p.rank || 99 });
    }
  }
  polys(vt.layers.water, (ring) => out.areas.push({ ring, kind: 'water' }));
  polys(vt.layers.landcover, (ring, p) => {
    if (p.class === 'wood') out.areas.push({ ring, kind: 'wood' });
    else if (p.class === 'grass') out.areas.push({ ring, kind: 'grass' });
  });
  polys(vt.layers.park, (ring) => out.areas.push({ ring, kind: 'grass' }));
  polys(vt.layers.landuse, (ring, p) => {
    if (/^(cemetery|pitch|playground|stadium|park)$/.test(p.class)) out.areas.push({ ring, kind: 'grass' });
  });
  return out;
}

export async function loadArea(s: number, w: number, n: number, e: number): Promise<TileData[]> {
  const x0 = lon2tx(w), x1 = lon2tx(e), y0 = lat2ty(n), y1 = lat2ty(s);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 30) throw new Error('Za duży obszar');
  const ps: Promise<TileData>[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) ps.push(loadTile(x, y));
  return Promise.all(ps);
}

const HW: Record<string, string> = { trunk: 'primary', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'residential', service: 'service', track: 'service', pedestrian: 'pedestrian' };

// Elementy w formacie zbliżonym do Overpassa (way z geometry lat/lon), przycięte do bbox.
export async function fetchCity(s: number, w: number, n: number, e: number): Promise<any[]> {
  const tiles = await loadArea(s, w, n, e);
  const els: any[] = [];
  const inside = (ring: number[][]) => {
    let any = false;
    for (const p of ring) {
      const q = g2ll(p[0], p[1]);
      if (q.lat >= s && q.lat <= n && q.lon >= w && q.lon <= e) {
        any = true;
        break;
      }
    }
    return any;
  };
  const rid = (ring: number[][]) => (Math.imul(Math.round(ring[0][0]), 73856093) ^ Math.imul(Math.round(ring[0][1]), 19349663) ^ ring.length) | 0;
  let trees = 0;
  for (const t of tiles) {
    for (const b of t.buildings)
      if (inside(b.ring)) els.push({ type: 'way', id: rid(b.ring), geometry: b.ring.map((p) => g2ll(p[0], p[1])), tags: { building: 'yes', height: String(Math.max(3, b.h)), ...(b.colour ? { 'building:colour': b.colour } : {}) } });
    for (const p of t.pois) {
      const q = g2ll(p.gx, p.gy);
      if (q.lat >= s && q.lat <= n && q.lon >= w && q.lon <= e) els.push({ type: 'node', id: 0, ...q, tags: { poi: p.cls, sub: p.sub, name: p.name, rank: p.rank } });
    }
    for (const a of t.areas) {
      if (!inside(a.ring)) continue;
      const tags = a.kind === 'water' ? { natural: 'water' } : a.kind === 'wood' ? { natural: 'wood' } : { landuse: 'grass' };
      const id = rid(a.ring);
      els.push({ type: 'way', id, geometry: a.ring.map((p) => g2ll(p[0], p[1])), tags });
      // proceduralne drzewa w zieleni
      if (a.kind === 'water' || trees > 3500) continue;
      let x0 = 1e18, x1 = -1e18, y0 = 1e18, y1 = -1e18;
      for (const p of a.ring) {
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]);
        y1 = Math.max(y1, p[1]);
      }
      const m2 = (x1 - x0) * (y1 - y0) * 0.36; // ~0.6 m na jednostkę
      const cnt = Math.min(400, Math.floor(m2 / (a.kind === 'wood' ? 250 : 1200)));
      for (let k = 0; k < cnt; k++) {
        const px = x0 + hash(id + k * 2) * (x1 - x0), py = y0 + hash(id + k * 2 + 1) * (y1 - y0);
        let inPoly = false;
        for (let i = 0, j = a.ring.length - 1; i < a.ring.length; j = i++) {
          const A = a.ring[i], B = a.ring[j];
          if (A[1] > py !== B[1] > py && px < ((B[0] - A[0]) * (py - A[1])) / (B[1] - A[1]) + A[0]) inPoly = !inPoly;
        }
        if (!inPoly) continue;
        const q = g2ll(px, py);
        if (q.lat < s || q.lat > n || q.lon < w || q.lon > e) continue;
        els.push({ type: 'node', id: id + k, ...q, tags: { natural: 'tree' } });
        trees++;
      }
    }
    for (const r of t.roads) els.push({ type: 'way', id: 0, geometry: r.pts.map((p) => g2ll(p.gx, p.gy)), tags: { highway: HW[r.cls] ?? 'residential', ...(r.bridge ? { bridge: 'yes' } : {}) } });
    for (const wv of t.waterways) if (inside(wv.pts)) els.push({ type: 'way', id: 0, geometry: wv.pts.map((p) => g2ll(p[0], p[1])), tags: { waterway: wv.cls } });
  }
  return els;
}
