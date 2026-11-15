// Campamento base (estilo RDR2): fondos, moral, mejoras permanentes y regalos de los compañeros.
//   Caja de Contribuciones → donar dinero o pieles (suben los fondos y la moral).
//   Libro de Contabilidad  → gastar los fondos en mejoras: Carreta de Municiones, Botiquín, Tienda Mejorada.
//   Moral (0-100)          → baja despacio; alta = los compañeros regalan munición/tónicos o dan pistas de alijos.
import { CONFIG } from '../core/Config.js';
import { clamp, distXZ } from '../core/MathUtils.js';
import { Companion } from '../entities/Companion.js';

const L = CONFIG.CAMP_LIFE;

class CampSystem {
  constructor(game, data, life) {
    this.game = game; this.data = data; this.life = life; this.layout = life.layout; this.points = life.points;
    this.funds = 0; this.morale = L.FIRST_MORALE; this.donated = 0; this.upgrades = new Set();
    this.cd = {}; this.ammoCd = 0; this.medStock = 0; this.medT = 0; this.isOpen = false; this.mode = 'ledger';
    const ly = this.layout, cx = CONFIG.CAMP.x, cz = CONFIG.CAMP.z;
    this.companions = [
      new Companion(game, this, { id: 'tobias', palette: 'miner', role: 'woodcutter', x: ly.chop.x, z: ly.chop.z, seat: 0, tent: 0 }),
      new Companion(game, this, { id: 'rosa', palette: 'woman2', role: 'cook', x: ly.cook[0].x, z: ly.cook[0].z, seat: 1, tent: 1 }),
      new Companion(game, this, { id: 'jim', palette: 'townB', role: 'watch', x: ly.patrol[0].x, z: ly.patrol[0].z, seat: 2, tent: 1 }),
    ];
    game.bus.on('bounty:claimed', () => this.addMorale(3));
  }

  get tier() { return this.data.tiers.find((t) => this.morale <= t.max) || this.data.tiers[this.data.tiers.length - 1]; }
  addMorale(v) { this.morale = clamp(this.morale + v, 0, 100); }
  get capacity() { return L.BASE_CAPACITY + (this.upgrades.has('tent') ? L.TENT_CAPACITY : 0); }
  get fastTravel() { return this.upgrades.has('tent'); }
  nearCamp(pos) { return distXZ(pos, CONFIG.CAMP) < L.RADIUS; }

  /* ---------------- aportaciones y compras ---------------- */
  donate(amount) {
    const g = this.game;
    if (g.inventory.money < amount - 1e-6) { g.ui.notify('No te alcanza', `Necesitas $${amount}`); return; }
    g.inventory.addMoney(-amount); this.funds += amount; this.donated += amount; this.addMorale(Math.min(14, amount * 1.1));
    g.audio.playCash(); g.ui.notify(`Donaste $${amount}`, `Fondos del campamento: $${this.funds.toFixed(2)}`);
    this._thanks();
  }
  peltValue() {
    const inv = this.game.inventory; let n = 0, v = 0;
    for (const [id, price] of Object.entries(this.data.pelt)) { const c = inv.count(id); n += c; v += c * price; }
    return { n, value: Math.round(v * 100) / 100 };
  }
  donatePelts() {
    const g = this.game, pv = this.peltValue();
    if (!pv.n) { g.ui.notify('Sin pieles', 'Despelleja ciervos o lobos primero.'); return; }
    for (const id of Object.keys(this.data.pelt)) { const c = g.inventory.count(id); if (c) g.inventory.remove(id, c, true); }
    this.funds += pv.value; this.donated += pv.value; this.addMorale(Math.min(18, pv.value * 1.2));
    g.audio.playItem(); g.ui.notify(`Donaste ${pv.n} pieles`, `Valen $${pv.value.toFixed(2)} para el campamento.`);
    this._thanks();
  }
  _thanks() { const lines = ['Gracias, hijo. El campamento no lo olvida.', 'Eso alimentará a muchos esta semana.', 'Dios te lo pague, Eli.']; this.game.ui.bark('Silas Crane', lines[Math.floor(Math.random() * lines.length)]); }
  buy(id) {
    const g = this.game, up = this.data.upgrades.find((u) => u.id === id);
    if (!up || this.upgrades.has(id)) return;
    if (this.funds < up.cost - 1e-6) { g.ui.notify('Fondos insuficientes', `Faltan $${(up.cost - this.funds).toFixed(2)}. Dona en la caja.`); g.audio.playDryFire(); return; }
    this.funds -= up.cost; this.upgrades.add(id); this._apply();
    g.audio.playMissionComplete(); g.ui.banner('MEJORA DEL CAMPAMENTO', up.name, 4);
    this.addMorale(8);
    if (id === 'medkit') this.medStock = 1;
  }
  _apply() {
    const u = this.life.upgrades; for (const [id, mesh] of Object.entries(u)) mesh.visible = this.upgrades.has(id);
    this.game.inventory.capacity = this.capacity;
    if (this.game.ui.inventoryOpen) this.game.ui.renderInventory(this.game.inventory, this.game.upgrades);
  }

