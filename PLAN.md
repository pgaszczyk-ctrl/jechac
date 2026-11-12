# Jechać! – plan prac (handoff)

Gra: wyścigi gokartów po prawdziwych ulicach z OSM, widok zza gokartu.
Flow: wybór kierowcy → adres → mapa → rysowanie trasy po ulicach (start, meta, pętla = okrążenia, inaczej sprint) → 3D low-poly miasto → zaproszenie graczy (QR/kod) → 1 min lobby albo solo z 3 botami.

## Stan na teraz
Działa (sprawdzone na syntetycznym mieście `?demo` i `?demo=sprint`): jazda, 3 boty, bramy START/META, okrążenia, wynik, 4 karty proceduralne z eksportem GLB (kontrakt: forward -Z, węzły `wheel_FL/FR/RL/RR` z dzieckiem `spin`, `steering_wheel`, `driver`).
Pliki: `src/main.ts` (przepływ ekranów), `mapdraw.ts` (MapLibre + snap + Dijkstra), `osm.ts` (Overpass/Nominatim, graf), `track.ts` (linia środkowa, korytarz), `world.ts` (budynki, drogi, bandy), `game.ts` (fizyka, boty, kamera), `karts.ts`, `demo.ts`.

## Aktualizacja: błędy nr 1 i 2 rozwiązane
- **Mapa:** przyczyną był worker MapLibre 6 (adres liczony w runtime psuł bundler Vite). Naprawione przez `?worker&url` + `setWorkerUrl` w `mapdraw.ts` i `worker.format: 'es'` w `vite.config.ts`.
- **Dane:** Overpass usunięty. Ulice, budynki, woda i zieleń idą z kafli wektorowych OpenFreeMap z14 (`tiles.ts`), tych samych, które rysują mapę. Graf ulic (`osm.ts`) skleja krawędzie kafli i wpina ślepe końce w skrzyżowania „T" (`heal`). Drzewa są proceduralne w zieleni. Geokoder ma timeout i zapas (Photon).
- Sprawdzone na Lublinie: graf 17 tys. węzłów (92% w jednej sieci), trasa 0,70 km, 763 budynki, wyścig do mety.
- Zostaje z M1/M2: ręczny test rysowania myszką i pętli, dziury w budynkach, kolory z `colour`, szwy budynków na granicach kafli, docelowo własne PMTiles zamiast publicznego OpenFreeMap.

## Aktualizacja: M3 w większości zrobione
Zrobione w `game.ts`: model z poślizgiem bocznym (prędkość jako wektor), hamulec ręczny (Spacja/Shift), odbicia od band i wymiana pędu przy zderzeniach, boty o różnych profilach z „gumką", automatyczny respawn po utknięciu i ręczny (R), ostrzeżenie „ZŁY KIERUNEK", minimapa, dźwięk silnika (WebAudio, M wycisza), dotyk: dwa palce = hamulec.
Zostaje: strojenie odczucia jazdy na żywo (stałe w `drive()`), kamera omijająca budynki, sterowanie przechyłem, Wake Lock, dźwięki zderzeń/pisku.

## Aktualizacja: M4 (multiplayer) i oprawa
- **Serwer:** `server/rooms.mjs` to przekaźnik WebSocket z pokojami (kod 4 litery, do 8 klientów). W dev wpięty w Vite jako plugin (`/ws`), produkcyjnie `npm run build && npm start` (`server/prod.mjs`). Logikę lobby i startu prowadzi host.
- **Klient:** `net.ts`, lobby z QR i kodem, ekran dołączania (`#KOD`), dwa tryby gościa: własny ekran albo telefon jako kontroler (`#pad`). Host ma podzielony ekran dla siebie i do 3 kontrolerów.
- **Protokół:** `start` (trasa + skład), `ready`, `go`, `s` (stany kartów co ~60 ms), `in` (wejście kontrolera), `pi` (informacja zwrotna na kontroler), `lobby` (odliczanie).
- **Gra:** `KartSpec.ctrl` = key/pad/bot/remote, karty zdalne wygładzane z ekstrapolacją, boty liczy host.
- **Oprawa:** lusterko wsteczne, witryny POI (`poi.ts`), kibice i balony (`decor.ts`), żywa paleta, zapisane trasy (ulubione + 3 ostatnie w localStorage), przyciski STOP/DRIFT na dotyk.
- Sprawdzone na jednym komputerze w trzech kartach (host, gość na własnym ekranie, kontroler). **Nie sprawdzone na prawdziwych telefonach w Wi-Fi** (zapora Windows może blokować port 5173).
- Zostaje: reconnect po zerwaniu WebSocketu, synchronizacja zegara startu, wdrożenie publiczne (Cloudflare/Fly), rewanż z nowymi graczami (pokój jest zamykany na dołączanie po starcie).

