import QRCode from 'qrcode';
import { DRIVERS, DriverId, renderThumbnails, exportAllGlb } from './karts';
import { MapDraw, Drawn } from './mapdraw';
import { geocode } from './osm';
import { fetchCity } from './tiles';
import { buildTrack } from './track';
import { Game, Input, KartSpec, NetLink, Result } from './game';
import { Net, PlayerInfo } from './net';
import { mountControls, goLandscape } from './controls';

const $ = (id: string) => document.getElementById(id)!;
const SCREENS = ['menu', 'mapscr', 'lobby', 'join', 'wait', 'loading', 'gamescr', 'pad'];
function show(id: string) {
  SCREENS.forEach((s) => $(s).classList.toggle('hidden', s !== id));
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const dname = (id?: string) => DRIVERS.find((d) => d.id === id)?.name ?? 'Gracz';
const dcolor = (id?: string) => DRIVERS.find((d) => d.id === id)?.color ?? '#4a3b2c';

// wpis w składzie wyścigu, rozsyłany przez hosta
interface RosterEntry {
  kid: number;
  driver: DriverId;
  name: string;
  owner: string; // id klienta, który symuluje ten kart
  padId?: string;
  bot?: boolean;
  slot: number;
}
const newSeed = () => 1 + Math.floor(Math.random() * 1e6);
interface StartMsg {
  seed?: number; // ziarno losowań wyścigu (tunel czy wiadukt), wspólne dla wszystkich graczy
  k: 'start';
  track: { nodes: { lat: number; lon: number }[]; closed: boolean; laps: number; els?: any[] };
  roster: RosterEntry[];
}

let driver: DriverId = 'gryzek';
let md: MapDraw | null = null;
let drawn: Drawn | null = null;
let laps = 3;
let game: Game | null = null;
let net: Net | null = null;
let link: NetLink | null = null;
let lastStart: StartMsg | null = null;
let lobbyTimer = 0;
let readySet = new Set<string>();
let goTimer = 0;

// --- menu
const thumbs = renderThumbnails();
function driverCards(box: HTMLElement, onPick: (id: DriverId, el: HTMLElement) => void) {
  for (const d of DRIVERS) {
    const c = document.createElement('div');
    c.className = 'card';
    c.style.setProperty('--c', d.color);
    c.innerHTML = `<img src="${thumbs[d.id]}" alt="${d.name}"><b>${d.name}</b><span>${d.tagline}</span>`;
    c.onclick = () => onPick(d.id, c);
    box.appendChild(c);
  }
}
const savedDriver = localStorage.getItem('jechac.driver');
if (DRIVERS.some((d) => d.id === savedDriver)) driver = savedDriver as DriverId;
const markDriver = () => $('cards').querySelectorAll('.card').forEach((c, i) => c.classList.toggle('sel', DRIVERS[i].id === driver));
driverCards($('cards'), (id) => {
  driver = id;
  try {
    localStorage.setItem('jechac.driver', id);
  } catch {
    /* tryb prywatny */
  }
  markDriver();
});
markDriver();
$('newtrk').onclick = () => openMap();

// --- poziom trudności botów (0 łatwy, 1 średni, 2 trudny)
let difficulty = Math.max(0, Math.min(2, +(localStorage.getItem('jechac.diff') ?? 0) || 0));
const markDiff = () => document.querySelectorAll<HTMLElement>('#diff button').forEach((b) => b.classList.toggle('on', +b.dataset.d! === difficulty));
document.querySelectorAll<HTMLElement>('#diff button').forEach((b) => {
  b.onclick = () => {
    difficulty = +b.dataset.d!;
    try {
      localStorage.setItem('jechac.diff', String(difficulty));
    } catch {
      /* tryb prywatny */
    }
    markDiff();
  };
});
markDiff();

// --- zapisane trasy: ulubione + 3 ostatnie (localStorage)
interface Saved {
  id: string;
  name: string;
  nodes: { lat: number; lon: number }[];
  closed: boolean;
  laps: number;
  lengthM: number;
  fav: boolean;
  ts: number;
}
let lastQuery = '';
function loadTracks(): Saved[] {
  try {
    return JSON.parse(localStorage.getItem('jechac.tracks') ?? '[]');
  } catch {
    return [];
  }
}
function storeTracks(list: Saved[]) {
  list.sort((a, b) => b.ts - a.ts);
  let recent = 0;
  const keep = list.filter((t) => t.fav || recent++ < 3);
  try {
    localStorage.setItem('jechac.tracks', JSON.stringify(keep));
  } catch {
    /* brak miejsca lub tryb prywatny */
  }
}
function rememberTrack() {
  if (!drawn || (drawn as any).els) return; // demo nie zapisujemy
  const a = drawn.nodes[0], b = drawn.nodes[drawn.nodes.length - 1];
  const id = [a.lat.toFixed(5), a.lon.toFixed(5), b.lat.toFixed(5), b.lon.toFixed(5), drawn.nodes.length].join('_');
  const list = loadTracks();
  const old = list.find((t) => t.id === id);
  const name = (drawn as any).name || old?.name || lastQuery || 'Trasa';
  const rest = list.filter((t) => t.id !== id);
  rest.push({ id, name, nodes: drawn.nodes, closed: drawn.closed, laps, lengthM: drawn.lengthM, fav: old?.fav ?? false, ts: Date.now() });
  storeTracks(rest);
}
function renderTracks() {
  const list = loadTracks().sort((a, b) => Number(b.fav) - Number(a.fav) || b.ts - a.ts);
  const box = $('tracks');
  box.innerHTML = list.length ? '<h3>Twoje trasy</h3>' : '';
  for (const t of list) {
    const row = document.createElement('div');
    row.className = 'trk';
    const km = (t.lengthM / 1000).toFixed(2).replace('.', ',');
    const desc = t.closed ? 'Pętla ' + km + ' km · ' + t.laps + ' okr.' : 'Sprint ' + km + ' km';
    row.innerHTML =
      '<button class="star' + (t.fav ? ' on' : '') + '" title="Ulubiona">' + (t.fav ? '★' : '☆') + '</button>' +
      '<div class="tinfo"><b>' + esc(t.name) + '</b><small>' + desc + '</small></div>' +
      '<button class="tsolo">Solo</button><button class="tinv alt">Zaproś</button><button class="tdel ghost" title="Usuń">✕</button>';
    const pick = () => {
      drawn = { nodes: t.nodes, closed: t.closed, lengthM: t.lengthM } as Drawn;
      (drawn as any).name = t.name;
      laps = t.laps;
    };
    (row.querySelector('.star') as HTMLElement).onclick = () => {
      const l = loadTracks();
      const x = l.find((q) => q.id === t.id);
      if (x) x.fav = !x.fav;
      storeTracks(l);
      renderTracks();
    };
    (row.querySelector('.tdel') as HTMLElement).onclick = () => {
      storeTracks(loadTracks().filter((q) => q.id !== t.id));
      renderTracks();
    };
    (row.querySelector('.tsolo') as HTMLElement).onclick = () => {
      pick();
      $('go').click();
    };
    (row.querySelector('.tinv') as HTMLElement).onclick = () => {
      pick();
      $('invite').click();
    };
    box.appendChild(row);
  }
}
renderTracks();
// powrót do ekranu wyboru: mapa, jeśli trasa była właśnie rysowana, inaczej menu
function backToSetup(msg = '') {
  if (md && drawn && !(drawn as any).name) {
    show('mapscr');
    md.map.resize();
    if (msg) $('status').textContent = msg;
  } else {
    renderTracks();
    show('menu');
    $('mstatus').textContent = msg;
  }
}
$('glb').onclick = () => exportAllGlb();
$('joinrow').onsubmit = (e) => {
  e.preventDefault();
  openJoin(($('jcode0') as HTMLInputElement).value);
};

// --- mapa
function openMap() {
  show('mapscr');
  if (!md) {
    md = new MapDraw('map', (s) => ($('status').textContent = s), (d) => {
      drawn = d;
      $('confirm').classList.remove('hidden');
      const km = (d.lengthM / 1000).toFixed(2);
      $('ctitle').textContent = d.closed ? `Pętla, ${km} km` : `Sprint, ${km} km`;
      $('laprow').classList.toggle('hidden', !d.closed);
      if (d.closed) setLaps(laps);
    }, () => {
      // "Koniec trasy" tylko w trakcie rysowania, gdy jest już co kończyć
      $('finish').classList.toggle('hidden', !(md && md.phase === 'drawing' && md.path.length > 1));
    });
  } else md.map.resize();
  (window as any).__md = md;
}
function setLaps(n: number) {
  laps = n;
  const box = $('laps');
  box.innerHTML = '';
  for (const v of [1, 2, 3, 5, 8]) {
    const b = document.createElement('button');
    b.textContent = String(v);
    if (v === n) b.className = 'on';
    b.onclick = () => setLaps(v);
    box.appendChild(b);
  }
}
$('addr').onsubmit = async (e) => {
  e.preventDefault();
  const q = ($('q') as HTMLInputElement).value.trim();
  if (!q || !md) return;
  lastQuery = q;
  $('status').textContent = 'Szukam adresu…';
  try {
    const r = await geocode(q);
    if (!r) return void ($('status').textContent = 'Nie znaleziono adresu.');
    $('confirm').classList.add('hidden');
    md.goto(r.lat, r.lon);
  } catch {
    $('status').textContent = 'Błąd wyszukiwania adresu.';
  }
};
$('finish').onclick = () => md?.finish();
$('undo').onclick = () => {
  $('confirm').classList.add('hidden');
  md?.undo();
};
$('reset').onclick = $('redraw').onclick = () => {
  $('confirm').classList.add('hidden');
  md?.reset();
};
$('back').onclick = () => {
  renderTracks();
  show('menu');
};
addEventListener('keydown', (e) => {
  if (!$('mapscr').classList.contains('hidden') && document.activeElement?.tagName !== 'INPUT') {
    if (e.key === 'Backspace') $('undo').click();
    if (e.key === 'Escape') $('reset').click();
  }
});

// --- skład i start
function trackMsg() {
  return { nodes: drawn!.nodes, closed: drawn!.closed, laps: drawn!.closed ? laps : 1, els: (drawn as any).els };
}

function makeRoster(players: PlayerInfo[], me: string): RosterEntry[] {
  const humans: Omit<RosterEntry, 'kid' | 'slot'>[] = [];
  let pads = 0;
  for (const p of players) {
    const d = (p.driver as DriverId) ?? 'gryzek';
    if (p.id === me) humans.push({ driver: d, name: p.name || dname(d), owner: me });
    else if (p.mode === 'pad') {
      // na jednym ekranie mieszczą się 4 widoki: host + 3 kontrolery
      if (pads++ < 3) humans.push({ driver: d, name: p.name || dname(d), owner: me, padId: p.id });
    } else humans.push({ driver: d, name: p.name || dname(d), owner: p.id });
  }
  const used = new Set(humans.map((h) => h.driver));
  // boty losują kierowców spośród tych, których nie wzięli ludzie
  const free = DRIVERS.map((d) => d.id).filter((d) => !used.has(d));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const bots: Omit<RosterEntry, 'kid' | 'slot'>[] = [];
  for (let i = 0; humans.length + bots.length < 4; i++) {
    const d = free[i] ?? DRIVERS[i % DRIVERS.length].id;
    bots.push({ driver: d, name: dname(d), owner: me, bot: true });
  }
  // boty z przodu stawki, ludzie za nimi
  return [...bots, ...humans].map((r, i) => ({ ...r, kid: i + 1, slot: i }));
}

async function launch(msg: StartMsg, me: string, hold: boolean) {
  lastStart = msg;
  show('loading');
  $('ltext').textContent = 'Buduję miasto…';
  $('results').classList.add('hidden');
  const ns = msg.track.nodes;
  const lats = ns.map((n) => n.lat), lons = ns.map((n) => n.lon);
  const pad = 0.0022;
  const els = msg.track.els ?? (await fetchCity(Math.min(...lats) - pad, Math.min(...lons) - pad * 1.6, Math.max(...lats) + pad, Math.max(...lons) + pad * 1.6));
  const track = buildTrack(ns, msg.track.closed, msg.track.laps, 11, msg.seed ?? 0);
  const karts: KartSpec[] = msg.roster.map((r) => ({
    kid: r.kid, driver: r.driver, name: r.name, slot: r.slot, isBot: !!r.bot, padId: r.padId,
    ctrl: r.owner !== me ? 'remote' : r.bot ? 'bot' : r.padId ? 'pad' : 'key',
  }));
  show('gamescr');
  game?.dispose();
  game = new Game({
    canvas: $('cv') as HTMLCanvasElement, viewsEl: $('views'), track, els, karts, hold, difficulty, muted,
    net: link ?? undefined,
    onDone: showResults,
  });
  game.onMute = (m) => {
    muted = m;
    localStorage.setItem('jechac.mute', m ? '1' : '0');
    syncOpts();
  };
  closeOpts();
  (window as any).__game = game;
}

// --- opcje w trakcie wyścigu
let muted = localStorage.getItem('jechac.mute') === '1';
function syncOpts() {
  $('osound').textContent = muted ? 'Dźwięk: wyłączony' : 'Dźwięk: włączony';
}
function closeOpts() {
  $('opts').classList.add('hidden');
  if (game) game.paused = false;
}
function openOpts() {
  if (!game) return;
  syncOpts();
  $('opts').classList.remove('hidden');
  // w grze sieciowej nie da się zatrzymać czasu innym graczom
  $('onote').classList.toggle('hidden', !net);
  if (!net) game.paused = true;
}
$('optbtn').onclick = () => ($('opts').classList.contains('hidden') ? openOpts() : closeOpts());
$('oresume').onclick = closeOpts;
$('osound').onclick = () => game?.setMuted(!muted);
$('oquit').onclick = () => {
  closeOpts();
  ($('newtrack') as HTMLButtonElement).onclick!(new MouseEvent('click'));
};
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game && !$('gamescr').classList.contains('hidden')) $('optbtn').click();
});

