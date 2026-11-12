import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// @ts-ignore Vite: zbundlowany worker jako osobny plik (MapLibre 6 liczy URL workera w runtime, co psuje bundler)
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
maplibregl.setWorkerUrl(workerUrl);
import { Graph, route } from './osm';
import { loadArea } from './tiles';

export interface Drawn {
  nodes: { lat: number; lon: number }[];
  closed: boolean;
  lengthM: number;
}

// Rysowanie trasy punktami: klik stawia START, każdy kolejny klik dokłada odcinek po ulicach
// do klikniętego miejsca (ruch myszką pokazuje tylko podgląd). Koniec: klik w START (pętla)
// albo przycisk "Koniec trasy" (sprint do ostatniego punktu).
export class MapDraw {
  map: maplibregl.Map;
  graph = new Graph();
  path: number[] = []; // zatwierdzona trasa (węzły grafu)
  marks: number[] = []; // długości path po każdym kliknięciu (do cofania)
  preview: number[] = []; // podgląd odcinka do kursora
  phase: 'idle' | 'drawing' | 'done' = 'idle';
  closable = false;
  fetching = false;
  pending: maplibregl.Point | null = null;
  raf = 0;
  ready = false;

  constructor(container: string, private onStatus: (s: string) => void, private onDone: (d: Drawn) => void, private onChange: () => void = () => {}) {
    this.map = new maplibregl.Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [21.0122, 52.2297],
      zoom: 12,
      attributionControl: { compact: true },
    });
    this.map.on('load', () => {
      const m = this.map;
      const empty = { type: 'FeatureCollection', features: [] } as any;
      for (const id of ['route', 'preview', 'pts']) m.addSource(id, { type: 'geojson', data: empty });
      const round = { 'line-cap': 'round', 'line-join': 'round' } as any;
      m.addLayer({ id: 'preview', type: 'line', source: 'preview', layout: round, paint: { 'line-color': '#ff5a1f', 'line-width': 5, 'line-opacity': 0.55, 'line-dasharray': [1, 1.6] } });
      m.addLayer({ id: 'route-case', type: 'line', source: 'route', layout: round, paint: { 'line-color': '#fff', 'line-width': 11 } });
      m.addLayer({ id: 'route', type: 'line', source: 'route', layout: round, paint: { 'line-color': '#ff5a1f', 'line-width': 6 } });
      m.addLayer({ id: 'pts', type: 'circle', source: 'pts', paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'c'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
      this.ready = true;
      this.onStatus('Wpisz adres i przybliż mapę.');
      this.ensureRoads();
      this.render();
    });
    this.map.on('moveend', () => this.ensureRoads());
    this.map.on('mousemove', (e) => {
      if (this.phase !== 'drawing' || e.originalEvent.buttons) return;
      this.pending = e.point;
      if (!this.raf)
        this.raf = requestAnimationFrame(() => {
          this.raf = 0;
          if (this.pending && this.phase === 'drawing') {
            this.plan(this.pending);
            this.render();
          }
        });
    });
    this.map.on('click', (e) => this.click(e.point));
  }

  goto(lat: number, lon: number) {
    this.reset();
    this.map.jumpTo({ center: [lon, lat], zoom: 16 });
  }

  async ensureRoads() {
    if (this.fetching) return; // nie czekamy na 'load' mapy: ulice idą z własnego pobrania kafli
    if (this.map.getZoom() < 13.5) {
      this.onStatus('Przybliż mapę, żeby rysować trasę.');
      return;
    }
    const b = this.map.getBounds();
    const w = b.getWest(), s = b.getSouth(), e = b.getEast(), n = b.getNorth();
    const key = [w, s, e, n].map((v) => v.toFixed(4)).join(',');
    this.fetching = true;
    if (this.graph.nodes.size === 0) this.onStatus('Wczytuję ulice…');
    try {
      const tiles = await loadArea(s, w, n, e);
      for (const t of tiles) this.graph.addTile(t);
      this.graph.heal();
      this.hint();
    } catch (err) {
      console.error(err);
      this.onStatus('Nie udało się wczytać ulic. Przesuń mapę, żeby spróbować ponownie.');
    }
    this.fetching = false;
    // widok mógł się zmienić w trakcie ładowania
    const b2 = this.map.getBounds();
    if ([b2.getWest(), b2.getSouth(), b2.getEast(), b2.getNorth()].map((v) => v.toFixed(4)).join(',') !== key) this.ensureRoads();
  }

  hint() {
    if (this.phase === 'idle') this.onStatus('Kliknij na ulicy, żeby ustawić START.');
    else if (this.phase === 'drawing') this.onStatus('Klikaj kolejne punkty trasy. Kliknij START, żeby zamknąć pętlę, albo „Koniec trasy", żeby zrobić sprint.');
  }

  nearest(pt: maplibregl.Point, maxPx = 40): number | null {
    let best: number | null = null;
    let bd = maxPx * maxPx;
    for (const [id, n] of this.graph.nodes) {
      const p = this.map.project([n.lon, n.lat]);
      const d = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2;
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  length(path = this.path) {
    let L = 0;
    for (let i = 1; i < path.length; i++) L += this.graph.nodes.get(path[i - 1])!.adj.get(path[i]) ?? 0;
    return L;
  }

  // wyznacza podgląd odcinka od końca trasy do punktu; zwraca komunikat błędu albo ''
  plan(pt: maplibregl.Point): string {
    this.preview = [];
    this.closable = false;
    const nid = this.nearest(pt, 46);
    if (nid === null) return 'Kliknij bliżej ulicy.';
    const end = this.path[this.path.length - 1];
    if (nid === end) return '';
    const toStart = nid === this.path[0];
    if (toStart && this.length() < 250) return 'Za krótka pętla, dołóż jeszcze kilka punktów.';
    // trasa nie może wracać po sobie ani się przecinać, więc szukamy drogi omijającej to, co już narysowane
    const used = new Set(this.path);
    if (used.has(nid) && !toStart) return 'Ten punkt leży już na trasie. Wybierz inny.';
    // Nie wolno jechać po już narysowanej ulicy ani przez START, ale wolno ją przeciąć na skrzyżowaniu:
    // w grze powstanie tam wiadukt.
    const edges = new Set<string>();
    for (let i = 1; i < this.path.length; i++) {
      const p = this.path[i - 1], q = this.path[i];
      edges.add(p < q ? p + '|' + q : q + '|' + p);
    }
    const r = route(this.graph, end, nid, 2500, new Set([this.path[0]]), edges);
    if (!r) return 'Nie da się tam dojechać bez jazdy po własnej trasie. Wybierz inny punkt.';
    const add = r.slice(1);
    this.preview = add;
    this.closable = toStart;
    return '';
  }

  click(pt: maplibregl.Point) {
    if (!this.ready || this.phase === 'done') return;
    if (this.phase === 'idle') {
      const n = this.nearest(pt, 50);
      if (n === null) return this.onStatus('Kliknij bliżej ulicy.');
      this.path = [n];
      this.marks = [1];
      this.phase = 'drawing';
      this.hint();
      this.onChange();
      return this.render();
    }
    const err = this.plan(pt);
    if (err) {
      this.onStatus(err);
      return this.render();
    }
    if (!this.preview.length) return;
    this.path.push(...this.preview);
    this.marks.push(this.path.length);
    const closing = this.closable;
    this.preview = [];
    this.closable = false;
    this.hint();
    this.onChange();
    if (closing) this.complete(true);
    else this.render();
  }

  // przycisk "Koniec trasy": sprint do ostatniego punktu
  finish() {
    if (this.phase !== 'drawing') return;
    if (this.length() < 150) return this.onStatus('Za krótka trasa, dołóż jeszcze punkt.');
    this.complete(false);
  }

  private complete(closed: boolean) {
    this.preview = [];
    this.phase = 'done';
    this.render();
    this.onChange();
    this.onDone({ nodes: this.path.map((id) => ({ lat: this.graph.nodes.get(id)!.lat, lon: this.graph.nodes.get(id)!.lon })), closed, lengthM: this.length() });
  }

  // cofa ostatni kliknięty punkt
  undo() {
    if (this.phase === 'idle') return;
    this.phase = 'drawing';
    this.preview = [];
    if (this.marks.length <= 1) return this.reset();
    this.marks.pop();
    this.path.length = this.marks[this.marks.length - 1];
    this.hint();
    this.onChange();
    this.render();
  }

  reset() {
    this.path = [];
    this.marks = [];
    this.preview = [];
    this.phase = 'idle';
    this.closable = false;
    this.render();
    this.hint();
    this.onChange();
  }

  render() {
    if (!this.ready) return;
    const ll = (id: number) => [this.graph.nodes.get(id)!.lon, this.graph.nodes.get(id)!.lat];
    const line = (ids: number[]) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ids.map(ll) } }) as any;
    (this.map.getSource('route') as maplibregl.GeoJSONSource).setData(line(this.path));
    (this.map.getSource('preview') as maplibregl.GeoJSONSource).setData(line(this.preview.length ? [this.path[this.path.length - 1], ...this.preview] : []));
    const f: any[] = [];
    const pt = (id: number, c: string, r: number) => f.push({ type: 'Feature', properties: { c, r }, geometry: { type: 'Point', coordinates: ll(id) } });
    for (let i = 1; i < this.marks.length - 1; i++) pt(this.path[this.marks[i] - 1], '#ffffff', 5);
    if (this.path.length > 1) pt(this.path[this.path.length - 1], '#e53935', 9);
    if (this.path.length) pt(this.path[0], this.closable ? '#ffd400' : '#22b455', this.closable ? 13 : 10);
    (this.map.getSource('pts') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: f } as any);
    this.map.getCanvas().style.cursor = this.phase === 'done' ? '' : 'crosshair';
  }
}
