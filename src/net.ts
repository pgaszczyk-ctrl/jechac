// Klient pokoju gry. Serwer jest przekaźnikiem; wiadomości gry lecą jako {k: ...}.
export interface PlayerInfo {
  id: string;
  name?: string;
  driver?: string;
  mode?: 'screen' | 'pad';
}

export class Net {
  ws!: WebSocket;
  id = '';
  code = '';
  hostId = '';
  lan: string[] = [];
  players: PlayerInfo[] = [];
  onPlayers: (list: PlayerInfo[]) => void = () => {};
  onMsg: (d: any, from: string) => void = () => {};
  onClosed: (why: string) => void = () => {};
  private pending: ((m: any) => void) | null = null;

  get isHost() {
    return this.id !== '' && this.id === this.hostId;
  }

  // query: na Cloudflare kod pokoju musi być znany przy łączeniu (wybiera Durable Object)
  private open(query: string): Promise<void> {
    return new Promise((res, rej) => {
      this.ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws' + query);
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('Brak połączenia z serwerem gry.'));
      this.ws.onclose = () => this.onClosed('Połączenie z grą zostało przerwane.');
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'msg') this.onMsg(m.d, m.from);
        else if (m.t === 'players') {
          this.players = m.list;
          this.hostId = m.hostId;
          this.onPlayers(m.list);
        } else if (m.t === 'closed') this.onClosed('Host zakończył grę.');
        else if (this.pending) {
          const p = this.pending;
          this.pending = null;
          p(m);
        }
      };
    });
  }

  private ask(o: any): Promise<any> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Serwer gry nie odpowiada.')), 6000);
      this.pending = (m) => {
        clearTimeout(t);
        m.t === 'error' ? rej(new Error(m.msg)) : res(m);
      };
      this.ws.send(JSON.stringify(o));
    });
  }

  async create(info: Omit<PlayerInfo, 'id'>) {
    await this.open('?create=1');
    const m = await this.ask({ t: 'create', info });
    this.id = this.hostId = m.id;
    this.code = m.code;
    this.lan = m.lan ?? [];
  }

  async join(code: string, info: Omit<PlayerInfo, 'id'>) {
    await this.open('?code=' + encodeURIComponent(code));
    const m = await this.ask({ t: 'join', code, info });
    this.id = m.id;
    this.code = m.code;
    this.hostId = m.hostId;
  }

  send(d: any, to?: string) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'msg', d, to }));
  }
  lock(v: boolean) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'lock', v }));
  }
  close() {
    this.onClosed = () => {};
    this.ws?.close();
  }

  // adres do zaproszenia: na localhost podmieniamy na IP w sieci lokalnej, żeby telefon trafił
  inviteUrl(): string {
    let host = location.host;
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && this.lan.length) host = this.lan[0] + (location.port ? ':' + location.port : '');
    return `${location.protocol}//${host}/#${this.code}`;
  }
}
