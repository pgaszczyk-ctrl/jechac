import { Proj, hash } from './geo';

export const SP = 3; // sample spacing, m
export const CELL = 12;
export const KERB = 1.3; // szerokość tarki przy każdej krawędzi (m)
// na zwężeniach (nawroty, szykany) tarka jest węższa, żeby nie zjadała całego pasa
export const kerbW = (w: number) => Math.min(KERB, Math.max(0.4, w * 0.25));
// przełącznik testowy: ?force w adresie włącza profil na każdym zakręcie
const FORCE = typeof location !== 'undefined' && /[?&]force/.test(location.search);

export interface Track {
  proj: Proj;
  pts: number[][];
  tan: number[][];
  nor: number[][];
  curv: number[];
  y: number[]; // wysokość nawierzchni (m): 0 poza wiaduktami
  wp: number[]; // półszerokość po stronie +normalnej (m)
  wm: number[]; // półszerokość po stronie -normalnej (m)
  chicanes: number[]; // indeksy środków zapór szykan
  bank: number[]; // profilowanie zakrętu: nachylenie poprzeczne (>0: strona +normalnej jest niżej)
  hairpins: { i: number; dir: number }[]; // miejsce banera przed nawrotem; dir > 0: nawrót w prawo
  tunnels: { i: number; k: number }[]; // przecięcia, które wyglądają jak tunel pod wzgórzem (i = dół, k = góra)
  closed: boolean;
  width: number;
  laps: number;
  N: number;
  startIdx: number;
  finishIdx: number;
  length: number;
  grid: Map<string, number[]>;
}

function resample(p: number[][], closed: boolean): number[][] {
  const q = closed ? [...p, p[0]] : p;
  let L = 0;
  for (let i = 1; i < q.length; i++) L += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
  const n = Math.max(2, Math.round(L / SP));
  const step = L / n;
  const out: number[][] = [];
  let seg = 1;
  let segStart = 0;
  let segLen = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
  const count = closed ? n : n + 1;
  for (let k = 0; k < count; k++) {
    const d = k * step;
    while (seg < q.length - 1 && d > segStart + segLen) {
      segStart += segLen;
      seg++;
      segLen = Math.hypot(q[seg][0] - q[seg - 1][0], q[seg][1] - q[seg - 1][1]);
    }
    const t = segLen > 0 ? Math.min(1, (d - segStart) / segLen) : 0;
    out.push([q[seg - 1][0] + (q[seg][0] - q[seg - 1][0]) * t, q[seg - 1][1] + (q[seg][1] - q[seg - 1][1]) * t]);
  }
  return out;
}

function smooth(p: number[][], closed: boolean): number[][] {
  const n = p.length;
  return p.map((c, i) => {
    if (!closed && (i === 0 || i === n - 1)) return c;
    const a = p[(i - 1 + n) % n];
    const b = p[(i + 1) % n];
    return [(a[0] + c[0] + b[0]) / 3, (a[1] + c[1] + b[1]) / 3];
  });
}

