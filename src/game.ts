import * as THREE from 'three';
import { Track, nearestNear, SP, surfY, kerbW } from './track';
import { buildWorld } from './world';
import { DRIVERS, DriverId, addLights, makeKart, steerKart } from './karts';
import { Smoke } from './fx';

export interface Input {
  thr: number;
  brk: number;
  st: number;
  hb: boolean;
}

// Kto steruje kartem NA TYM urządzeniu:
// key = klawiatura/dotyk/gamepad, pad = telefon-kontroler (wejście z sieci),
// bot = symulowany tutaj, remote = symulowany na innym urządzeniu (tylko wyświetlamy)
export interface KartSpec {
  kid: number;
  driver: DriverId;
  name: string;
  ctrl: 'key' | 'pad' | 'bot' | 'remote';
  padId?: string;
  isBot?: boolean;
  slot: number;
}

export interface NetLink {
  sendState(a: number[][]): void;
  sendPad(padId: string, info: any): void;
  padInputs: Map<string, Input>;
  onState: ((a: number[][]) => void) | null;
}

export interface GameOpts {
  canvas: HTMLCanvasElement;
  viewsEl: HTMLElement;
  track: Track;
  els: any[];
  karts: KartSpec[];
  net?: NetLink;
  hold?: boolean;
  difficulty?: number; // 0 łatwy, 1 średni, 2 trudny
  muted?: boolean;
  assist?: boolean; // poziom „Początkujący": gra pomaga skręcać
  onDone: (r: Result) => void;
}

interface Kart extends KartSpec {
  color: string;
  obj: THREE.Group;
  x: number;
  y: number;
  z: number;
  h: number;
  vx: number;
  vz: number;
  speed: number;
  slip: number;
  steer: number;
  idx: number;
  prog: number;
  lap: number;
  finished: number | null;
  maxSpeed: number;
  grip: number;
  lane: number;
  stuck: number;
  wrong: number;
  skid: number; // 0..1: jak mocno opony się ślizgają (pisk, dym)
  smokeAcc: number;
  draft: number; // 0..1: jazda w cieniu aerodynamicznym rywala
  lean: number;
  kerb: boolean; // koła na tarce pobocza
  // cel dla kartów zdalnych
  tx: number;
  tz: number;
  th: number;
  ts: number;
  tsteer: number;
  tt: number;
}

interface View {
  kart: Kart;
  cam: THREE.PerspectiveCamera;
  camH: number;
  camPos: THREE.Vector3;
  first: boolean;
  rect: number[]; // x, y, w, h (ułamki ekranu, od lewego górnego rogu)
  el: Record<string, HTMLElement>;
}

export interface Result {
  place: number;
  total: number;
  time: number;
  standings: { name: string; time: number | null; bot: boolean; me: boolean }[];
}

const MAX_SPEED = 30;
// Poziomy trudności botów: v = dodatek do prędkości maks., g = mnożnik odwagi w zakrętach,
// back = zwalnianie, gdy bot ucieka ludziom, push = dociskanie, gdy zostaje z tyłu, top = limit prędkości.
const DIFF = [
  { v: 0, g: 1, back: 0.9, push: 1.07, top: 30 }, // łatwy
  { v: 0.9, g: 1.55, back: 0.97, push: 1.08, top: 30.5 }, // średni
  { v: 1.7, g: 2.3, back: 1, push: 1.1, top: 31.2 }, // trudny
];
const NO_INPUT: Input = { thr: 0, brk: 0, st: 0, hb: false };
// zapis do DOM tylko przy zmianie: mniej pracy przeglądarki w każdej klatce
const setText = (el: HTMLElement, t: string) => {
  if ((el as any)._t !== t) {
    (el as any)._t = t;
    el.textContent = t;
  }
};
const setStyle = (el: HTMLElement, o: string) => {
  if ((el as any)._o !== o) {
    (el as any)._o = o;
    el.style.opacity = o;
  }
};

// ---------- dźwięk silników
// Każdy kierowca ma własny charakter silnika: wysokość, barwę, liczbę biegów i skłonność do strzałów z wydechu.
interface EngineProfile {
  base: number; // Hz na wolnych obrotach
  top: number; // Hz przy odcięciu
  gears: number;
  wave: OscillatorType;
  sub: number; // głośność tonu o oktawę niżej (bas)
  grit: number; // przesterowanie
  cut: number; // jasność barwy (filtr)
  fire: number; // głębokość „bulgotu" zapłonu
  pops: number; // 0..1: jak chętnie strzela z wydechu
  vol: number;
}
const PROFILES: Record<DriverId, EngineProfile> = {
  general: { base: 34, top: 125, gears: 4, wave: 'sawtooth', sub: 0.8, grit: 4, cut: 750, fire: 0.45, pops: 1.0, vol: 1.15 }, // ciężkie V8, dużo strzałów
  gryzek: { base: 68, top: 220, gears: 5, wave: 'square', sub: 0.25, grit: 1.6, cut: 1300, fire: 0.3, pops: 0.45, vol: 0.85 }, // brzęczący mały silniczek
  runomistrz: { base: 42, top: 150, gears: 4, wave: 'sawtooth', sub: 0.5, grit: 2.2, cut: 620, fire: 0.6, pops: 0.6, vol: 1.0 }, // sapiąca maszyna parowa
  teczka: { base: 58, top: 245, gears: 5, wave: 'sawtooth', sub: 0.3, grit: 2.6, cut: 1700, fire: 0.3, pops: 0.75, vol: 0.95 }, // wysokie obroty, ostry
  czarlie: { base: 50, top: 160, gears: 3, wave: 'triangle', sub: 0.55, grit: 1.3, cut: 820, fire: 0.75, pops: 0.35, vol: 1.0 }, // pyrkająca kosiarka
  niutu: { base: 82, top: 300, gears: 6, wave: 'sawtooth', sub: 0.12, grit: 1.0, cut: 2400, fire: 0.15, pops: 0.5, vol: 0.8 }, // kosmiczne wycie
};
const VMAX = 31; // m/s: górna granica skali biegów