function showResults(r: Result) {
  $('rtitle').textContent = r.place === 1 ? 'Wygrana!' : `Miejsce ${r.place}/${r.total}`;
  $('rlist').innerHTML = r.standings
    .map((s) => `<li>${esc(s.name)}${s.me ? ' ★' : ''} – ${s.time === null ? 'jedzie…' : s.time.toFixed(2) + ' s'}</li>`)
    .join('');
  const guest = !!net && !net.isHost;
  $('again').classList.toggle('hidden', guest);
  $('newtrack').classList.toggle('hidden', guest);
  $('rwait').classList.toggle('hidden', !guest);
  $('results').classList.remove('hidden');
}

// solo
$('go').onclick = async () => {
  if (!drawn) return;
  leaveNet();
  rememberTrack();
  try {
    await launch({ k: 'start', track: trackMsg(), roster: makeRoster([{ id: 'me', driver }], 'me'), seed: newSeed() }, 'me', false);
  } catch (err) {
    console.error(err);
    backToSetup('Nie udało się zbudować miasta. Spróbuj ponownie.');
  }
};

$('again').onclick = () => {
  if (!lastStart) return;
  if (net?.isHost) hostStart();
  else launch({ ...lastStart, seed: newSeed() }, 'me', false);
};
$('newtrack').onclick = () => {
  game?.dispose();
  game = null;
  leaveNet();
  $('confirm').classList.add('hidden');
  md?.reset();
  drawn = null;
  renderTracks();
  show('menu');
};

