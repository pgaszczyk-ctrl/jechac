export const M_LAT = 110540;

export class Proj {
  kx: number;
  constructor(public lat0: number, public lon0: number) {
    this.kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  }
  // x = east, z = south (north is -z)
  toXZ(lat: number, lon: number): number[] {
    return [(lon - this.lon0) * this.kx, -(lat - this.lat0) * M_LAT];
  }
}

export function distLL(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * M_LAT);
}

export function pip(p: number[], poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
