// Tiendas: vender pieles y comprar munición/mejoras/tónicos. Catálogos en data/*.json (uno por comerciante).
// Fase 3: el Honor modifica los precios de compra (descuento si eres respetado, recargo si tienes mala fama)
// y la tendera no atiende a quien tiene una recompensa por su cabeza.
class ShopSystem {
  constructor(game, catalogs) {
    this.game = game; this.catalogs = catalogs; this.catalog = Object.values(catalogs)[0]; this.isOpen = false; this.npc = null;
  }
  _def(id) { return this.game.story.items[id] || { name: id, icon: '•', desc: '' }; }
  _mul() { return this.game.honor.priceMultiplier(); }
  _price(b) { return Math.round(b.price * this._mul() * 100) / 100; }
  view() {
    const g = this.game, inv = g.inventory, mul = this._mul();
    const pct = Math.round((1 - mul) * 100);
    return {
      title: this.catalog.title, greeting: this.catalog.greeting, money: inv.money,
      note: pct > 0 ? `Honor «${g.honor.tier.name}»: ${pct} % de descuento` : pct < 0 ? `Mala fama «${g.honor.tier.name}»: recargo del ${-pct} %` : '',
      sell: this.catalog.sell.map((s) => ({ ...s, ...this._def(s.id), id: s.id, count: inv.count(s.id) })),
      buy: this.catalog.buy.map((b) => ({ ...b, price: this._price(b), owned: !!b.upgrade && g.upgrades.has(b.upgrade), affordable: inv.money >= this._price(b) - 1e-6 })),
    };
  }
  open(npc) {
    const g = this.game, cat = this.catalogs[npc.shopId || npc.id];
    if (!cat) return;
    if (npc.id === 'hattie' && g.law.level > 0) { g.ui.bark(npc.name, 'No atiendo a quien busca el sheriff. Pague su recompensa primero.'); return; }
    this.catalog = cat;
    const rw = npc.id === 'hattie' && g.encounters.pendingShopReward ? g.encounters.data.snake.shopGift : null;   // futura recompensa del viajero
    if (rw) {
      g.encounters.pendingShopReward = false;
      g.inventory.addMoney(rw.money); Object.entries(rw.items).forEach(([k, n]) => g.inventory.add(k, n, true));
      g.ui.banner('RECOMPENSA DE LA TIENDA', rw.text, 5); g.audio.playMissionComplete();
    }
    this.isOpen = true; this.npc = npc; npc.talking = true;
    g.setMode('shop');
    g.input.exitLock();
    g.ui.showShop(this.view(), (action, id) => this.handle(action, id));
    g.audio.playUI();
  }
  close() {
    if (!this.isOpen) return;
    const g = this.game;
    this.isOpen = false; if (this.npc) this.npc.talking = false;
    g.ui.hideShop();
    g.setMode('explore');
    g.input.requestLock();
    g.save.save();
  }
  handle(action, id) {
    if (action === 'close') this.close();
    else if (action === 'sell') this.sell(id);
    else if (action === 'sellAll') this.catalog.sell.filter((s) => s.id !== 'venison').forEach((s) => this.sell(s.id, true));
    else if (action === 'buy') this.buy(id);
    this.game.ui.renderShop(this.view());
  }
  sell(id, quiet = false) {
    const g = this.game, entry = this.catalog.sell.find((s) => s.id === id);
    const n = g.inventory.count(id);
    if (!entry || n <= 0) { if (!quiet) g.ui.notify('Nada que vender', this._def(id).name); return; }
    const total = Math.round(entry.price * n * 100) / 100;
    g.inventory.remove(id, n, true);
    g.inventory.addMoney(total);
    g.audio.playCash();
    g.ui.notify(`Vendido: ${n} × ${this._def(id).name}`, `+$${total.toFixed(2)}`);
  }
  buy(id) {
    const g = this.game, item = this.catalog.buy.find((b) => b.id === id);
    if (!item) return;
    const price = this._price(item);
    if (item.upgrade && g.upgrades.has(item.upgrade)) { g.ui.notify('Ya tienes esta mejora', item.name); return; }
    if (g.inventory.money < price - 1e-6) { g.ui.notify('No te alcanza', `Necesitas $${price.toFixed(2)}`); g.audio.playDryFire(); return; }
    g.inventory.addMoney(-price);
    Object.entries(item.give || {}).forEach(([k, n]) => g.inventory.add(k, n, true));
    if (item.upgrade) g.upgrades.add(item.upgrade);
    g.audio.playCash();
    g.ui.notify(`Comprado: ${item.name}`, `-$${price.toFixed(2)}`);
  }
}

export { ShopSystem };