// --- sieć: wspólne
function leaveNet() {
  clearInterval(lobbyTimer);
  clearTimeout(goTimer);
  net?.close();
  net = null;
  link = null;
}
function makeLink(n: Net): NetLink {
  return {
    padInputs: new Map<string, Input>(),
    onState: null,
    sendState: (a) => n.send({ k: 's', a }),
    sendPad: (id, info) => n.send({ k: 'pi', ...info }, id),
  };
}
function playerList(el: HTMLElement, list: PlayerInfo[], hostId: string) {
  el.innerHTML = list
    .map((p) => `<li style="--c:${dcolor(p.driver)}">${esc(p.name || dname(p.driver))}<small>${p.id === hostId ? 'host' : p.mode === 'pad' ? 'kontroler' : 'własny ekran'}</small></li>`)
    .join('');
}

// --- host: lobby
$('invite').onclick = async () => {
  if (!drawn) return;
  leaveNet();
  rememberTrack();
  const n = new Net();
  try {
    await n.create({ driver, name: dname(driver), mode: 'screen' });
  } catch (e: any) {
    backToSetup(e.message);
    return;
  }
  net = n;
  link = makeLink(n);
  n.onPlayers = (l) => playerList($('lplayers'), l, n.hostId);
  n.onPlayers(n.players);
  n.onMsg = hostMsg;
  n.onClosed = (why) => {
    game?.dispose();
    game = null;
    leaveNet();
    backToSetup(why);
  };
  const url = n.inviteUrl();
  $('lcode').textContent = n.code;
  $('lurl').textContent = url;
  QRCode.toCanvas($('qr') as HTMLCanvasElement, url, { width: 210, margin: 1 });
  show('lobby');
  let left = 60;
  const tick = () => {
    $('lleft').textContent = `Start za ${left} s. Brakujące miejsca zajmą boty.`;
    n.send({ k: 'lobby', left });
    if (left-- <= 0) hostStart();
  };
  tick();
  lobbyTimer = window.setInterval(tick, 1000);
};
$('lstart').onclick = () => hostStart();
$('lcancel').onclick = () => {
  leaveNet();
  backToSetup();
};

