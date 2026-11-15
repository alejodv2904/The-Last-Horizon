// Guardado automático en localStorage (dinero, inventario, mejoras, misiones, posición, hora).
// Todas las lecturas/escrituras van en try/catch: en modo privado o con almacenamiento bloqueado
// el juego sigue funcionando, simplemente sin persistencia.
import { CONFIG } from '../core/Config.js';

const VERSION = 3;   // v3 añade honor, recompensa y contratos; las partidas v2 siguen cargándose

class SaveSystem {
  constructor(game) { this.game = game; this.key = CONFIG.SAVE_KEY; this.timer = 0; this.enabled = true; }
  hasSave() { try { return !!localStorage.getItem(this.key); } catch (e) { return false; } }
  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && (data.v === VERSION || data.v === 2) ? data : null;
    } catch (e) { return null; }
  }
  clear() { try { localStorage.removeItem(this.key); } catch (e) { /* almacenamiento no disponible */ } }
  serialize() {
    const g = this.game, p = g.player, h = g.horse;
    return {
      v: VERSION, savedAt: Date.now(),
      inventory: g.inventory.toJSON(),
      upgrades: [...g.upgrades],
      missions: g.missions.toJSON(),
      honor: g.honor.toJSON(), law: g.law.toJSON(), bounties: g.bounties.toJSON(),
      hints: [...g.hints],
      player: { x: p.position.x, z: p.position.z, yaw: p.yaw, health: p.health, mag: p.mag, riding: p.riding },
      horse: { x: h.position.x, z: h.position.z, heading: h.heading, stamina: h.stamina },
      hour: g.world.time.hour,
    };
  }
  save() {
    const g = this.game;
    if (!this.enabled || !g.started || g.mode === 'dead') return false;
    try {
      localStorage.setItem(this.key, JSON.stringify(this.serialize()));
      g.ui.flashSaved();
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
    g.honor.fromJSON(d.honor); g.law.fromJSON(d.law); g.bounties.fromJSON(d.bounties);
    if (typeof d.hour === 'number') g.world.time.hour = d.hour;
    if (d.horse) {
      const h = g.horse;
      h.position.set(d.horse.x, g.world.getHeightAt(d.horse.x, d.horse.z), d.horse.z);
      h.heading = d.horse.heading || 0; h.stamina = d.horse.stamina ?? 100;
    }
    if (d.player) {
      const p = g.player;
      p.position.set(d.player.x, g.world.getHeightAt(d.player.x, d.player.z), d.player.z);
      p.yaw = d.player.yaw || 0; p.heading = p.yaw;
      p.health = Math.max(30, d.player.health ?? 100);
      p.mag = d.player.mag ?? p.mag;
      if (d.player.riding) { g.horse.position.copy(p.position); p.mountHorse(); }
    }
    g.world.chunks.update(g.player.position, true);
  }
  update(dt) {
    this.timer += dt;
    if (this.timer >= CONFIG.AUTOSAVE_SECONDS) { this.timer = 0; this.save(); }
  }
}

export { SaveSystem };
