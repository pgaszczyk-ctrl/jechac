// Syntetyczne miasto + tor do testów offline (?demo albo ?demo=sprint)
const LAT0 = 50.0617;
const LON0 = 19.9373;
const kx = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const ll = (x: number, z: number) => ({ lat: LAT0 - z / 110540, lon: LON0 + x / kx });

export function demoData(kind: string) {
  const sprint = kind === 'sprint' || kind === 'nawrot' || kind === 'prosta';
  const nodes: { lat: number; lon: number }[] = [];
  if (kind === 'osemka') {
    // ósemka: pętla przecinająca samą siebie, do testu wiaduktu (start na prostej, z dala od przecięcia)
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2 + Math.PI / 2;
      nodes.push(ll(170 * Math.sin(a), 85 * Math.sin(2 * a)));
    }
  } else if (kind === 'nawrot') {
    // ostry nawrót: tam i z powrotem ulicą oddaloną o 7 m, potem ciasna agrafka
    for (const [x, z] of [[-150, 0], [0, 0], [120, 0], [128, 3.5], [120, 7], [0, 7], [-60, 7], [-70, 30], [-58, 34], [40, 60]]) nodes.push(ll(x, z));
  } else if (kind === 'prosta') {
    // długa prosta do testu szykan
    for (let i = 0; i <= 10; i++) nodes.push(ll(-300 + i * 120, 10));
  } else if (sprint) {
    for (let i = 0; i <= 40; i++) nodes.push(ll(i * 12, Math.sin(i / 6) * 40));
  } else {
    const W = 170, H = 100, R = 55;
    const pts: number[][] = [];
    const arc = (cx: number, cz: number, a0: number) => {
      for (let i = 0; i <= 8; i++) {
        const a = a0 + (i / 8) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]);
      }
    };
    arc(W - R, -H + R, -Math.PI / 2);
    arc(W - R, H - R, 0);
    arc(-W + R, H - R, Math.PI / 2);
    arc(-W + R, -H + R, Math.PI);
    pts.push(pts[0]);
    // start on the top straight
    pts.forEach((p) => nodes.push(ll(p[0], p[1])));
  }
  const els: any[] = [];
  let id = 1;
  for (let gx = -320; gx <= 320; gx += 44)
    for (let gz = -240; gz <= 240; gz += 44) {
      const w = 26 + ((gx * 7 + gz * 3) % 9), d = 24 + ((gx * 5 + gz * 11) % 8);
      const x0 = gx, z0 = gz;
      const poly = [[x0, z0], [x0 + w, z0], [x0 + w, z0 + d], [x0, z0 + d], [x0, z0]].map((p) => ll(p[0], p[1]));
      els.push({ type: 'way', id: id++, geometry: poly, tags: { building: 'yes', 'building:levels': String(2 + (Math.abs(gx + gz) % 6)) } });
    }
  els.push({ type: 'way', id: id++, geometry: [ll(-300, -220), ll(-200, -220), ll(-200, -120), ll(-300, -120), ll(-300, -220)], tags: { leisure: 'park' } });
  for (let i = 0; i < 120; i++) els.push({ type: 'node', id: id++, ...ll(-320 + ((i * 53) % 640), -240 + ((i * 97) % 480)), tags: { natural: 'tree' } });
  return { nodes, els, closed: !sprint };
}
