// Sterowanie dotykowe (telefon poziomo): gałka skrętu po lewej albo żyroskop, po prawej GAZ, STOP i DRIFT.
// Używane w dwóch miejscach: nakładka na grę (własny ekran) i ekran kontrolera.
import type { Input } from './game';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function mountControls(root: HTMLElement, onChange: (s: Input) => void) {
  root.innerHTML =
    '<div class="tc-left"><div class="tc-base"><div class="tc-knob"></div></div></div>' +
    '<button class="tc-gyro">Żyroskop: wył.</button>' +
    '<div class="tc-right"><button class="tc-b tc-drift" data-k="hb">DRIFT</button><button class="tc-b tc-stop" data-k="brk">STOP</button><button class="tc-b tc-gas" data-k="thr">GAZ</button></div>';
  const s: Input = { st: 0, thr: 0, brk: 0, hb: false };
  let gyro = false;
  const emit = () => onChange({ ...s });

  // --- gałka: przesuw w poziomie, analogowo
  const area = root.querySelector('.tc-left') as HTMLElement;
  const base = root.querySelector('.tc-base') as HTMLElement;
  const knob = root.querySelector('.tc-knob') as HTMLElement;
  let pid = -1;
  const show = (st: number) => {
    const R = (base.clientWidth - knob.offsetWidth) / 2;
    knob.style.transform = `translateX(${-st * R}px)`;
  };
  const move = (e: PointerEvent) => {
    const r = base.getBoundingClientRect();
    const R = (r.width - knob.offsetWidth) / 2 || 1;
    const dx = clamp(e.clientX - (r.left + r.width / 2), -R, R);
    s.st = -dx / R; // w lewo = dodatni skręt
    show(s.st);
    emit();
  };
  area.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (gyro) return;
    pid = e.pointerId;
    try {
      area.setPointerCapture(pid);
    } catch {
      /* zdarzenie syntetyczne */
    }
    move(e);
  });
  area.addEventListener('pointermove', (e) => {
    if (e.pointerId === pid && !gyro) move(e);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    pid = -1;
    if (gyro) return;
    s.st = 0;
    show(0);
    emit();
  };
  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);

  // --- przyciski
  root.querySelectorAll<HTMLElement>('.tc-b').forEach((b) => {
    const k = b.dataset.k as 'thr' | 'brk' | 'hb';
    const set = (v: boolean) => (e: Event) => {
      e.preventDefault();
      if (k === 'hb') s.hb = v;
      else s[k] = v ? 1 : 0;
      b.classList.toggle('on', v);
      emit();
    };
    b.addEventListener('pointerdown', (e) => {
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* zdarzenie syntetyczne */
      }
      set(true)(e);
    });
    b.addEventListener('pointerup', set(false));
    b.addEventListener('pointercancel', set(false));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // --- żyroskop: telefon trzymany poziomo jak kierownica
  const gbtn = root.querySelector('.tc-gyro') as HTMLElement;
  // Kąt "kierownicy" liczymy z kierunku grawitacji w płaszczyźnie ekranu (devicemotion), a nie z kątów
  // Eulera (deviceorientation): te przy telefonie trzymanym pionowo w poziomie skaczą (gimbal lock).
  // Wzór jest odporny na odwrócony znak osi na iOS i na to, w którą stronę obrócono telefon.
  let got = 0;
  let watchdog = 0;
  const onMotion = (e: DeviceMotionEvent) => {
    const g = e.accelerationIncludingGravity;
    if (!gyro || !g || g.x == null || g.y == null) return;
    got++;
    const ax = g.x, ay = g.y; // w poziomie oś x telefonu jest pionowa
    if (Math.hypot(ax, ay) < 2.5) return; // leży płasko: brak kierunku, trzymamy ostatni skręt
    let deg = (Math.atan2(-ay * Math.sign(ax || 1), Math.abs(ax)) * 180) / Math.PI;
    if (Math.abs(deg) < 2.5) deg = 0; // martwa strefa
    const target = clamp(deg / 30, -1, 1); // pełny skręt przy ~30° przechyłu
    s.st += (target - s.st) * 0.35; // lekkie wygładzenie drgań ręki
    show(s.st);
    emit();
  };
  const label = (t: string) => void (gbtn.textContent = t);
  gbtn.addEventListener('click', async () => {
    clearTimeout(watchdog);
    if (!gyro) {
      const D = (window as any).DeviceMotionEvent;
      if (!D) return label('Brak czujnika ruchu');
      if (!window.isSecureContext) return label('Żyroskop wymaga https');
      // Pytamy o zgodę tam, gdzie przeglądarka tego wymaga (iPhone), ale odmowy nie traktujemy jako
      // ostatecznej: część przeglądarek zgłasza błąd, a dane i tak wysyła. Rozstrzyga to, czy płyną odczyty.
      let denied = false;
      if (typeof D.requestPermission === 'function') {
        try {
          denied = (await D.requestPermission()) !== 'granted';
        } catch {
          denied = true;
        }
      }
      gyro = true;
      got = 0;
      addEventListener('devicemotion', onMotion);
      watchdog = window.setTimeout(() => {
        if (gyro && got === 0) label(denied ? 'Żyroskop: brak zgody na czujnik ruchu' : 'Żyroskop: brak danych z czujnika');
      }, 1500);
    } else {
      gyro = false;
      removeEventListener('devicemotion', onMotion);
      s.st = 0;
      show(0);
      emit();
    }
    label(gyro ? 'Żyroskop: wł.' : 'Żyroskop: wył.');
    root.classList.toggle('gyro', gyro);
  });
}

// Pełny ekran + blokada poziomu (Android). Na iPhonie blokady nie ma, wtedy działa nakładka "obróć telefon".
export async function goLandscape() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    await (screen.orientation as any).lock?.('landscape');
  } catch {
    /* brak wsparcia: zostaje nakładka */
  }
}
