import { defineConfig } from 'vite';
// @ts-ignore moduł JS bez typów
import { attachRooms } from './server/rooms.mjs';

export default defineConfig({
  worker: { format: 'es' },
  // host: dostęp z telefonów w tej samej sieci Wi-Fi; allowedHosts: adresy tuneli (np. trycloudflare.com)
  server: { host: true, allowedHosts: true },
  plugins: [
    {
      name: 'jechac-rooms',
      configureServer(server) {
        if (server.httpServer) attachRooms(server.httpServer);
      },
    },
  ],
});
