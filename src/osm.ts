import { M_LAT } from './geo';
import { EXT, RoadPt, TileData, g2ll } from './tiles';

async function getJson(url: string, ms = 7000): Promise<any> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function geocode(q: string): Promise<{ lat: number; lon: number; name: string } | null> {
  try {
    const j = await getJson('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q));
    if (j[0]) return { lat: +j[0].lat, lon: +j[0].lon, name: j[0].display_name };
  } catch {
    /* zapasowy geokoder niżej */
  }
  const p = await getJson('https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(q));
  const f = p.features?.[0];
  return f ? { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: f.properties?.name ?? q } : null;
}

export interface GNode {
  id: number;
  lat: number;
  lon: number;
  adj: Map<number, number>;
}

const MAX_SEG = 18; // m; dłuższe odcinki dzielimy, żeby było do czego przyciągać kursor

export class Graph {
  nodes = new Map<number, GNode>();
  private byKey = new Map<string, number>();
  private border = new Map<string, { v: number; id: number }[]>();
  private tiles = new Set<string>();
  private next = 1;

  private mk(gx: number, gy: number): GNode {
    const ll = g2ll(gx, gy);
    const n: GNode = { id: this.next++, lat: ll.lat, lon: ll.lon, adj: new Map() };
    this.nodes.set(n.id, n);
    return n;
  }

  private node(p: RoadPt): GNode {
    if (p.b) {
      // punkt na krawędzi kafla: sąsiedni kafel ma go z minimalnie innym zaokrągleniem
      const rx = Math.round(p.gx), ry = Math.round(p.gy);
      const onX = rx % EXT === 0 && Math.abs(p.gx - rx) < 0.01;
      const key = onX ? 'x' + rx : 'y' + ry;
      const v = onX ? p.gy : p.gx;
      let list = this.border.get(key);
      if (!list) this.border.set(key, (list = []));
      for (const e of list) if (Math.abs(e.v - v) < 3) return this.nodes.get(e.id)!;
      const n = this.mk(p.gx, p.gy);
      list.push({ v, id: n.id });
      return n;
    }
    const key = Math.round(p.gx) + ',' + Math.round(p.gy);
    const id = this.byKey.get(key);
    if (id) return this.nodes.get(id)!;
    const n = this.mk(p.gx, p.gy);
    this.byKey.set(key, n.id);
    return n;
  }

  private link(a: GNode, b: GNode) {
    if (a === b) return;
    const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
    const d = Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * M_LAT);
    a.adj.set(b.id, d);
    b.adj.set(a.id, d);
  }

  // Kafle upraszczają linie, więc ulica dochodząca do skrzyżowania "T" często nie ma wspólnego
  // wierzchołka z ulicą przelotową. Ślepe końce leżące na cudzej krawędzi wpinamy w tę krawędź.
  heal(tol = 2.5) {
    const C = 25;
    const kx = 111320 * Math.cos(((this.nodes.values().next().value?.lat ?? 52) * Math.PI) / 180);
    const X = (n: GNode) => n.lon * kx, Y = (n: GNode) => n.lat * M_LAT;
    const grid = new Map<string, GNode[]>();
    for (const n of this.nodes.values()) {
      const k = Math.floor(X(n) / C) + ',' + Math.floor(Y(n) / C);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(n);
    }
    for (const n of [...this.nodes.values()]) {
      if (n.adj.size !== 1) continue;
      const nb = this.nodes.get(n.adj.keys().next().value!)!;
      const px = X(n), py = Y(n);
      const cx = Math.floor(px / C), cy = Math.floor(py / C);
      let best: [GNode, GNode] | null = null;
      let bd = tol;
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const u of grid.get(cx + a + ',' + (cy + b)) ?? []) {
            if (u === n || u === nb) continue;
            for (const vid of u.adj.keys()) {
              const v = this.nodes.get(vid)!;
              if (v === n || v === nb) continue;
              const ux = X(u), uy = Y(u), dx = X(v) - ux, dy = Y(v) - uy;
              const l2 = dx * dx + dy * dy;
              const t = l2 ? Math.max(0, Math.min(1, ((px - ux) * dx + (py - uy) * dy) / l2)) : 0;
              const d = Math.hypot(px - ux - dx * t, py - uy - dy * t);
              if (d < bd) {
                bd = d;
                best = [u, v];
              }
            }
          }
      if (!best) continue;
      const [u, v] = best;
      u.adj.delete(v.id);
      v.adj.delete(u.id);
      this.link(u, n);
      this.link(n, v);
    }
  }

  addTile(t: TileData) {
    if (this.tiles.has(t.key)) return;
    this.tiles.add(t.key);
    for (const r of t.roads) {
      let prev = this.node(r.pts[0]);
      for (let i = 1; i < r.pts.length; i++) {
        const cur = this.node(r.pts[i]);
        const a = r.pts[i - 1], b = r.pts[i];
        const kx = 111320 * Math.cos((prev.lat * Math.PI) / 180);
        const len = Math.hypot((prev.lon - cur.lon) * kx, (prev.lat - cur.lat) * M_LAT);
        const parts = Math.ceil(len / MAX_SEG);
        let last = prev;
        if (parts > 1 && !prev.adj.has(cur.id))
          for (let k = 1; k < parts; k++) {
            const m = this.mk(a.gx + ((b.gx - a.gx) * k) / parts, a.gy + ((b.gy - a.gy) * k) / parts);
            this.link(last, m);
            last = m;
          }
        if (parts <= 1 || last !== prev) this.link(last, cur);
        prev = cur;
      }
    }
  }
}

// blocked: węzły, przez które nie wolno jechać (już narysowana trasa); cel b jest zawsze dozwolony
// edges: zablokowane krawędzie "mniejszyId|większyId" (ulice już użyte przez trasę)
export function route(g: Graph, a: number, b: number, max = 500, blocked?: Set<number>, edges?: Set<string>): number[] | null {
  if (a === b) return [a];
  const dist = new Map<number, number>([[a, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  // kopiec binarny par [koszt, węzeł]
  const heap: [number, number][] = [[0, a]];
  const push = (e: [number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [du, u] = pop();
    if (u === b) break;
    if (done.has(u)) continue;
    done.add(u);
    if (du > max) break;
    for (const [v, w] of g.nodes.get(u)!.adj) {
      if (blocked && v !== b && blocked.has(v)) continue;
      if (edges && edges.has(u < v ? u + '|' + v : v + '|' + u)) continue;
      const nd = du + w;
      if (nd < (dist.get(v) ?? 1e18)) {
        dist.set(v, nd);
        prev.set(v, u);
        push([nd, v]);
      }
    }
  }
  if (!prev.has(b)) return null;
  const path = [b];
  while (path[0] !== a) path.unshift(prev.get(path[0])!);
  return path;
}
