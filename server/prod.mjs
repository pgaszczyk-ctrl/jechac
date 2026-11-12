// Serwer produkcyjny: statyczne pliki z dist/ + pokoje WebSocket. Uruchom: npm run build && npm start
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRooms } from './rooms.mjs';

const dist = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\])+/, '');
  const file = join(dist, p === '/' || p === '\' ? 'index.html' : p);
  try {
    if (!file.startsWith(dist)) throw new Error('forbidden');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});
attachRooms(server);
const port = +(process.env.PORT ?? 8080);
server.listen(port, () => console.log('Jechać! na porcie ' + port));