function hostMsg(d: any, from: string) {
  if (d.k === 's') link?.onState?.(d.a);
  else if (d.k === 'in') link?.padInputs.set(from, d.i);
  else if (d.k === 'ready') {
    readySet.add(from);
    maybeGo();
  }
}
function maybeGo(force = false) {
  if (!net || !game || !game.hold) return;
  const need = (lastStart?.roster ?? []).filter((r) => r.owner !== net!.id).map((r) => r.owner);
  if (!force && !(readySet.has(net.id) && need.every((id) => readySet.has(id)))) return;
  clearTimeout(goTimer);
  net.send({ k: 'go' });
  game.go();
}
async function hostStart() {
  if (!net || !drawn) return;
  clearInterval(lobbyTimer);
  clearTimeout(goTimer);
  net.lock(true);
  const msg: StartMsg = { k: 'start', track: trackMsg(), roster: makeRoster(net.players, net.id), seed: newSeed() };
  readySet = new Set();
  net.send(msg);
  try {
    await launch(msg, net.id, true);
  } catch (err) {
    console.error(err);
    leaveNet();
    backToSetup('Nie udało się zbudować miasta. Spróbuj ponownie.');
    return;
  }
  readySet.add(net.id);
  goTimer = window.setTimeout(() => maybeGo(true), 20000); // nie czekamy w nieskończoność na wolne telefony
  maybeGo();
}

