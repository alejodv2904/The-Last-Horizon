class InputManager {
  // opts.touch: dispositivo táctil → sin pointer lock; la cámara y el movimiento llegan desde TouchControls.
  constructor(canvas, bus, opts = {}) {
    this.canvas = canvas; this.bus = bus;
    this.touchMode = !!opts.touch;
    this.axis = { x: 0, y: 0 };            // joystick virtual: x → derecha, y → adelante (-1..1)
    this.virtual = new Set();              // teclas "mantenidas" por la interfaz táctil (p. ej. ShiftLeft)
    this.keys = new Set(); this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false };
    this.locked = false; this.fallback = false; this.enabled = false;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = false; this.mouse.right = false; });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousedown', (e) => {
      if (this.touchMode) return;   // los toques generan ratón "emulado": se ignora
      if (!this.enabled || !(this.locked || this.fallback)) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.touchMode) return;
      if (!this.enabled || !(this.locked || this.fallback)) return;
      this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) { this.everLocked = true; this.fallback = false; }
      this.bus.emit('pointerlock', this.locked);
    });
    document.addEventListener('pointerlockerror', () => this._lockFailed());
  }
  _lockFailed() {
    // Si nunca se obtuvo el bloqueo (navegador/iframe sin soporte) se usa el modo libre;
    // si ya funcionó antes (p. ej. reintento demasiado rápido tras Esc), se pide otro clic.
    if (!this.everLocked) this.fallback = true;
    this.bus.emit('pointerlock:error', this.fallback);
  }
  exitLock() {
    this.mouse.left = false; this.mouse.right = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  requestLock() {
    if (this.touchMode) { this.locked = true; this.bus.emit('pointerlock', true); return; }
    try {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => this._lockFailed());
    } catch (err) { this._lockFailed(); }
  }
  isDown(code) { return this.keys.has(code) || this.virtual.has(code); }
  pressKey(code) { this.pressed.add(code); }   // pulsación puntual (botones táctiles)
  wasPressed(code) { return this.pressed.has(code); }
  consume() { this.pressed.clear(); this.mouse.leftPressed = false; }
  endFrame() { this.pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.leftPressed = false; }
}

export { InputManager };
