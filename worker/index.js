// Jechać! na Cloudflare: pliki statyczne z dist/ + pokoje gry jako Durable Object.
// Jeden pokój = jeden obiekt (nazwa = kod gry). Ta sama logika co server/rooms.mjs.
const ALPHA = 'ABCDEFGHJKLMNPRSTUWXYZ';

export class Room {
  constructor() {
    this.clients = new Map(); // id -> { ws, info }
    this.hostId = null;
    this.locked = false;
    this.next = 1;
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Oczekiwano WebSocket', { status: 426 });
    const url = new URL(req.url);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    this.handle(server, url.searchParams.get('code') ?? '');
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, o) {
    try {
      ws.send(JSON.stringify(o));
    } catch {
      /* gniazdo już zamknięte */
    }
  }

  broadcastPlayers() {
    const list = [...this.clients].map(([id, c]) => ({ id, ...c.info }));
    for (const c of this.clients.values()) this.send(c.ws, { t: 'players', list, hostId: this.hostId });
  }

  handle(ws, code) {
    const id = 'p' + this.next++;
    let inRoom = false;
    ws.addEventListener('message', (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === 'create' && !inRoom) {
        if (this.clients.size) return this.send(ws, { t: 'error', msg: 'Kod zajęty, spróbuj jeszcze raz.' });
        inRoom = true;
        this.hostId = id;
        this.locked = false;
        this.clients.set(id, { ws, info: m.info ?? {} });
        this.send(ws, { t: 'created', code, id, lan: [] });
        this.broadcastPlayers();
      } else if (m.t === 'join' && !inRoom) {
        if (!this.hostId) return this.send(ws, { t: 'error', msg: 'Nie ma gry o takim kodzie.' });
        if (this.locked) return this.send(ws, { t: 'error', msg: 'Wyścig już trwa.' });
        if (this.clients.size >= 8) return this.send(ws, { t: 'error', msg: 'Pokój jest pełny.' });
        inRoom = true;
        this.clients.set(id, { ws, info: m.info ?? {} });
        this.send(ws, { t: 'joined', code, id, hostId: this.hostId });
        this.broadcastPlayers();
      } else if (m.t === 'lock' && inRoom && this.hostId === id) {
        this.locked = !!m.v;
      } else if (m.t === 'msg' && inRoom) {
        const out = { t: 'msg', from: id, d: m.d };
        if (m.to) {
          const c = this.clients.get(m.to);
          if (c) this.send(c.ws, out);
        } else for (const [cid, c] of this.clients) if (cid !== id) this.send(c.ws, out);
      }
    });
    const gone = () => {
      if (!inRoom) return;
      inRoom = false;
      this.clients.delete(id);
      if (this.hostId === id || this.clients.size === 0) {
        for (const c of this.clients.values()) {
          this.send(c.ws, { t: 'closed' });
          try {
            c.ws.close(1000, 'host left');
          } catch {
            /* już zamknięte */
          }
        }
        this.clients.clear();
        this.hostId = null;
        this.locked = false;
      } else this.broadcastPlayers();
    };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      let code = (url.searchParams.get('code') ?? '').toUpperCase();
      if (url.searchParams.has('create')) code = Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
      else if (!/^[A-Z]{4}$/.test(code)) return new Response('Zły kod gry', { status: 400 });
      url.searchParams.set('code', code);
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(url, req));
    }
    return env.ASSETS.fetch(req);
  },
};