// --- gość: dołączanie
let jdriver: DriverId = 'teczka';
driverCards($('jcards'), (id, el) => {
  jdriver = id;
  $('jcards').querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c === el));
});
function openJoin(code: string) {
  ($('jcode') as HTMLInputElement).value = code.toUpperCase().slice(0, 4);
  $('jstatus').textContent = '';
  $('jcards').querySelectorAll('.card').forEach((c, i) => c.classList.toggle('sel', DRIVERS[i].id === jdriver));
  show('join');
}
$('jback').onclick = () => show('menu');
$('jscreen').onclick = () => joinGame('screen');
$('jpad').onclick = () => joinGame('pad');

async function joinGame(mode: 'screen' | 'pad') {
  const code = ($('jcode') as HTMLInputElement).value.trim().toUpperCase();
  const name = ($('jname') as HTMLInputElement).value.trim();
  if (code.length !== 4) return void ($('jstatus').textContent = 'Wpisz 4-literowy kod gry.');
  leaveNet();
  const n = new Net();
  try {
    await n.join(code, { driver: jdriver, name: name || dname(jdriver), mode });
  } catch (e: any) {
    $('jstatus').textContent = e.message;
    return;
  }
  net = n;
  link = makeLink(n);
  $('wcode').textContent = n.code;
  $('wtext').textContent = 'Czekamy na start…';
  n.onPlayers = (l) => playerList($('wplayers'), l, n.hostId);
  n.onClosed = (why) => {
    game?.dispose();
    game = null;
    padStop();
    leaveNet();
    openJoin(code);
    $('jstatus').textContent = why;
  };
  n.onMsg = async (d) => {
    if (d.k === 'lobby') $('wtext').textContent = `Start za ${d.left} s`;
    else if (d.k === 's') link?.onState?.(d.a);
    else if (d.k === 'go') game?.go();
    else if (d.k === 'pi') padInfo(d);
    else if (d.k === 'start') {
      if (mode === 'pad') return padStart(name || dname(jdriver));
      try {
        await launch(d as StartMsg, n.id, true);
        n.send({ k: 'ready' }, n.hostId);
      } catch (err) {
        console.error(err);
        $('ltext').textContent = 'Nie udało się wczytać miasta.';
      }
    }
  };
  show('wait');
}

