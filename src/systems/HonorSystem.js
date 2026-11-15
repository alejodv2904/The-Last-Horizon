// Honor y reputación (estilo RDR2). Valor en [-100, 100]. De él dependen: descuentos en tiendas, los saludos de los
// ciudadanos y algunos diálogos. Los umbrales, descuentos y recompensas por acción viven en data/town.json.
import { clamp } from '../core/MathUtils.js';

class HonorSystem {
  constructor(game, cfg) {
    this.game = game; this.cfg = cfg; this.value = 0; this.tiers = cfg.tiers;
    this.greetCd = new Map();
    this._last = null;
  }
  get tier() { return this.tiers.find((t) => this.value <= t.max) || this.tiers[this.tiers.length - 1]; }
  get ratio() { return (this.value + 100) / 200; }
  deed(name) { return this.cfg.deeds[name] || 0; }
  add(delta, reason = '') {
    if (!delta) return;
    const before = this.tier.id;
    this.value = clamp(this.value + delta, -100, 100);
    const g = this.game, shown = Math.abs(delta) >= 1 ? `${delta > 0 ? '+' : ''}${Math.round(delta)}` : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
    g.ui.honorDelta(shown, delta > 0);
    if (Math.abs(delta) >= 1) { g.ui.notify(delta > 0 ? 'Tu honor aumenta' : 'Tu honor disminuye', reason ? `${reason} (${shown})` : shown); g.audio.playHonor(delta > 0); }
    if (this.tier.id !== before) g.ui.notify(`Reputación: ${this.tier.name}`, delta > 0 ? 'La gente empieza a verte distinto.' : 'La gente empieza a temerte.');
    g.bus.emit('honor:changed', this.value);
  }
  // multiplicador de precios de compra: 0.88 (honorable) … 1.2 (forajido)
  priceMultiplier() { return 1 - (this.cfg.discount[this.tier.id] || 0); }
  pick(group) { const l = group[this.tier.id] || group.neutral; return l[Math.floor(Math.random() * l.length)]; }
  greeting() { return this.pick(this.game.townData.greetings); }
  reply() { return this.pick(this.game.townData.replies); }
  // Saludar a un ciudadano (una vez cada 90 s por persona) da un poco de honor.
  canGreet(id) { return (this.greetCd.get(id) || 0) <= this.game.elapsed; }
  greeted(id) { this.greetCd.set(id, this.game.elapsed + 90); this.add(this.deed('greet'), 'Saludo'); }
  toJSON() { return { value: this.value }; }
  fromJSON(d) { if (d && typeof d.value === 'number') this.value = clamp(d.value, -100, 100); }
}

export { HonorSystem };