export function buildTrack(ll: { lat: number; lon: number }[], closed: boolean, laps: number, width = 11, seed = 0): Track {
  const proj = new Proj(ll[0].lat, ll[0].lon);
  const raw = ll.map((p) => proj.toXZ(p.lat, p.lon));
  if (closed && Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]) < 1) raw.pop();
  let pts = resample(raw, closed);
  // mało wygładzania: trasa ma się trzymać ulic, a nie ścinać zakręty przez chodniki
  for (let k = 0; k < 4; k++) pts = smooth(pts, closed);
  pts = resample(pts, closed);

  let startIdx = 0;
  let finishIdx = pts.length;
  if (!closed) {
    const n0 = pts.length;
    const t0 = norm([pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]]);
    const t1 = norm([pts[n0 - 1][0] - pts[n0 - 4][0], pts[n0 - 1][1] - pts[n0 - 4][1]]);
    const pre: number[][] = [];
    for (let j = 12; j >= 1; j--) pre.push([pts[0][0] - t0[0] * SP * j, pts[0][1] - t0[1] * SP * j]);
    const post: number[][] = [];
    for (let j = 1; j <= 12; j++) post.push([pts[n0 - 1][0] + t1[0] * SP * j, pts[n0 - 1][1] + t1[1] * SP * j]);
    startIdx = pre.length;
    finishIdx = startIdx + n0 - 1;
    pts = [...pre, ...pts, ...post];
  }
  const N = pts.length;
  const at = (i: number) => (closed ? pts[((i % N) + N) % N] : pts[Math.max(0, Math.min(N - 1, i))]);
  const tan: number[][] = [];
  const nor: number[][] = [];
  for (let i = 0; i < N; i++) {
    const a = at(i - 1);
    const b = at(i + 1);
    const t = norm([b[0] - a[0], b[1] - a[1]]);
    tan.push(t);
    nor.push([-t[1], t[0]]);
  }
  const tn = (i: number) => (closed ? tan[((i % N) + N) % N] : tan[Math.max(0, Math.min(N - 1, i))]);
  const curv: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = tn(i - 4);
    const b = tn(i + 4);
    const ang = Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
    curv.push(ang / (8 * SP));
  }
  // Szerokość po wewnętrznej stronie zakrętu nie może przekroczyć promienia łuku,
  // inaczej krawędź jezdni i banda zawijają się i wchodzą na drogę.
  const half = width / 2;
  let wp: number[] = [], wm: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = tn(i - 1), b = tn(i + 1);
    const ang = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]); // >0: skręt w stronę +normalnej
    const R = Math.abs(ang) > 1e-4 ? (2 * SP) / Math.abs(ang) : 1e9;
    const inner = Math.max(1.8, Math.min(half, R * 0.7));
    wp.push(ang > 0 ? inner : half);
    wm.push(ang < 0 ? inner : half);
  }
  const spread = (w: number[]) => {
    const at2 = (i: number) => (closed ? w[((i % N) + N) % N] : w[Math.max(0, Math.min(N - 1, i))]);
    // zwężenie zaczyna się kilka metrów przed zakrętem i kończy za nim, łagodnie
    let m = w.map((_, i) => Math.min(at2(i - 2), at2(i - 1), at2(i), at2(i + 1), at2(i + 2)));
    for (let k = 0; k < 2; k++) {
      const c = m.slice();
      const g = (i: number) => (closed ? c[((i % N) + N) % N] : c[Math.max(0, Math.min(N - 1, i))]);
      m = c.map((v, i) => Math.min(v, (g(i - 1) + v + g(i + 1)) / 3 + 0.4));
    }
    return m;
  };
  // Przecięcia trasy z samą sobą: późniejszy fragment wjeżdża rampą na wiadukt, wcześniejszy zostaje na dole.
  const y: number[] = new Array(N).fill(0);
  const taken: { i: number; k: number }[] = []; // przecięcia z wiaduktem: i = dół, k = góra
  {
    const near0 = new Map<string, number[]>();
    pts.forEach((p, i) => {
      const k = Math.floor(p[0] / CELL) + ',' + Math.floor(p[1] / CELL);
      (near0.get(k) ?? near0.set(k, []).get(k)!).push(i);
    });
    const cand: { i: number; k: number; d: number }[] = [];
    const orient = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const crosses = (a: number[], b: number[], c: number[], d: number[]) => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
    const nxt = (i: number) => (closed ? (i + 1) % N : i + 1);
    for (let i = 0; i < N; i++) {
      const i2 = nxt(i);
      if (i2 >= N) continue;
      const p = pts[i];
      const cx = Math.floor(p[0] / CELL), cz = Math.floor(p[1] / CELL);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const k of near0.get(cx + a + ',' + (cz + b)) ?? []) {
            if (k <= i) continue;
            const k2 = nxt(k);
            if (k2 >= N) continue;
            let di = k - i;
            if (closed) di = Math.min(di, N - di);
            if (di < 14) continue;
            if (!crosses(p, pts[i2], pts[k], pts[k2])) continue; // samo zbliżenie (nawrót) to nie przecięcie
            const dot = Math.abs(tan[i][0] * tan[k][0] + tan[i][1] * tan[k][1]);
            if (dot > 0.9) continue; // bardzo płaskie przecięcie: wiadukt nie miałby gdzie zejść, zostaje jeden poziom
            cand.push({ i, k, d: dot });
          }
    }
    cand.sort((a, b) => a.d - b.d);
    const H = 4.8, R = 12; // wysokość wiaduktu i długość rampy w próbkach (~36 m): krótka, żeby nie wchodziła na sąsiednie ulice
    for (const c of cand) {
      if (taken.some((t) => Math.abs(t.i - c.i) < 18 && Math.abs(t.k - c.k) < 18)) continue;
      taken.push(c);
      for (let j = -R; j <= R; j++) {
        let idx = c.k + j;
        if (closed) idx = ((idx % N) + N) % N;
        else if (idx < 0 || idx >= N) continue;
        y[idx] = Math.max(y[idx], H * 0.5 * (1 + Math.cos((Math.PI * j) / R)));
      }
    }
    // dolny fragment musi zostać na ziemi w miejscu przecięcia
    for (const c of taken) for (let j = -3; j <= 3; j++) {
      let idx = c.i + j;
      if (closed) idx = ((idx % N) + N) % N;
      else if (idx < 0 || idx >= N) continue;
      y[idx] = 0;
    }
  }

  // Nawroty i ulice biegnące tuż obok siebie: dwa fragmenty trasy nie mogą na siebie nachodzić.
  // Każdy oddaje połowę odstępu (minus szczelina na bandę), więc między nimi zostaje wyraźny rozdział.
  {
    const near = new Map<string, number[]>();
    pts.forEach((p, i) => {
      const k = Math.floor(p[0] / CELL) + ',' + Math.floor(p[1] / CELL);
      (near.get(k) ?? near.set(k, []).get(k)!).push(i);
    });
    for (let i = 0; i < N; i++) {
      const p = pts[i], t = tan[i], n = nor[i];
      const cx = Math.floor(p[0] / CELL), cz = Math.floor(p[1] / CELL);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const k of near.get(cx + a + ',' + (cz + b)) ?? []) {
            let di = Math.abs(k - i);
            if (closed) di = Math.min(di, N - di);
            if (di <= 3) continue;
            const dx = pts[k][0] - p[0], dz = pts[k][1] - p[1];
            if (Math.abs(dx * t[0] + dz * t[1]) > SP * 0.75) continue; // tylko punkty leżące obok, nie przed/za
            {
              // okolica wiaduktu: tam fragmenty mają się minąć w pionie, nie zwężać
              const cd = (u: number, w: number) => (closed ? Math.min(Math.abs(u - w), N - Math.abs(u - w)) : Math.abs(u - w));
              if (taken.some((c) => (cd(i, c.i) < 10 && cd(k, c.k) < 10) || (cd(i, c.k) < 10 && cd(k, c.i) < 10))) continue;
            }
            if (Math.abs(y[i] - y[k]) > 2) continue; // różne poziomy
            const lat = dx * n[0] + dz * n[1];
            if (Math.abs(lat) >= width) continue;
            const lim = Math.max(1.5, Math.abs(lat) / 2 - 0.25);
            if (lat > 0) wp[i] = Math.min(wp[i], lim);
            else wm[i] = Math.min(wm[i], lim);
          }
    }
  }
  wp = spread(wp);
  wm = spread(wm);

  // Szykany: na każde 150 m prostej 50% szansy. Trasa nie schodzi z ulicy — jezdnię zwężają
  // na przemian dwie zapory sięgające za oś, więc trzeba odbić w jedną, a potem w drugą stronę.
  // Losowanie zależy tylko od geometrii, żeby każdy gracz w sieci dostał te same szykany.
  const chicanes: number[] = [];
  {
    const SEG = 50, FLAT = 2, TAPER = 5, GAP = 12, DEEP = -0.6; // próbki po 3 m; DEEP: krawędź zapory za osią
    const COS = Math.cos((7 * Math.PI) / 180);
    const lo = closed ? 0 : startIdx, hi = closed ? N - 1 : finishIdx;
    let s = lo;
    while (s < hi) {
      let e = s;
      while (e < hi && tan[e + 1][0] * tan[s][0] + tan[e + 1][1] * tan[s][1] > COS && curv[e + 1] < 0.004) e++;
      for (let k = 0; k + SEG <= e - s; k += SEG) {
        const a = s + k + Math.round((SEG - GAP) / 2), b = a + GAP;
        const seed = Math.round(pts[s + k][0] * 7 + pts[s + k][1] * 13);
        if (hash(seed) >= 0.5) continue;
        const z0 = a - FLAT - TAPER, z1 = b + FLAT + TAPER;
        let ok = true;
        for (let i = z0 - 4; i <= z1 + 4; i++) {
          if (i < 0 || i >= N || y[i] > 0.05 || wp[i] < half - 0.01 || wm[i] < half - 0.01) ok = false;
          else if (Math.abs(i - startIdx) < 22 || (!closed && Math.abs(i - finishIdx) < 22) || (closed && N - i < 22)) ok = false;
        }
        if (!ok) continue;
        const first = hash(seed + 1) < 0.5 ? wp : wm, second = first === wp ? wm : wp;
        for (let i = z0; i <= z1; i++) {
          const prof = (c: number) => {
            const d = Math.max(0, Math.abs(i - c) - FLAT) / TAPER;
            return d >= 1 ? half : DEEP + (half - DEEP) * d;
          };
          first[i] = Math.min(first[i], prof(a));
          second[i] = Math.min(second[i], prof(b));
          curv[i] = Math.max(curv[i], 0.03); // boty zwalniają jak przed zakrętem
        }
        chicanes.push(a, b);
      }
      s = e + 1;
    }
  }
  // Profilowane zakręty: wewnętrzna krawędź zostaje przy ziemi, zewnętrzna idzie w górę.
  // Zakręt, za którym jest prosta, ma 30% szansy, pozostałe 12% (średnio ok. 20%).
  const bank: number[] = new Array(N).fill(0);
  {
    const B = 0.2, RAMP = 6;
    const inChic = new Array(N).fill(false);
    for (const c of chicanes) for (let j = -9; j <= 9; j++) if (c + j >= 0 && c + j < N) inChic[c + j] = true;
    const sg = (i: number) => {
      const a = tn(i - 1), b = tn(i + 1);
      return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
    };
    const turn = (i: number) => curv[i] > 0.012 && !inChic[i];
    let s = 0;
    while (s < N) {
      if (!turn(s)) { s++; continue; }
      let e = s;
      while (e + 1 < N && turn(e + 1)) e++;
      let sum = 0, abs = 0;
      for (let i = s; i <= e; i++) { const v = sg(i); sum += v; abs += Math.abs(v); }
      const next = e + 1;
      if (Math.abs(sum) / 2 >= 0.5 && Math.abs(sum) >= 0.8 * abs) {
        let straightAfter = true;
        for (let j = 1; j <= 15; j++) {
          const q = closed ? (e + j) % N : e + j;
          if (q >= N || curv[q] > 0.006) straightAfter = false;
        }
        const sign = Math.sign(sum);
        let ok = hash(Math.round(pts[s][0] * 5 + pts[s][1] * 11) + 77) < (FORCE ? 1 : straightAfter ? 0.3 : 0.12);
        for (let i = s - RAMP - 1; i <= e + RAMP + 1 && ok; i++) {
          if (!closed && (i < 0 || i >= N)) { ok = false; break; }
          const q = ((i % N) + N) % N;
          const outer = sign > 0 ? wm[q] : wp[q];
          if (y[q] > 0.05 || outer < half - 0.01 || inChic[q] || bank[q] !== 0) ok = false;
          if (Math.abs(q - startIdx) < 15 || (!closed && Math.abs(q - finishIdx) < 15) || (closed && N - q < 15)) ok = false;
        }
        if (ok)
          for (let i = s - RAMP; i <= e + RAMP; i++) {
            const q = ((i % N) + N) % N;
            const d = i < s ? (s - i) / RAMP : i > e ? (i - e) / RAMP : 0;
            const f = 1 - d * d * (3 - 2 * d);
            bank[q] = sign * B * f;
            curv[q] *= 1 - 0.4 * f; // boty jadą profilowany zakręt szybciej
          }
      }
      s = next;
    }
  }
  // Nawroty: co najmniej 120° skrętu na 42 m. Baner ostrzegawczy staje ok. 36 m wcześniej.
  const hairpins: { i: number; dir: number }[] = [];
  {
    const WIN = 14;
    const turnAt = (i: number) => {
      const a = tn(i - 1), b = tn(i + 1);
      return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) / 2;
    };
    let i = 0;
    while (i < N) {
      let sum = 0;
      for (let j = 0; j < WIN; j++) {
        const q = closed ? (i + j) % N : i + j;
        if (q >= N) break;
        sum += turnAt(q);
      }
      if (Math.abs(sum) >= 2.1) {
        let b = i - 12;
        if (closed) b = ((b % N) + N) % N;
        if (b >= 0 && y[b] < 0.05 && Math.abs(b - startIdx) > 8) hairpins.push({ i: b, dir: Math.sign(sum) });
        i += WIN + 20;
      } else i++;
    }
  }
  // tunel czy wiadukt: losowane dla każdego przecięcia z ziarna wyścigu
  const tunnels = taken.filter((c) => hash(seed * 7919 + c.i * 31 + c.k) < 0.5).map((c) => ({ i: c.i, k: c.k }));
  const grid = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const k = Math.floor(p[0] / CELL) + ',' + Math.floor(p[1] / CELL);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const length = closed ? N * SP : (finishIdx - startIdx) * SP;
  return { proj, pts, tan, nor, curv, y, wp, wm, chicanes, bank, hairpins, tunnels, closed, width, laps, N, startIdx, finishIdx, length, grid };
}

// wysokość nawierzchni w punkcie odsuniętym o lat od osi (wiadukt + profilowanie zakrętu)
export function surfY(t: Track, i: number, lat: number): number {
  const b = t.bank[i];
  return t.y[i] + (b ? Math.abs(b) * (t.width / 2) - b * lat : 0);
}

function norm(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

export function nearestGlobal(t: Track, x: number, z: number): { i: number; d: number } | null {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let bi = -1;
  let bd = 1e18;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) {
      const l = t.grid.get(cx + a + ',' + (cz + b));
      if (!l) continue;
      for (const i of l) {
        const d = (t.pts[i][0] - x) ** 2 + (t.pts[i][1] - z) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
    }
  return bi < 0 ? null : { i: bi, d: Math.sqrt(bd) };
}

export function nearestNear(t: Track, x: number, z: number, hint: number): number {
  let bi = hint;
  let bd = 1e18;
  for (let o = -20; o <= 20; o++) {
    let i = hint + o;
    if (t.closed) i = ((i % t.N) + t.N) % t.N;
    else if (i < 0 || i >= t.N) continue;
    const d = (t.pts[i][0] - x) ** 2 + (t.pts[i][1] - z) ** 2;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return bi;
}