function gritCurve(k: number) {
  const c = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 2 - 1;
    c[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return c;
}

class Voice {
  p: EngineProfile;
  o1: OscillatorNode;
  o2: OscillatorNode;
  sub: OscillatorNode;
  lp: BiquadFilterNode;
  am: GainNode;
  lfo: OscillatorNode;
  lfoG: GainNode;
  out: GainNode;
  pan: StereoPannerNode;
  gear = 0;
  thr = 0.5;
  prevV = 0;
  nextPop = 0;
  cutUntil = 0;
  constructor(private eng: Engine, driver: DriverId) {
    const ctx = eng.ctx!;
    const p = (this.p = { ...PROFILES[driver] });
    // drobne różnice nawet między dwoma takimi samymi kierowcami
    const j = 0.94 + Math.random() * 0.12;
    p.base *= j;
    p.top *= j;
    this.o1 = ctx.createOscillator();
    this.o1.type = p.wave;
    this.o2 = ctx.createOscillator();
    this.o2.type = 'sawtooth';
    this.o2.detune.value = 9;
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    const g1 = ctx.createGain();
    g1.gain.value = 0.5;
    const g2 = ctx.createGain();
    g2.gain.value = 0.28;
    const gs = ctx.createGain();
    gs.gain.value = p.sub;
    const ws = ctx.createWaveShaper();
    ws.curve = gritCurve(p.grit);
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = p.cut;
    this.lp.Q.value = 2.5;
    // „bulgot": głośność pulsuje w rytm zapłonu
    this.am = ctx.createGain();
    this.am.gain.value = 1 - p.fire;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'square';
    this.lfoG = ctx.createGain();
    this.lfoG.gain.value = p.fire;
    this.lfo.connect(this.lfoG).connect(this.am.gain);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.o1.connect(g1).connect(ws);
    this.o2.connect(g2).connect(ws);
    this.sub.connect(gs).connect(ws);
    ws.connect(this.lp).connect(this.am).connect(this.out).connect(this.pan).connect(eng.master);
    for (const o of [this.o1, this.o2, this.sub, this.lfo]) o.start();
  }
  // strzał z wydechu: krótki trzask szumu + niskie tąpnięcie
  pop(t: number, loud: number) {
    const ctx = this.eng.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.eng.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 350 + Math.random() * 700;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    const peak = 0.55 * loud * this.p.vol;
    const dec = 0.035 + Math.random() * 0.06;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    n.connect(bp).connect(g).connect(this.pan);
    n.start(t, Math.random() * 0.8, dec + 0.02);
    const th = ctx.createOscillator();
    th.frequency.setValueAtTime(95 + Math.random() * 40, t);
    th.frequency.exponentialRampToValueAtTime(40, t + 0.08);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(peak * 0.9, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    th.connect(tg).connect(this.pan);
    th.start(t);
    th.stop(t + 0.1);
  }
  burst(t: number, count: number, loud: number) {
    if (loud < 0.05 || t < this.nextPop) return;
    this.nextPop = t + 1.2 + Math.random() * 2.2; // przerwa po serii, żeby nie strzelał bez przerwy
    let tt = t;
    for (let i = 0; i < count; i++) {
      this.pop(tt, loud * (0.6 + Math.random() * 0.5));
      tt += 0.045 + Math.random() * 0.09;
    }
  }
  update(t: number, dt: number, speed: number, thrIn: number | null, level: number, pan: number) {
    const p = this.p;
    const v = Math.abs(speed);
    // gaz: od gracza wprost, u rywali z przyspieszenia
    let thr = thrIn;
    if (thr === null) {
      const a = (v - this.prevV) / Math.max(dt, 1e-3);
      thr = a > 0.6 ? 1 : a < -1.5 ? 0 : 0.5;
    }
    this.prevV = v;
    const lastThr = this.thr;
    this.thr += (thr - this.thr) * Math.min(1, dt * (thrIn === null ? 4 : 10));
    // biegi: obroty rosną w obrębie biegu, przy zmianie spadają
    const band = VMAX / p.gears;
    const g = Math.min(p.gears - 1, Math.floor(v / band));
    const frac = Math.min(1, (v - g * band) / band);
    let rpm = v < 0.8 ? 0.06 + this.thr * 0.12 : 0.2 + frac * 0.8 - g * 0.03;
    if (g > this.gear && v > 2) {
      this.cutUntil = t + 0.09; // krótkie odcięcie przy zmianie biegu
      if (Math.random() < p.pops * 0.55) this.burst(t + 0.03, 1 + Math.floor(Math.random() * 2), 0.8 * level);
    }
    this.gear = g;
    // odpuszczenie gazu na wysokich obrotach: seria strzałów
    if (lastThr > 0.65 && this.thr < 0.45 && rpm > 0.45 && Math.random() < p.pops) this.burst(t + 0.02, 2 + Math.floor(Math.random() * 4), level);
    // toczenie się bez gazu: pojedyncze, losowe pyrknięcia
    if (this.thr < 0.3 && v > 7 && t > this.nextPop && level > 0.05) {
      if (Math.random() < p.pops * 0.5) this.pop(t, 0.7 * level);
      this.nextPop = t + 0.6 + Math.random() * 1.8;
    }
    // drobne wahania obrotów, żeby silnik „żył"
    rpm += Math.sin(t * 7.3 + p.base) * 0.008 + (Math.random() - 0.5) * 0.01;
    const f = p.base + (p.top - p.base) * Math.max(0, rpm);
    this.o1.frequency.setTargetAtTime(f, t, 0.03);
    this.o2.frequency.setTargetAtTime(f * 1.5, t, 0.03);
    this.sub.frequency.setTargetAtTime(f / 2, t, 0.03);
    this.lfo.frequency.setTargetAtTime(Math.max(6, f / 4), t, 0.03);
    this.lp.frequency.setTargetAtTime(p.cut * (0.55 + this.thr * 0.7), t, 0.06);
    const cut = t < this.cutUntil ? 0.35 : 1;
    this.out.gain.setTargetAtTime(level * p.vol * cut * (0.05 + this.thr * 0.06), t, cut < 1 ? 0.01 : 0.05);
    this.pan.pan.setTargetAtTime(pan, t, 0.05);
  }
  stop() {
    for (const o of [this.o1, this.o2, this.sub, this.lfo]) o.stop();
    this.out.disconnect();
  }
}

class Engine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  noise!: AudioBuffer;
  voices = new Map<number, Voice>();
  sqF!: BiquadFilterNode;
  sqG!: GainNode;
  muted = false;
  start() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, len);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // pisk opon: zapętlony szum przez wąski filtr pasmowy
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noise;
      noise.loop = true;
      this.sqF = this.ctx.createBiquadFilter();
      this.sqF.type = 'bandpass';
      this.sqF.frequency.value = 1500;
      this.sqF.Q.value = 9;
      this.sqG = this.ctx.createGain();
      this.sqG.gain.value = 0;
      noise.connect(this.sqF).connect(this.sqG).connect(this.master);
      noise.start();
    } catch {
      this.ctx = null;
    }
  }
  // me: kart, którego słucha gracz; pozostałe słychać ciszej, zależnie od odległości i strony
  update(me: Kart, karts: Kart[], thr: number, dt: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.05);
    this.sqG.gain.setTargetAtTime(Math.min(0.22, me.skid * 0.24), t, 0.05);
    this.sqF.frequency.setTargetAtTime(1250 + Math.abs(me.speed) * 22, t, 0.1);
    const rx = Math.cos(me.h), rz = -Math.sin(me.h); // prawa strona gracza
    karts.forEach((k, i) => {
      let level = 1, pan = 0;
      if (k !== me) {
        const dx = k.x - me.x, dz = k.z - me.z;
        const d = Math.hypot(dx, dz);
        level = Math.max(0, 1 - d / 70) ** 2 * 0.55;
        pan = Math.max(-0.9, Math.min(0.9, (dx * rx + dz * rz) / 14));
      }
      let v = this.voices.get(i);
      if (!v) this.voices.set(i, (v = new Voice(this, k.driver)));
      v.update(t, dt, k.speed, k === me ? thr : null, level, pan);
    });
  }
  stop() {
    for (const v of this.voices.values()) v.stop();
    this.voices.clear();
    this.ctx?.close();
    this.ctx = null;
  }
}

