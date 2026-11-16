// Ajustes del jugador (volúmenes, calidad gráfica, ranura activa) guardados en localStorage.
// Los presets de calidad deciden: resolución, distancia de chunks, niebla, densidad de vegetación (InstancedMesh),
// sombras y radio de la IA. Todo lo que el juego puede "bajar" para llegar a 60 FPS en equipos modestos vive aquí.
const SETTINGS_KEY = 'thelasthorizon.settings.v1';

const QUALITY = {
  low: {
    id: 'low', label: 'Baja', pixelMax: 0.8, pixelMin: 0.5, viewDist: 105, fogMul: 2.3, veg: 0.3, shadows: false, shadowSize: 512,
    npcView: 90, aiRadius: 190, particles: 0.5, musicLayers: 2,
  },
  medium: {
    id: 'medium', label: 'Media', pixelMax: 1.0, pixelMin: 0.6, viewDist: 150, fogMul: 1.45, veg: 0.65, shadows: true, shadowSize: 1024,
    npcView: 125, aiRadius: 260, particles: 0.8, musicLayers: 3,
  },
  high: {
    id: 'high', label: 'Alta', pixelMax: 1.25, pixelMin: 0.6, viewDist: 230, fogMul: 1.0, veg: 1.0, shadows: true, shadowSize: 2048,
    npcView: 150, aiRadius: 320, particles: 1.0, musicLayers: 4,
  },
};

const DEFAULTS = { music: 0.7, sfx: 0.85, ambient: 0.8, quality: 'medium', activeSlot: 1, showFps: true };

class Settings {
  constructor() { this.data = { ...DEFAULTS }; this.listeners = new Set(); this.load(); }
  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) { const d = JSON.parse(raw); Object.keys(DEFAULTS).forEach((k) => { if (d[k] !== undefined && typeof d[k] === typeof DEFAULTS[k]) this.data[k] = d[k]; }); }
    } catch (e) { /* ajustes por defecto */ }
    if (!QUALITY[this.data.quality]) this.data.quality = DEFAULTS.quality;
    ['music', 'sfx', 'ambient'].forEach((k) => { this.data[k] = Math.min(1, Math.max(0, Number(this.data[k]))); });
    this.data.activeSlot = [1, 2, 3].includes(this.data.activeSlot) ? this.data.activeSlot : 1;
  }
  save() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data)); } catch (e) { /* almacenamiento no disponible */ } }
  get(k) { return this.data[k]; }
  set(k, v) {
    if (this.data[k] === v) return;
    this.data[k] = v; this.save();
    this.listeners.forEach((fn) => fn(k, v));
  }
  get quality() { return QUALITY[this.data.quality]; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export { Settings, QUALITY, DEFAULTS, SETTINGS_KEY };
