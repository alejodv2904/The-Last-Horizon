// Guardado en localStorage con 3 ranuras (más exportar/importar .json).
// Cada ranura guarda el estado completo (inventario, misiones, campaña, honor, posición, hora…) y un resumen ("meta") que el menú
// muestra sin cargar la partida: capítulo, misión, dinero, honor y porcentaje total (0-100 %).
// Todas las lecturas/escrituras van en try/catch: en modo privado o con almacenamiento bloqueado el juego sigue, sin persistencia.
import { CONFIG } from '../core/Config.js';

const VERSION = 4;                 // v4: campaña, Dead Eye y ranuras; las v2/v3 (una sola partida) se migran a la ranura 1
const SLOTS = [1, 2, 3];
const slotKey = (n) => `thelasthorizon.save.slot${n}`;

class SaveSystem {
  constructor(game) { this.game = game; this.timer = 0; this.enabled = true; this._migrate(); }
  get slot() { return this.game.settings.get('activeSlot'); }
  set slot(n) { if (SLOTS.includes(n)) this.game.settings.set('activeSlot', n); }

  // Partida antigua (clave única de la Fase 4): se copia a la ranura 1 si está libre. El original se conserva.
  _migrate() {
    try {
      const old = localStorage.getItem(CONFIG.SAVE_KEY);
      if (old && !localStorage.getItem(slotKey(1)) && !localStorage.getItem('thelasthorizon.migrated')) { localStorage.setItem(slotKey(1), old); localStorage.setItem('thelasthorizon.migrated', '1'); }
    } catch (e) { /* sin almacenamiento */ }
  }
  hasSave(n = this.slot) { try { return !!localStorage.getItem(slotKey(n)); } catch (e) { return false; } }
  load(n = this.slot) {
    try {
      const raw = localStorage.getItem(slotKey(n)); if (!raw) return null;
      const d = JSON.parse(raw);
      return d && (d.v === VERSION || d.v === 3 || d.v === 2) ? d : null;
    } catch (e) { return null; }
  }
  clear(n = this.slot) { try { localStorage.removeItem(slotKey(n)); } catch (e) { /* almacenamiento no disponible */ } }

  // Resumen de las 3 ranuras para el menú.
  slotsInfo() {
    return SLOTS.map((n) => {
      const d = this.load(n);
      if (!d) return { slot: n, empty: true };
      const m = d.meta || {};
      return {
        slot: n, empty: false, chapter: m.chapter || 'Capítulo I (partida anterior)', mission: m.mission || '—',
        money: m.money ?? (d.inventory ? d.inventory.money : 0), honorValue: m.honorValue ?? (d.honor ? d.honor.value : 0), honorTier: m.honorTier || '—',
        percent: m.percent ?? 0, savedAt: d.savedAt || 0, playTime: m.playTime || 0,
      };
    });
  }

  serialize() {
    const g = this.game, p = g.player, h = g.horse, c = g.campaign, sum = c.summary();
    return {
      v: VERSION, savedAt: Date.now(),
      meta: { chapter: sum.chapter, mission: sum.mission, percent: sum.percent, money: g.inventory.money, honorValue: Math.round(g.honor.value), honorTier: g.honor.tier.name, playTime: Math.round(c.playTime) },
      inventory: g.inventory.toJSON(),
      upgrades: [...g.upgrades],
      missions: g.missions.toJSON(),
      campaign: c.toJSON(), deadEye: g.deadEye.toJSON(),
      honor: g.honor.toJSON(), law: g.law.toJSON(), bounties: g.bounties.toJSON(),
      hints: [...g.hints],
      player: { x: p.position.x, z: p.position.z, yaw: p.yaw, health: p.health, mag: p.mag, riding: p.riding },
      horse: { x: h.position.x, z: h.position.z, heading: h.heading, stamina: h.stamina },
      hour: g.world.time.hour,
    };
  }
  save(n = this.slot) {
    const g = this.game;
    if (!this.enabled || !g.started || g.mode === 'dead' || g.mode === 'duel') return false;
    try {
      localStorage.setItem(slotKey(n), JSON.stringify(this.serialize()));
      g.ui.flashSaved();
      if (g.menu) g.menu.refreshSlots();
      return true;
    } catch (e) { return false; }
  }
  apply(d) {
    const g = this.game;
    if (!d) return;
    g.inventory.fromJSON(d.inventory);
    g.upgrades = new Set(d.upgrades || []);
    (d.hints || []).forEach((h) => g.hints.add(h));
    g.missions.fromJSON(d.missions);
    g.honor.fromJSON(d.honor); g.law.fromJSON(d.law); g.bounties.fromJSON(d.bounties); g.deadEye.fromJSON(d.deadEye);
    if (typeof d.hour === 'number') g.world.time.hour = d.hour;
    if (d.horse) {
      const h = g.horse;
      h.position.set(d.horse.x, g.world.getHeightAt(d.horse.x, d.horse.z), d.horse.z);
      h.heading = d.horse.heading || 0; h.stamina = d.horse.stamina ?? 100;
    }
    if (d.campaign) g.campaign.fromJSON(d.campaign);   // antes del jugador: puede cambiar el aspecto y el mundo (campamento, modo infinito)
    if (d.player) {
      const p = g.player;
      p.position.set(d.player.x, g.world.getHeightAt(d.player.x, d.player.z), d.player.z);
      p.yaw = d.player.yaw || 0; p.heading = p.yaw;
      p.health = Math.max(30, d.player.health ?? 100);
      p.mag = d.player.mag ?? p.mag;
      if (d.player.riding) { g.horse.position.copy(p.position); p.mountHorse(); }
    }
    if (!d.campaign) g.campaign.fromJSON(null);   // partida de la Fase 4: la campaña empieza desde el principio
    g.world.chunks.update(g.player.position, true);
  }
  update(dt) {
    this.timer += dt;
    if (this.timer >= CONFIG.AUTOSAVE_SECONDS) { this.timer = 0; this.save(); }
  }

  /* ---------- Exportar / importar ---------- */
  exportSlot(n) {
    const raw = (() => { try { return localStorage.getItem(slotKey(n)); } catch (e) { return null; } })();
    if (!raw) return false;
    const blob = new Blob([raw], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `thelasthorizon-ranura${n}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }
  // Valida y escribe una partida importada en la ranura n. Devuelve { ok, error? }.
  importSlot(n, text) {
    let d;
    try { d = JSON.parse(text); } catch (e) { return { ok: false, error: 'El archivo no es un JSON válido.' }; }
    if (!d || typeof d !== 'object' || ![2, 3, 4].includes(d.v)) return { ok: false, error: 'No es una partida de The Last Horizon (versión no reconocida).' };
    if (!d.inventory || typeof d.inventory !== 'object' || !d.player || typeof d.player.x !== 'number' || typeof d.player.z !== 'number') return { ok: false, error: 'La partida está incompleta o dañada.' };
    try { localStorage.setItem(slotKey(n), JSON.stringify(d)); } catch (e) { return { ok: false, error: 'No se pudo guardar (almacenamiento lleno o bloqueado).' }; }
    return { ok: true };
  }
}

export { SaveSystem, SLOTS };
