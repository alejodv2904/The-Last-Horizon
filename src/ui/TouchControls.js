// Controles táctiles: joystick flotante (izquierda), cámara arrastrando (derecha) y botones de acción.
// Solo se activa en dispositivos táctiles (html.touch). Escribe en InputManager igual que lo harían teclado y ratón.
import { clamp } from '../core/MathUtils.js';

const LOOK_MULT = 1.6;      // píxeles de arrastre → equivalente en "píxeles de ratón"
const DEAD_ZONE = 0.14;
const RUN_THRESHOLD = 0.82; // empujar el joystick hasta el borde = correr / galopar

class TouchControls {
  constructor(game) {
    this.game = game; this.input = game.input; this.ui = game.ui;
    this.root = document.getElementById('touch-layer');
    this.stickEl = document.getElementById('tc-stick');
    this.knob = this.stickEl.querySelector('.knob');
    this.actBtn = document.getElementById('tc-act');
    this.aimBtn = document.getElementById('tc-aim');
    this.fireBtn = document.getElementById('tc-fire');
    this.stick = { id: null, ox: 0, oy: 0 };
    this.look = { id: null, x: 0, y: 0 };
    this.fireId = null; this.aimOn = false; this.actKey = 'KeyE';
    this._on = false; this._dlg = false;
    this._bindZones(); this._bindButtons();
    this.ui.onPrompt = (key, text) => this._onPrompt(key, text);
    // Evita zoom por pellizco / doble toque y el menú contextual en iOS.
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
  }

  /* ---------------- Pantalla completa + horizontal (requiere un gesto del usuario) ---------------- */
  async enterFullscreen() {
    try {
      const el = document.documentElement, rf = el.requestFullscreen || el.webkitRequestFullscreen;
      if (rf && !document.fullscreenElement && !document.webkitFullscreenElement) await rf.call(el, { navigationUI: 'hide' });
    } catch (err) { /* iOS Safari en iPhone no admite pantalla completa: no pasa nada */ }
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (err) { /* sin soporte: se usa el aviso de girar */ }
  }

  /* ---------------- Zonas: joystick (izq.) y cámara (der.) ---------------- */
  _bindZones() {
    const root = this.root;
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tc-btn')) return;
      e.preventDefault();
      if (this._dlg) { this.input.mouse.leftPressed = true; return; }   // tocar en un diálogo = continuar
      if (!this._on) return;
      const leftSide = e.clientX < window.innerWidth * 0.42;
      if (leftSide && this.stick.id === null) this._startStick(e);
      else if (!leftSide && this.look.id === null) {
        this.look.id = e.pointerId; this.look.x = e.clientX; this.look.y = e.clientY;
        try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignorar */ }
      }
    });
    root.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stick.id) this._moveStick(e);
      else if (e.pointerId === this.look.id) {
        this.input.mouse.dx += (e.clientX - this.look.x) * LOOK_MULT; this.input.mouse.dy += (e.clientY - this.look.y) * LOOK_MULT;
        this.look.x = e.clientX; this.look.y = e.clientY;
      }
    });
    const end = (e) => {
      if (e.pointerId === this.stick.id) this._endStick();
      if (e.pointerId === this.look.id) this.look.id = null;
    };
    root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  }

  _startStick(e) {
    const el = this.stickEl, r = el.offsetWidth / 2;
    this.stick.id = e.pointerId; this.stick.r = r;
    // El joystick aparece donde apoyas el pulgar (sin salirse de la pantalla).
    const cx = clamp(e.clientX, r + 6, window.innerWidth * 0.5), cy = clamp(e.clientY, r + 6, window.innerHeight - r - 6);
    this.stick.ox = cx; this.stick.oy = cy;
    el.style.left = `${cx - r}px`; el.style.top = `${cy - r}px`; el.style.bottom = 'auto';
    el.classList.add('active');
    try { this.root.setPointerCapture(e.pointerId); } catch (err) { /* ignorar */ }
    this._moveStick(e);
  }
  _moveStick(e) {
    const r = this.stick.r;
    let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > r) { dx = dx / len * r; dy = dy / len * r; }
    this.knob.style.setProperty('--kx', `${dx}px`); this.knob.style.setProperty('--ky', `${dy}px`);
    let x = dx / r, y = -dy / r;
    const mag = Math.hypot(x, y);
    if (mag < DEAD_ZONE) { x = 0; y = 0; }
    this.input.axis.x = x; this.input.axis.y = y;
    if (mag > RUN_THRESHOLD) this.input.virtual.add('ShiftLeft'); else this.input.virtual.delete('ShiftLeft');
  }
  _endStick() {
    this.stick.id = null;
    const el = this.stickEl;
    el.classList.remove('active'); el.style.left = ''; el.style.top = ''; el.style.bottom = '';
    this.knob.style.setProperty('--kx', '0px'); this.knob.style.setProperty('--ky', '0px');
    this.input.axis.x = 0; this.input.axis.y = 0; this.input.virtual.delete('ShiftLeft');
  }

  /* ---------------- Botones ---------------- */
  _bindButtons() {
    const input = this.input, g = this.game;
    const press = (btn, fn, up) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        btn.classList.add('down');
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignorar */ }
        fn(e);
      });
      const release = (e) => { btn.classList.remove('down'); if (up) up(e); };
      btn.addEventListener('pointerup', release); btn.addEventListener('pointercancel', release);
    };
    // Disparo: mantener pulsado repite el disparo (la cadencia la limita el arma).
    press(this.fireBtn, (e) => { this.fireId = e.pointerId; input.mouse.left = true; input.mouse.leftPressed = true; },
      () => { this.fireId = null; input.mouse.left = false; });
    // Apuntar: se activa/desactiva con cada toque.
    press(this.aimBtn, () => this._setAim(!this.aimOn));
    press(this.actBtn, () => input.pressKey(this.actKey));
    this.root.querySelectorAll('[data-key]').forEach((b) => press(b, () => input.pressKey(b.dataset.key)));
    const pause = document.getElementById('tc-pause');
    press(pause, () => g.pause());
  }
  _setAim(on) {
    this.aimOn = on; this.input.mouse.right = on;
    this.aimBtn.classList.toggle('on', on);
  }
  _onPrompt(key, text) {
    const b = this.actBtn;
    if (key) { this.actKey = `Key${key}`; b.querySelector('.g').textContent = key; b.classList.add('show'); }
    else b.classList.remove('show');
  }

  _releaseAll() {
    if (this.stick.id !== null) this._endStick();
    this.look.id = null;
    if (this.fireId !== null) { this.fireId = null; this.input.mouse.left = false; }
    this._setAim(false);
    this.input.axis.x = 0; this.input.axis.y = 0; this.input.virtual.clear();
    this.root.querySelectorAll('.down').forEach((b) => b.classList.remove('down'));
  }

  // Se llama una vez por fotograma (también en pausa) para mostrar/ocultar los controles según el modo de juego.
  sync() {
    const g = this.game, playing = g.started && !g.paused, m = g.mode;
    const on = playing && (m === 'explore' || m === 'skinning' || m === 'action');
    const dlg = playing && m === 'dialogue';
    if (on !== this._on || dlg !== this._dlg) {
      this._on = on; this._dlg = dlg;
      const cl = document.documentElement.classList;
      cl.toggle('tc-on', on); cl.toggle('tc-dialogue', dlg);
      if (!on) this._releaseAll();
    }
    if (on && this.fireId !== null) { this.input.mouse.left = true; this.input.mouse.leftPressed = true; }
  }
}

export { TouchControls };