const LAYOUTS: Record<number, number[][]> = {
  1: [[0, 0, 1, 1]],
  2: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  3: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5]],
  4: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
};

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  karts: Kart[] = [];
  views: View[] = [];
  keys = new Set<string>();
  raceT = -3.5;
  hold = false;
  paused = false;
  // diagnostyka przycięć: ile klatek trwało ponad 50 ms i czy winna była gra (własne obliczenia), czy coś poza nią
  hitch = { n: 0, own: 0, worst: 0, frames: 0 };
  assist = false;
  private tmpV = new THREE.Vector3();
  private miniBg: HTMLCanvasElement | null = null;
  level = 0;
  raf = 0;
  last = 0;
  over = false;
  engine = new Engine();
  mini: CanvasRenderingContext2D | null = null;
  miniBox = { x: 0, z: 0, s: 1 };
  lastThr = 0;
  diff = DIFF[0];
  smoke = new Smoke();
  // płynność: pomiar czasu klatki i stopniowe obniżanie jakości, gdy urządzenie nie wyrabia
  pr = 1;
  dt = 1 / 60;
  frameNo = 0;
  slowAcc = 0;
  slowN = 0;
  mirrorOn = true;
  worldUpdate: ((t: number) => void) | null = null;
  touchCtl: Input = { thr: 0, brk: 0, st: 0, hb: false }; // sterowanie dotykowe (gałka/żyroskop + przyciski)
  netAcc = 0;
  padAcc = 0;
  private canvas: HTMLCanvasElement;
  private track: Track;
  private net?: NetLink;
  private onDone: (r: Result) => void;
  private viewsEl: HTMLElement;
  // lusterko (tylko przy jednym widoku)
  mirrorRT = new THREE.WebGLRenderTarget(640, 188);
  mirrorCam = new THREE.PerspectiveCamera(48, 640 / 188, 0.5, 260);
  hudScene = new THREE.Scene();
  hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  mirrorMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture, side: THREE.DoubleSide, fog: false }));
  mirrorFrame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x15120e, fog: false }));

  constructor(o: GameOpts) {
    this.canvas = o.canvas;
    this.track = o.track;
    this.net = o.net;
    this.onDone = o.onDone;
    this.viewsEl = o.viewsEl;
    this.hold = !!o.hold;
    this.level = o.difficulty ?? 0;
    this.diff = DIFF[this.level] ?? DIFF[0];
    this.engine.muted = !!o.muted;
    this.assist = !!o.assist;
    const track = o.track;
    this.renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true });
    this.pr = Math.min(devicePixelRatio, matchMedia('(pointer:coarse)').matches ? 1.25 : 1.5);
    this.renderer.setPixelRatio(this.pr);
    this.scene.background = new THREE.Color(0x7fd0ff);
    this.scene.fog = new THREE.Fog(0x9bdcff, 140, 560);
    addLights(this.scene);
    const world = buildWorld(track, o.els);
    this.scene.add(world);
    this.worldUpdate = world.userData.update ?? null;
    this.scene.add(this.smoke.mesh);

    let botN = 0;
    for (const s of o.karts) {
      const obj = makeKart(s.driver);
      this.scene.add(obj);
      const side = s.slot % 2 ? 2.2 : -2.2;
      const sb = Math.round((7 + 3 * s.slot) / SP);
      const i = track.closed ? (((track.N - sb) % track.N) + track.N) % track.N : Math.max(0, track.startIdx - sb);
      const p = track.pts[i], nx = track.nor[i];
      const d = DRIVERS.find((q) => q.id === s.driver)!;
      const bi = s.isBot ? botN++ % 3 : 0;
      const h = Math.atan2(-track.tan[i][0], -track.tan[i][1]);
      const x = p[0] + nx[0] * side, z = p[1] + nx[1] * side;
      this.karts.push({
        ...s, color: d.color, obj, x, y: track.y[i], z, h,
        vx: 0, vz: 0, speed: 0, slip: 0, steer: 0, idx: i,
        prog: -sb, lap: 0, finished: null,
        // boty: szybki na prostej a ostrożny w zakręcie, średni, wolniejszy a odważny w zakręcie
        maxSpeed: [29.3, 28.3, 27.3][bi] + this.diff.v + Math.random() * 0.6,
        grip: ([9.5, 11, 12.5][bi] + Math.random()) * this.diff.g,
        lane: [-2.6, 2.6, 0][bi],
        stuck: 0, wrong: 0, skid: 0, smokeAcc: 0, draft: 0, lean: 0, kerb: false,
        tx: x, tz: z, th: h, ts: 0, tsteer: 0, tt: performance.now(),
      });
      obj.scale.setScalar(0.85); // mniejsze bolidy: więcej miejsca na jezdni i poboczu
      obj.rotation.order = 'YXZ'; // kierunek, potem pochylenie na rampie, potem przechył
      obj.position.set(x, track.y[i], z);
      obj.rotation.y = h;
    }

    // widoki: po jednym na każdego gracza sterującego na tym ekranie
    const locals = this.karts.filter((k) => k.ctrl === 'key' || k.ctrl === 'pad').slice(0, 4);
    const lay = LAYOUTS[Math.max(1, locals.length)];
    this.viewsEl.innerHTML = '';
    this.viewsEl.className = locals.length > 1 ? 'multi' : '';
    (locals.length ? locals : [this.karts[0]]).forEach((kart, n) => {
      const r = lay[n];
      const box = document.createElement('div');
      box.className = 'view';
      box.style.cssText = `left:${r[0] * 100}%;top:${r[1] * 100}%;width:${r[2] * 100}%;height:${r[3] * 100}%`;
      box.innerHTML = '<div class="pos"></div><div class="lap"></div><div class="time"></div><div class="spd"><span class="speed">0</span><small>km/h</small></div><div class="vname"></div><div class="warn">ZŁY KIERUNEK</div><div class="draft">💨 W CIENIU!</div><div class="count"></div>';
      this.viewsEl.appendChild(box);
      const el: Record<string, HTMLElement> = {};
      for (const c of ['pos', 'lap', 'time', 'speed', 'vname', 'warn', 'count', 'draft']) el[c] = box.querySelector('.' + c) as HTMLElement;
      el.vname.textContent = locals.length > 1 ? kart.name : '';
      el.vname.style.color = kart.color;
      this.views.push({ kart, cam: new THREE.PerspectiveCamera(70, 1, 0.5, 620), camH: kart.h, camPos: new THREE.Vector3(), first: true, rect: r, el });
    });

    this.mirrorFrame.position.z = -0.5;
    this.hudScene.add(this.mirrorFrame, this.mirrorMesh);
    if (this.net)
      this.net.onState = (a) => {
        const now = performance.now();
        for (const s of a) {
          const c = this.karts.find((k) => k.kid === s[0]);
          if (!c || c.ctrl !== 'remote') continue;
          c.tx = s[1]; c.tz = s[2]; c.th = s[3]; c.ts = s[4]; c.tsteer = s[5];
          c.prog = s[6];
          c.finished = s[7] < 0 ? null : s[7];
          c.tt = now;
        }
      };
    this.initMini();
    this.addInput();
    this.resize();
    this.warmUp();
    addEventListener('resize', this.resize);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  onMute: ((m: boolean) => void) | null = null;
  setMuted(m: boolean) {
    this.engine.muted = m;
    this.onMute?.(m);
  }

  // Rozgrzewka przed startem: kompilujemy shadery i wysyłamy do karty graficznej całą geometrię i tekstury.
  // Bez tego każdy budynek czy szyld ładuje się dopiero, gdy pierwszy raz pojawi się w kadrze, a to daje przycięcia.
  private warmUp() {
    const off: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        off.push(o);
      }
    });
    const cam = this.views[0].cam;
    const k = this.views[0].kart;
    cam.position.set(k.x, 40, k.z + 1);
    cam.lookAt(k.x, 0, k.z);
    cam.updateMatrixWorld();
    try {
      this.renderer.compile(this.scene, cam);
      this.renderer.setRenderTarget(this.mirrorRT);
      this.renderer.render(this.scene, cam);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.hudScene, this.hudCam);
    } catch (e) {
      console.warn('warm-up', e);
    }
    for (const o of off) o.frustumCulled = true;
  }

  // Poziom „Początkujący": lekkie dociąganie kierownicy w stronę środka jezdni kilkanaście metrów przed kartem.
  // Im mocniej gracz sam skręca, tym słabsza pomoc.
  private assistInput(c: Kart, inp: Input): Input {
    if (c.speed < 2) return inp;
    const tr = this.track;
    let ti = c.idx + Math.round((8 + c.speed * 0.6) / SP);
    ti = tr.closed ? ((ti % tr.N) + tr.N) % tr.N : Math.min(tr.N - 1, ti);
    const mid = (tr.wp[ti] - tr.wm[ti]) / 2; // środek między bandami (także w szykanie)
    const tx = tr.pts[ti][0] + tr.nor[ti][0] * mid, tz = tr.pts[ti][1] + tr.nor[ti][1] * mid;
    let dlt = Math.atan2(-(tx - c.x), -(tz - c.z)) - c.h;
    dlt = Math.atan2(Math.sin(dlt), Math.cos(dlt));
    const auto = Math.max(-1, Math.min(1, dlt * 1.7));
    const w = 0.45 * (1 - 0.5 * Math.abs(inp.st));
    return { ...inp, st: Math.max(-1, Math.min(1, inp.st + auto * w)) };
  }

  // host daje sygnał: wszyscy gotowi, ruszamy odliczanie
  go() {
    this.hold = false;
    this.raceT = -3.5;
  }

  resize = () => {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.hudCam.right = w;
    this.hudCam.top = h;
    this.hudCam.updateProjectionMatrix();
    const mw = Math.min(w * 0.36, 440), mh = mw / 3.4;
    this.mirrorMesh.scale.set(-mw, mh, 1); // ujemna skala = odbicie lustrzane
    this.mirrorMesh.position.set(w / 2, h - 10 - mh / 2, 0);
    this.mirrorFrame.scale.set(mw + 8, mh + 8, 1);
    this.mirrorFrame.position.set(w / 2, h - 10 - mh / 2, -0.5);
  };

  private kd = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    this.engine.start();
    if (e.code === 'KeyM') this.setMuted(!this.engine.muted);
    if (e.code === 'KeyR' && this.raceT > 0) for (const k of this.karts) if (k.ctrl === 'key' && k.finished === null) this.respawn(k);
    if (e.code === 'Space') e.preventDefault();
  };
  private ku = (e: KeyboardEvent) => this.keys.delete(e.code);
  private ts = () => this.engine.start();

  addInput() {
    addEventListener('keydown', this.kd);
    addEventListener('keyup', this.ku);
    this.canvas.addEventListener('touchstart', this.ts);
    this.canvas.addEventListener('touchmove', this.ts);
    this.canvas.addEventListener('touchend', this.ts);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('keydown', this.kd);
    removeEventListener('keyup', this.ku);
    removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('touchstart', this.ts);
    this.canvas.removeEventListener('touchmove', this.ts);
    this.canvas.removeEventListener('touchend', this.ts);
    if (this.net) this.net.onState = null;
    this.engine.stop();
    this.mirrorRT.dispose();
    this.renderer.dispose();
    this.viewsEl.innerHTML = '';
  }

  frame = (now: number) => {
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.05, raw);
    this.last = now;
    this.dt = dt;
    this.frameNo++;
    // średni czas klatki z ~1,5 s; powyżej 22 ms (poniżej ~45 fps) zdejmujemy po jednym stopniu jakości
    if (raw < 0.25) {
      this.slowAcc += raw;
      this.slowN++;
      if (this.slowN >= 90) {
        const avg = this.slowAcc / this.slowN;
        this.slowAcc = this.slowN = 0;
        if (avg > 0.022) {
          if (this.mirrorOn) this.mirrorOn = false;
          else if (this.pr > 0.8) {
            this.pr = Math.max(0.75, this.pr - 0.25);
            this.renderer.setPixelRatio(this.pr);
            this.resize();
          }
        }
      }
    }
    const c0 = performance.now();
    if (!this.paused) this.step(dt);
    this.draw();
    if (!this.paused && this.raceT > 0 && raw < 1) {
      const own = performance.now() - c0;
      this.hitch.frames++;
      if (raw > 0.05) {
        this.hitch.n++;
        if (own > 25) this.hitch.own++;
        this.hitch.worst = Math.max(this.hitch.worst, Math.round(raw * 1000));
      }
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private respawn(c: Kart) {
    const tr = this.track;
    const p = tr.pts[c.idx], t = tr.tan[c.idx];
    c.x = p[0];
    c.z = p[1];
    c.h = Math.atan2(-t[0], -t[1]);
    c.vx = c.vz = c.speed = c.slip = 0;
    c.stuck = 0;
  }

  private keyInput(): Input {
    const k = this.keys;
    const tc = this.touchCtl;
    const ks = (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0);
    const inp: Input = {
      thr: k.has('ArrowUp') || k.has('KeyW') ? 1 : tc.thr,
      brk: k.has('ArrowDown') || k.has('KeyS') ? 1 : tc.brk,
      st: ks !== 0 ? ks : tc.st,
      hb: k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight') || tc.hb,
    };
    const gp = navigator.getGamepads?.()[0];
    if (gp) {
      if (Math.abs(gp.axes[0]) > 0.15) inp.st = -gp.axes[0];
      if (gp.buttons[7]?.pressed || gp.buttons[0]?.pressed) inp.thr = 1;
      if (gp.buttons[6]?.pressed || gp.buttons[1]?.pressed) inp.brk = 1;
      if (gp.buttons[2]?.pressed || gp.buttons[5]?.pressed) inp.hb = true;
    }
    this.lastThr = inp.thr;
    return inp;
  }

  private step(dt: number) {
    if (this.hold) this.raceT = -3.6;
    else this.raceT += dt;
    const go = this.raceT >= 0;
    const tr = this.track;
    const now = performance.now();
    for (const c of this.karts) {
      if (c.ctrl === 'remote') {
        // wygładzanie: gonimy pozycję przewidzianą z ostatniego znanego stanu
        const age = Math.min(0.3, (now - c.tt) / 1000);
        const px = c.tx - Math.sin(c.th) * c.ts * age, pz = c.tz - Math.cos(c.th) * c.ts * age;
        const f = Math.min(1, dt * 10);
        c.x += (px - c.x) * f;
        c.z += (pz - c.z) * f;
        let dh = c.th - c.h;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        c.h += dh * f;
        c.speed = c.ts;
        c.steer = c.tsteer;
        c.vx = -Math.sin(c.h) * c.speed;
        c.vz = -Math.cos(c.h) * c.speed;
        c.obj.position.set(c.x, c.y, c.z);
        c.obj.rotation.y = c.h;
        steerKart(c.obj, c.steer, (c.speed * dt) / 0.38);
        continue;
      }
      // cień aerodynamiczny: tuż za innym kartem opór spada i można przekroczyć zwykłą prędkość maksymalną
      {
        let behind = false;
        if (go && c.speed > 12 && (c.ctrl !== 'bot' || this.level > 0)) {
          const fx = -Math.sin(c.h), fz = -Math.cos(c.h);
          for (const o of this.karts) {
            if (o === c || o.speed < 10 || Math.abs(o.y - c.y) > 2) continue;
            const dx = o.x - c.x, dz = o.z - c.z;
            const fd = dx * fx + dz * fz;
            if (fd < 2.5 || fd > 26) continue;
            if (Math.abs(dx * fz - dz * fx) < 1.7 + fd * 0.05) behind = true;
          }
        }
        c.draft = Math.max(0, Math.min(1, c.draft + (behind ? dt / 0.9 : -dt / 1.3)));
      }
      let inp: Input = NO_INPUT;
      if (go) {
        if (c.ctrl === 'bot') inp = this.botInput(c);
        else if (c.finished !== null) inp = { thr: 0, brk: 1, st: 0, hb: false };
        else if (c.ctrl === 'key') inp = this.keyInput();
        else if (c.ctrl === 'pad') inp = this.net?.padInputs.get(c.padId!) ?? NO_INPUT;
        if (this.assist && c.finished === null && (c.ctrl === 'key' || c.ctrl === 'pad')) inp = this.assistInput(c, inp);
      }
      this.drive(c, dt, inp);
      if (go && c.finished === null && inp.thr && Math.abs(c.speed) < 1.5) c.stuck += dt;
      else c.stuck = 0;
      if (c.stuck > (c.ctrl === 'bot' ? 2 : 3.5)) this.respawn(c);
    }
    // zderzenia: kart zdalny traktujemy jak nieruchomą przeszkodę (jego właściciel liczy swoją stronę)
    for (let a = 0; a < this.karts.length; a++)
      for (let b = a + 1; b < this.karts.length; b++) {
        const A = this.karts[a], B = this.karts[b];
        const ra = A.ctrl === 'remote', rb = B.ctrl === 'remote';
        if (ra && rb) continue;
        if (Math.abs(A.y - B.y) > 2) continue; // jeden na wiadukcie, drugi pod nim
        const dx = B.x - A.x, dz = B.z - A.z;
        const d = Math.hypot(dx, dz);
        if (d >= 2.0 || d < 0.001) continue;
        const nx = dx / d, nz = dz / d, o = 2.0 - d;
        const wa = ra ? 0 : rb ? 1 : 0.5, wb = rb ? 0 : ra ? 1 : 0.5;
        A.x -= nx * o * wa; A.z -= nz * o * wa;
        B.x += nx * o * wb; B.z += nz * o * wb;
        const rel = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
        if (rel < 0) {
          const j = rel * 0.8;
          if (!ra) { A.vx += nx * j * wa * 2; A.vz += nz * j * wa * 2; }
          if (!rb) { B.vx -= nx * j * wb * 2; B.vz -= nz * j * wb * 2; }
        }
      }
    // postęp
    for (const c of this.karts) {
      const ni = nearestNear(tr, c.x, c.z, c.idx);
      if (c.ctrl !== 'remote') {
        if (tr.closed) {
          let d = ni - c.idx;
          if (d > tr.N / 2) d -= tr.N;
          if (d < -tr.N / 2) d += tr.N;
          c.prog += d;
          if (c.finished === null && c.prog >= tr.N * tr.laps) c.finished = this.raceT;
        } else {
          c.prog = ni - tr.startIdx;
          if (c.finished === null && ni >= tr.finishIdx) c.finished = this.raceT;
        }
      }
      c.lap = tr.closed ? Math.max(0, Math.floor(c.prog / tr.N)) + 1 : 1;
      c.idx = ni;
      const t = tr.tan[ni];
      const along = -Math.sin(c.h) * t[0] - Math.cos(c.h) * t[1];
      // wysokość z profilu trasy (wiadukty), interpolowana między próbkami
      {
        const wrap = (q: number) => (tr.closed ? ((q % tr.N) + tr.N) % tr.N : Math.max(0, Math.min(tr.N - 1, q)));
        const lon = (c.x - tr.pts[ni][0]) * t[0] + (c.z - tr.pts[ni][1]) * t[1];
        const nb = wrap(ni + (lon >= 0 ? 1 : -1));
        const n2 = tr.nor[ni];
        const lat = (c.x - tr.pts[ni][0]) * n2[0] + (c.z - tr.pts[ni][1]) * n2[1];
        const y0 = surfY(tr, ni, lat);
        const yy = y0 + (surfY(tr, nb, lat) - y0) * Math.min(1, Math.abs(lon) / SP);
        c.y += (yy - c.y) * Math.min(1, dt * 14);
        const slope = (tr.y[wrap(ni + 1)] - tr.y[wrap(ni - 1)]) / (2 * SP);
        // tarka: delikatne drgania, gdy zewnętrzne koła wjadą na pobocze
        c.kerb = Math.abs(c.speed) > 4 && (lat > tr.wp[ni] - kerbW(tr.wp[ni]) - 0.7 || lat < -(tr.wm[ni] - kerbW(tr.wm[ni]) - 0.7));
        const ph = now * 0.001 * (30 + Math.abs(c.speed) * 2.2) + c.kid;
        c.obj.position.y = c.y + (c.kerb ? Math.sin(ph) * 0.03 : 0);
        c.obj.rotation.x = Math.atan(slope) * along + (c.kerb ? Math.sin(ph * 1.7) * 0.012 : 0);
        c.obj.rotation.z = c.lean - Math.atan(tr.bank[ni]) * along + (c.kerb ? Math.sin(ph * 1.3) * 0.02 : 0); // poślizg + profil zakrętu + tarka
      }
      c.wrong = along < -0.4 && c.speed > 3 ? c.wrong + dt : 0;
    }
    // sieć
    if (this.net) {
      this.netAcc += dt;
      if (this.netAcc > 0.06) {
        this.netAcc = 0;
        const r = (v: number) => Math.round(v * 100) / 100;
        const a = this.karts.filter((c) => c.ctrl !== 'remote').map((c) => [c.kid, r(c.x), r(c.z), r(c.h), r(c.speed), r(c.steer), r(c.prog), c.finished === null ? -1 : r(c.finished)]);
        if (a.length) this.net.sendState(a);
      }
      this.padAcc += dt;
      if (this.padAcc > 0.4) {
        this.padAcc = 0;
        const s = this.sorted();
        for (const c of this.karts)
          if (c.ctrl === 'pad') this.net.sendPad(c.padId!, { place: s.indexOf(c) + 1, total: this.karts.length, lap: Math.min(tr.laps, c.lap), laps: tr.closed ? tr.laps : 0, speed: Math.round(Math.abs(c.speed) * 3.6), fin: c.finished !== null, cd: this.hold ? -9 : this.raceT });
      }
    }
    if (!this.over && this.views.every((v) => v.kart.finished !== null)) {
      this.over = true;
      setTimeout(() => {
        const sorted = this.sorted();
        const mine = this.views.map((v) => v.kart);
        const best = mine.reduce((a, b) => (sorted.indexOf(a) < sorted.indexOf(b) ? a : b));
        this.onDone({
          place: sorted.indexOf(best) + 1, total: this.karts.length, time: best.finished!,
          standings: sorted.map((c) => ({ name: c.name, time: c.finished, bot: !!c.isBot, me: mine.includes(c) })),
        });
      }, 1500);
    }
  }

  sorted() {
    return [...this.karts].sort((a, b) => {
      if (a.finished !== null && b.finished !== null) return a.finished - b.finished;
      if (a.finished !== null) return -1;
      if (b.finished !== null) return 1;
      return b.prog - a.prog;
    });
  }

  private humanProg(): number {
    let m = -1e9;
    for (const k of this.karts) if (!k.isBot && k.finished === null) m = Math.max(m, k.prog);
    return m;
  }

  private botInput(c: Kart): Input {
    const tr = this.track;
    const ahead = Math.round((7 + c.speed * 0.55) / SP);
    let ti = c.idx + ahead;
    if (tr.closed) ti = ((ti % tr.N) + tr.N) % tr.N;
    else ti = Math.min(tr.N - 1, ti);
    // lekko pływający tor jazdy, żeby boty nie jechały gęsiego
    const lane = Math.max(-(tr.wm[ti] - 1.6), Math.min(tr.wp[ti] - 1.6, c.lane + Math.sin(this.raceT * 0.35 + c.grip * 7) * 1.3));
    const tx = tr.pts[ti][0] + tr.nor[ti][0] * lane;
    const tz = tr.pts[ti][1] + tr.nor[ti][1] * lane;
    const want = Math.atan2(-(tx - c.x), -(tz - c.z));
    let d = want - c.h;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const st = Math.max(-1, Math.min(1, d * 2.2));
    const boost = 1 + 0.16 * c.draft;
    let tv = c.maxSpeed * boost;
    // gumka: boty daleko przed ludźmi odpuszczają, daleko z tyłu cisną
    const hp = this.humanProg();
    if (hp > -1e8) {
      const gap = (c.prog - hp) * SP;
      tv *= gap > 60 ? this.diff.back : gap < -60 ? this.diff.push : 1;
    }
    tv = Math.min(tv, this.diff.top * boost);
    for (let o = 0; o < 18; o += 2) {
      let i = c.idx + o;
      i = tr.closed ? ((i % tr.N) + tr.N) % tr.N : Math.min(tr.N - 1, i);
      tv = Math.min(tv, Math.sqrt(c.grip / Math.max(tr.curv[i], 0.002)));
    }
    if (c.finished !== null) tv = 7;
    return { thr: c.speed < tv ? 1 : 0, brk: c.speed > tv + 3 ? 1 : 0, st, hb: false };
  }

  private drive(c: Kart, dt: number, inp: Input) {
    const tr = this.track;
    const fx = -Math.sin(c.h), fz = -Math.cos(c.h);
    const rx = Math.cos(c.h), rz = -Math.sin(c.h);
    let vf = c.vx * fx + c.vz * fz;
    let vl = c.vx * rx + c.vz * rz;
    // stałe dobrane tak, żeby prędkość maksymalna wychodziła ~MAX_SPEED (19 = v*(19/46 + 0.2) → v≈31)
    if (inp.thr) vf += 19 * inp.thr * dt * (1 - Math.max(0, vf) / 46);
    if (inp.brk) vf -= (vf > 0 ? 38 : 12) * dt;
    vf -= vf * (inp.hb ? 0.9 : 0.2 * (1 - 0.45 * c.draft)) * dt;
    if (!inp.thr && !inp.brk && Math.abs(vf) < 0.3) vf = 0;
    vf = Math.max(-8, Math.min((c.ctrl === 'bot' ? this.diff.top : MAX_SPEED) * (1 + 0.16 * c.draft), vf));
    const bankF = Math.abs(tr.bank[c.idx]) / 0.2; // profilowany zakręt trzyma kart mocniej
    // przyczepność boczna: hamulec ręczny ją zrywa (poślizg)
    vl -= vl * Math.min(1, (inp.hb ? 1.6 : 8.5 * (1 + bankF)) * dt);
    const st = Math.max(-1, Math.min(1, inp.st));
    c.steer += (st - c.steer) * Math.min(1, dt * 9);
    const sp = Math.abs(vf);
    const turn = (c.steer * (inp.hb ? 2.9 : 2.15) * Math.min(1, sp / 7) * (vf >= 0 ? 1 : -1) * (1 + 0.45 * bankF)) / (1 + sp / 38);
    c.vx = fx * vf + rx * vl;
    c.vz = fz * vf + rz * vl;
    c.h += turn * dt;
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    // banda: odbicie od ściany korytarza
    const i = nearestNear(tr, c.x, c.z, c.idx);
    const p = tr.pts[i], n = tr.nor[i], t = tr.tan[i];
    const lat = (c.x - p[0]) * n[0] + (c.z - p[1]) * n[1];
    // korytarz jazdy [lo, hi] względem osi; w szykanie zapora sięga za oś, więc granica może mieć odwrotny znak
    let lo = -(tr.wm[i] - 0.9), hi = tr.wp[i] - 0.9;
    if (hi - lo < 0.8) {
      const mid = (lo + hi) / 2;
      lo = mid - 0.4;
      hi = mid + 0.4;
    }
    if (lat > hi || lat < lo) {
      const s = lat > hi ? 1 : -1;
      const over = lat - (s > 0 ? hi : lo);
      c.x -= n[0] * over;
      c.z -= n[1] * over;
      // szorowanie po skośnej zaporze kosztuje prędkość
      const scrape = 1 - Math.min(0.2, Math.abs(over) * 0.15);
      c.vx *= scrape;
      c.vz *= scrape;
      const vn = (c.vx * n[0] + c.vz * n[1]) * s; // >0: w stronę ściany
      if (vn > 0) {
        c.vx -= n[0] * s * vn * 1.25;
        c.vz -= n[1] * s * vn * 1.25;
        const loss = Math.min(0.5, vn * 0.03);
        c.vx *= 1 - loss;
        c.vz *= 1 - loss;
      }
      const f = [-Math.sin(c.h), -Math.cos(c.h)];
      const flip = f[0] * t[0] + f[1] * t[1] < 0 ? -1 : 1;
      let d = Math.atan2(-t[0] * flip, -t[1] * flip) - c.h;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.h += d * Math.min(1, 3 * dt);
    }
    c.speed = c.vx * -Math.sin(c.h) + c.vz * -Math.cos(c.h);
    c.slip = c.vx * Math.cos(c.h) - c.vz * Math.sin(c.h);
    // poślizg: boczny uślizg, hamulec ręczny w ruchu albo ostre hamowanie
    const skid = Math.max(Math.min(1, (Math.abs(c.slip) - 2.6) / 5), inp.hb && sp > 6 ? 0.8 : 0, inp.brk && c.speed > 13 ? 0.5 : 0);
    c.skid += (Math.max(0, skid) - c.skid) * Math.min(1, dt * 12);
    if (c.skid > 0.15) {
      c.smokeAcc += dt * 34 * c.skid;
      while (c.smokeAcc >= 1) {
        c.smokeAcc -= 1;
        const side = Math.random() < 0.5 ? -0.9 : 0.9;
        this.smoke.emit(c.x - fx * 0.95 + rx * side, c.y + 0.25, c.z - fz * 0.95 + rz * side);
      }
    }
    c.obj.position.set(c.x, c.y, c.z);
    c.obj.rotation.y = c.h;
    c.lean = Math.max(-0.12, Math.min(0.12, -c.slip * 0.02)); // przechył w poślizgu
    steerKart(c.obj, c.steer, (c.speed * dt) / 0.38);
  }

  private initMini() {
    const cv = document.getElementById('mini') as HTMLCanvasElement | null;
    if (!cv) return;
    this.mini = cv.getContext('2d');
    let x0 = 1e18, x1 = -1e18, z0 = 1e18, z1 = -1e18;
    for (const p of this.track.pts) {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
    }
    const s = (cv.width - 20) / Math.max(x1 - x0, z1 - z0, 1);
    this.miniBox = { x: (x0 + x1) / 2 - cv.width / 2 / s, z: (z0 + z1) / 2 - cv.height / 2 / s, s };
    const bg = document.createElement('canvas');
    bg.width = cv.width;
    bg.height = cv.height;
    const m = bg.getContext('2d')!;
    const { x, z } = this.miniBox;
    const tr = this.track;
    m.lineJoin = 'round';
    for (const [w, col] of [[7, '#000a'], [4, '#fff']] as [number, string][]) {
      m.beginPath();
      tr.pts.forEach((p, i) => (i ? m.lineTo((p[0] - x) * s, (p[1] - z) * s) : m.moveTo((p[0] - x) * s, (p[1] - z) * s)));
      if (tr.closed) m.closePath();
      m.lineWidth = w;
      m.strokeStyle = col;
      m.stroke();
    }
    this.miniBg = bg;
  }

  private drawMini() {
    const m = this.mini;
    if (!m) return;
    const { x, z, s } = this.miniBox;
    const tr = this.track;
    m.clearRect(0, 0, m.canvas.width, m.canvas.height);
    if (this.miniBg) m.drawImage(this.miniBg, 0, 0);
    const mine = this.views.map((v) => v.kart);
    for (const c of [...this.karts].reverse()) {
      const me = mine.includes(c);
      m.beginPath();
      m.arc((c.x - x) * s, (c.z - z) * s, me ? 6 : 4.5, 0, 7);
      m.fillStyle = me && mine.length === 1 ? '#ff5a1f' : c.color;
      m.fill();
      m.lineWidth = me ? 2.5 : 1.5;
      m.strokeStyle = '#fff';
      m.stroke();
    }
  }

  private draw() {
    const W = innerWidth, H = innerHeight;
    const r = this.renderer;
    if (this.frameNo % 2 === 0) this.worldUpdate?.(performance.now() / 1000); // kibice i balony co drugą klatkę
    this.smoke.update(this.dt);
    const single = this.views.length === 1;
    if (single && this.mirrorOn && this.frameNo % 2 === 0) {
      // lusterko (co drugą klatkę): kamera nad kierowcą patrzy do tyłu, własny kart ukryty
      const p = this.views[0].kart;
      const mc = this.mirrorCam;
      mc.position.set(p.x, 1.7 + p.y, p.z);
      mc.lookAt(p.x + Math.sin(p.h) * 20, 1.2 + p.y, p.z + Math.cos(p.h) * 20);
      p.obj.visible = false;
      r.setRenderTarget(this.mirrorRT);
      r.render(this.scene, mc);
      r.setRenderTarget(null);
      p.obj.visible = true;
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    r.clear();
    r.setScissorTest(true);
    const sorted = this.sorted();
    const tr = this.track;
    for (const v of this.views) {
      const p = v.kart;
      let dh = p.h - v.camH;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      v.camH += dh * (1 - Math.exp(-this.dt * 7.5)); // wygładzanie zależne od czasu, nie od liczby klatek
      const back = 7.2 + Math.max(0, p.speed) * 0.04;
      const target = this.tmpV.set(p.x + Math.sin(v.camH) * back, 3.3 + p.y + p.speed * 0.012, p.z + Math.cos(v.camH) * back);
      v.camPos.lerp(target, v.first ? 1 : 1 - Math.exp(-this.dt * 13));
      v.first = false;
      v.cam.position.copy(v.camPos);
      if (p.kerb) {
        v.cam.position.y += Math.sin(performance.now() * 0.09) * 0.03;
        if (this.frameNo % 12 === 0 && this.views.length === 1) if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(20);
      }
      v.cam.lookAt(p.x - Math.sin(v.camH) * 6, 1.5 + p.y, p.z - Math.cos(v.camH) * 6);
      v.cam.fov = 66 + (Math.max(0, p.speed) / MAX_SPEED) * 14;
      const vw = v.rect[2] * W, vh = v.rect[3] * H;
      v.cam.aspect = vw / vh;
      v.cam.updateProjectionMatrix();
      const vx = v.rect[0] * W, vy = (1 - v.rect[1] - v.rect[3]) * H;
      r.setViewport(vx, vy, vw, vh);
      r.setScissor(vx, vy, vw, vh);
      r.render(this.scene, v.cam);

      const h = v.el;
      setText(h.speed, String(Math.round(Math.abs(p.speed) * 3.6)));
      setText(h.pos, `${sorted.indexOf(p) + 1}/${this.karts.length}`);
      setText(h.lap, tr.closed ? `Okr. ${Math.min(tr.laps, p.lap)}/${tr.laps}` : `${Math.max(0, Math.min(100, Math.round((p.prog / (tr.finishIdx - tr.startIdx)) * 100)))}%`);
      const rt = Math.max(0, p.finished ?? this.raceT);
      setText(h.time, `${Math.floor(rt / 60)}:${(rt % 60).toFixed(1).padStart(4, '0')}`);
      setText(h.count, this.hold ? 'Czekam na graczy…' : this.raceT < -3 ? '' : this.raceT < -0.1 ? String(Math.ceil(-this.raceT)) : this.raceT < 0.8 ? 'JEDŹ!' : p.finished !== null ? 'META!' : '');
      h.count.classList.toggle('small', this.hold);
      setStyle(h.count, this.raceT < 0.8 || p.finished !== null ? '1' : '0');
      setStyle(h.warn, p.wrong > 1 && p.finished === null ? '1' : '0');
      setStyle(h.draft, p.draft > 0.35 ? '1' : '0');
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    if (single && this.mirrorOn) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.hudScene, this.hudCam);
      r.autoClear = true;
    }
    if (this.frameNo % 3 === 0) this.drawMini();
    const p0 = this.views[0].kart;
    this.engine.update(p0, this.karts, p0.finished === null && p0.ctrl === 'key' ? this.lastThr : 0.4, this.dt);
  }
}