## (Historia) Błąd nr 1: mapa się nie ładuje
Objaw: po wpisaniu adresu widać tylko beżowe tło i atrybucję OpenFreeMap, brak kafli. Czyli styl się ładuje, kafle nie.
Diagnoza po kolei (Network + Console w DevTools):
1. Czy żądania do `tiles.openfreemap.org` (style, TileJSON, kafle `.pbf`) kończą się 200? Jeśli CORS/blokada/timeout, to sieć lub dostawca.
2. Błędy workera MapLibre (Vite + maplibre-gl v5): ewentualnie `import maplibregl from 'maplibre-gl'` i `maplibregl.setWorkerUrl` / import `maplibre-gl/dist/maplibre-gl-csp` z `workerUrl`.
3. Czy kontener `#map` miał niezerowy rozmiar przy tworzeniu (mapa tworzona po `show('mapscr')`; sprawdzić `map.resize()` po `load`).
4. Czy `goto()` robi `jumpTo` na współrzędne z Nominatima (lublin → ~51.25, 22.57) i czy `moveend` odpala `ensureRoads`.
Fallback, jeśli OpenFreeMap zawodzi: Protomaps (PMTiles) lub MapTiler z kluczem w `.env`. Nie używać `tile.openstreetmap.org`.
Kryterium: wpisuję „Lublin" i widzę mapę z ulicami, mogę przybliżyć do z16.

## Błąd nr 2: Overpass bywa niedostępny
Publiczne serwery dawały timeouty/502 (jest rotacja po 4 mirrorach i ponawianie, ale to za mało).
- Cache po stronie serwera (komórki ~500 m, klucz = bbox, R2/KV lub plik), proxy `/api/osm?bbox=…`.
- Klient pyta tylko proxy. Wspólna baza dla wszystkich graczy (ten sam wyścig = te same dane).
- Docelowo: własny wyciąg Polski (planetiler → PMTiles) i zero zależności od Overpassa.

## Kamienie milowe
**M1 – mapa i rysowanie (po naprawie nr 1/2).**
Test ręczny na realnym adresie: snap do ulic, Dijkstra, cofanie Backspace, domknięcie pętli (żółty znacznik startu), pytanie o okrążenia, sprint.
Do dopracowania: nearest-node po węzłach (na prostych odcinkach rzadkie) → snap do krawędzi; wygładzanie ostrych zakrętów; odrzucanie tras z samoprzecięciem, mostami i tunelami; limit długości (~6 km).

**M2 – miasto 3D na prawdziwych danych.**
Relacje multipolygon (budynki z dziurami), `roof:shape` (płaski/piramidalny), wysokości domyślne, parki/woda, drzewa, latarnie. Chunki 200 m + frustum culling. Kamera: raycast przeciw budynkom. Skala świata ×1,5–2 lub szersze ulice (kart wolno jedzie w 6 m ulicy). Wydajność na telefonie (cel 60 fps, pixelRatio ≤1.5).

**M3 – jazda i boty.**
Feeling sterowania (drift/hamulec ręczny na ostrych zakrętach), respawn na checkpoint, wykrywanie jazdy pod prąd, zróżnicowanie botów (prędkość, błędy, rubber-banding), dźwięk (WebAudio), sterowanie dotykiem/przechyłem, Wake Lock.

**M4 – multiplayer.**
Monorepo z pakietem `sim` współdzielonym klient/serwer. Cloudflare Durable Objects (alternatywa: Colyseus na Fly.io): pokój = kod gry, QR → `#KOD`, lobby z minutą oczekiwania, dopełnienie botami do 4. Każdy klient symuluje swój kart i wysyła stan 20 Hz, reszta interpoluje (~100 ms), kolizje miękkie, odliczanie wg czasu serwera, reconnect token (Safari zabija WebSocket), boty liczone na serwerze. Serwer „piecze" trasę raz i rozsyła.

**M5 – oprawa i modele.**
Podmiana kart proceduralnych na GLB użytkownika (kontrakt wyżej, ≤15 tys. trójkątów, tekstury ≤1024, kompresja gltf-transform), ekran wyników z rewanżem, zapis trasy pod kodem, tytuł/menu, i18n.

## Uwagi
- Atrybucja „© OpenStreetMap contributors" musi być widoczna.
- Adresy wpisywane przez graczy są wrażliwe: geokodować przez własne proxy, nie logować.
- General G. jest bardzo podobny do General Grievousa. Przed publikacją przeprojektować.
- Uruchomienie: `npm run dev` w `jechac`, tryb offline: `?demo`.