// --- kontroler na telefon: gałka/żyroskop + GAZ, STOP, DRIFT
let padState: Input = { thr: 0, brk: 0, st: 0, hb: false };
let padTimer = 0;
let wake: any = null;
function padSend() {
  net?.send({ k: 'in', i: { ...padState, st: Math.round(padState.st * 100) / 100 } }, net.hostId);
}
mountControls($('padctl'), (s) => {
  const btn = s.thr !== padState.thr || s.brk !== padState.brk || s.hb !== padState.hb;
  padState = s;
  if (btn) padSend(); // przyciski od razu, skręt idzie w takcie 20 Hz
});
function padStart(name: string) {
  $('pname').textContent = name;
  $('pinfo').textContent = 'Wczytywanie wyścigu…';
  show('pad');
  clearInterval(padTimer);
  padTimer = window.setInterval(padSend, 50); // 20 Hz: płynny skręt i podtrzymanie
  (navigator as any).wakeLock?.request('screen').then((w: any) => (wake = w)).catch(() => {});
}
function padStop() {
  clearInterval(padTimer);
  wake?.release?.();
  wake = null;
}
function padInfo(d: any) {
  if (d.fin) $('pinfo').textContent = `META! Miejsce ${d.place}/${d.total}`;
  else if (d.cd < -5) $('pinfo').textContent = 'Czekam na graczy…';
  else if (d.cd < 0) $('pinfo').textContent = `Start za ${Math.ceil(-d.cd)}…`;
  else $('pinfo').textContent = `${d.place}/${d.total} · ${d.laps ? `okr. ${d.lap}/${d.laps} · ` : ''}${d.speed} km/h`;
}

// --- sterowanie dotykowe w grze na własnym ekranie
mountControls($('tctl'), (s) => {
  if (game) game.touchCtl = s;
});
// telefon: pełny ekran i blokada poziomu przy wejściu do gry (wymaga gestu użytkownika)
document.addEventListener(
  'click',
  (e) => {
    if (matchMedia('(pointer:coarse)').matches && (e.target as HTMLElement).closest?.('#go,#invite,#jscreen,#jpad,.tsolo,.tinv')) goLandscape();
  },
  true
);

// --- wejście z linku/QR: #KOD
const hashCode = location.hash.replace('#', '').trim();
if (/^[A-Za-z]{4}$/.test(hashCode)) openJoin(hashCode);

// --- demo offline: ?demo albo ?demo=sprint (dodaj &lobby, żeby od razu otworzyć lobby)
const dq = new URLSearchParams(location.search);
if (dq.has('demo')) {
  import('./demo').then(({ demoData }) => {
    const d = demoData(dq.get('demo') ?? '');
    drawn = { nodes: d.nodes, closed: d.closed, lengthM: 800 } as any;
    (drawn as any).els = d.els;
    laps = 2;
    if (dq.has('lobby')) $('invite').click();
    else $('go').click();
  });
}
