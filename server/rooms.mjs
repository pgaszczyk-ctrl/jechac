// Pokoje gry: prosty przekaźnik WebSocket. Logikę lobby i wyścigu prowadzi host (klient),
// serwer tylko pilnuje składu pokoju i przekazuje wiadomości. Łatwo przenieść na Durable Objects.
import { WebSocketServer } from 'ws';
import os from 'node:os';

const ALPHA = 'ABCDEFGHJKLMNPRSTUWXYZ'; // bez znaków łatwych do pomylenia
const rooms = new Map(); // code -> { hostId, clients: Map<id, { ws, info }> }
let nextId = 1;

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(i.address); // bez adresów link-local
  return out;
}

function broadcastPlayers(room) {
  const list = [...room.clients].map(([id, c]) => ({ id, ...c.info }));
  for (const c of room.clients.values()) send(c.ws, { t: 'players', list, hostId: room.hostId });
}
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));

export function attachRooms(httpServer, path = '/ws') {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith(path)) return; // resztę (np. HMR Vite) zostawiamy innym
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  wss.on('connection', (ws) => {
    const id = 'p' + nextId++;
    let room = null;
    let code = null;
    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.t === 'create' && !room) {
        do {
          code = Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
        } while (rooms.has(code));
        room = { hostId: id, clients: new Map([[id, { ws, info: m.info ?? {} }]]) };
        rooms.set(code, room);
        send(ws, { t: 'created', code, id, lan: lanIps() });
        broadcastPlayers(room);
      } else if (m.t === 'join' && !room) {
        const r = rooms.get(String(m.code ?? '').toUpperCase());
        if (!r) return send(ws, { t: 'error', msg: 'Nie ma gry o takim kodzie.' });
        if (r.locked) return send(ws, { t: 'error', msg: 'Wyścig już trwa.' });
        if (r.clients.size >= 8) return send(ws, { t: 'error', msg: 'Pokój jest pełny.' });
        room = r;
        code = String(m.code).toUpperCase();
        room.clients.set(id, { ws, info: m.info ?? {} });
        send(ws, { t: 'joined', code, id, hostId: room.hostId });
        broadcastPlayers(room);
      } else if (m.t === 'lock' && room && room.hostId === id) {
        room.locked = !!m.v;
      } else if (m.t === 'msg' && room) {
        const out = { t: 'msg', from: id, d: m.d };
        if (m.to) {
          const c = room.clients.get(m.to);
          if (c) send(c.ws, out);
        } else for (const [cid, c] of room.clients) if (cid !== id) send(c.ws, out);
      }
    });
    ws.on('close', () => {
      if (!room) return;
      room.clients.delete(id);
      if (room.hostId === id || room.clients.size === 0) {
        for (const c of room.clients.values()) {
          send(c.ws, { t: 'closed' });
          c.ws.close();
        }
        rooms.delete(code);
      } else broadcastPlayers(room);
    });
  });
  return wss;
}