  /* ---------------- interacción en el campamento ---------------- */
  getInteraction(pos) {
    const P = this.points, u = this.upgrades;
    if (distXZ(pos, P.box) < 2.4) return { prompt: 'Caja de Contribuciones', action: () => this.open('box') };
    if (distXZ(pos, P.ledger) < 2.4) return { prompt: 'Libro de Contabilidad', action: () => this.open('ledger') };
    if (u.has('ammo_wagon') && distXZ(pos, P.wagon) < 2.8) {
      return { prompt: this.ammoCd > 0 ? `Carreta de Municiones (lista en ${Math.ceil(this.ammoCd)} s)` : 'Reponer munición (gratis)', action: () => this.restockAmmo() };
    }
    if (u.has('medkit') && distXZ(pos, P.med) < 2.4) return { prompt: `Botiquín: tomar un tónico (${this.medStock} en stock)`, action: () => this.takeTonic() };
    return null;
  }
  restockAmmo() {
    const g = this.game;
    if (this.ammoCd > 0) { g.ui.notify('La carreta se está reponiendo', `Espera ${Math.ceil(this.ammoCd)} s.`); return; }
    const have = g.inventory.count('ammo'), give = Math.max(0, 40 - have);
    if (!give) { g.ui.notify('Ya vas cargado', 'Tienes 40 cartuchos o más.'); return; }
    g.inventory.add('ammo', give); this.ammoCd = 60; g.audio.playReload(1.2, 4);
  }
  takeTonic() {
    const g = this.game;
    if (this.medStock < 1) { g.ui.notify('Botiquín vacío', 'Rosa repone uno cada 90 s.'); return; }
    if (g.inventory.count('tonic') >= 3) { g.ui.notify('Ya llevas suficientes', 'Con 3 tónicos vas bien servido.'); return; }
    this.medStock--; g.inventory.add('tonic', 1); g.audio.playItem();
  }

  open(mode) {
    const g = this.game;
    this.isOpen = true; this.mode = mode; g.setMode('camp'); g.input.exitLock();
    g.ui.showCamp(this.view(), (a, id) => this.handle(a, id)); g.audio.playUI();
  }
  close() {
    if (!this.isOpen) return;
    const g = this.game;
    this.isOpen = false; g.ui.hideCamp(); g.setMode('explore'); g.input.requestLock(); g.save.save();
  }
  handle(action, id) {
    if (action === 'close') { this.close(); return; }
    if (action === 'donate') this.donate(Number(id));
    else if (action === 'donatePelts') this.donatePelts();
    else if (action === 'buy') this.buy(id);
    this.game.ui.renderCamp(this.view());
  }
  view() {
    const g = this.game, pv = this.peltValue();
    return {
      mode: this.mode, name: this.data.name, money: g.inventory.money, funds: this.funds, donated: this.donated, morale: this.morale, tier: this.tier.name,
      pelts: pv, capacity: this.capacity,
      upgrades: this.data.upgrades.map((u) => ({ ...u, owned: this.upgrades.has(u.id), affordable: this.funds >= u.cost - 1e-6 })),
    };
  }

  /* ---------------- regalos de los compañeros ---------------- */
  giftReady(id) {
    const g = this.data.gifts[id]; if (!g || this.morale < 65) return false;
    if ((this.cd[id] || 0) > this.game.elapsed) return false;
    return g.type !== 'tip' || this.game.treasure.unrevealed.length > 0;
  }
  giveGift(id) {
    const g = this.game, cfg = this.data.gifts[id];
    if (!cfg || !this.giftReady(id)) return;
    this.cd[id] = g.elapsed + cfg.cooldown;
    if (cfg.type === 'ammo') g.inventory.add('ammo', cfg.amount);
    else if (cfg.type === 'item') g.inventory.add(cfg.id, cfg.amount);
    else if (cfg.type === 'tip') g.treasure.reveal();
  }

  applyFlag(f) { if (f === 'camp_fed') this.addMorale(10); }
  update(dt) {
    this.morale = Math.max(20, this.morale - dt / 90);
    this.ammoCd = Math.max(0, this.ammoCd - dt);
    if (this.upgrades.has('medkit')) { this.medT += dt; if (this.medT >= 90) { this.medT = 0; this.medStock = Math.min(3, this.medStock + 1); } }
    const near = this.nearCamp(this.game.player.position);
    this.game.ui.setMorale(near, this.morale, this.tier.name);
  }
  toJSON() { return { funds: this.funds, morale: this.morale, donated: this.donated, upgrades: [...this.upgrades], medStock: this.medStock }; }
  fromJSON(d) {
    if (!d) return;
    this.funds = Number(d.funds) || 0; this.morale = clamp(Number(d.morale) || L.FIRST_MORALE, 0, 100); this.donated = Number(d.donated) || 0; this.medStock = d.medStock || 0;
    this.upgrades = new Set((d.upgrades || []).filter((id) => this.data.upgrades.some((u) => u.id === id)));
    this._apply();
  }
}

export { CampSystem };
