// Tienda del trampero: vender pieles y comprar munición/mejoras. Catálogo en data/shop.json.
class ShopSystem {
  constructor(game, catalog) {
    this.game = game; this.catalog = catalog; this.isOpen = false; this.npc = null;
  }
  _def(id) { return this.game.story.items[id] || { name: id, icon: '•', desc: '' }; }
  view() {
    const g = this.game, inv = g.inventory;
    return {
      title: this.catalog.title, greeting: this.catalog.greeting, money: inv.money,
      sell: this.catalog.sell.map((s) => ({ ...s, ...this._def(s.id), id: s.id, count: inv.count(s.id) })),
      buy: this.catalog.buy.map((b) => ({ ...b, owned: !!b.upgrade && g.upgrades.has(b.upgrade), affordable: inv.money >= b.price - 1e-6 })),
    };
  }
  open(npc) {
    const g = this.game;
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
    if (item.upgrade && g.upgrades.has(item.upgrade)) { g.ui.notify('Ya tienes esta mejora', item.name); return; }
    if (g.inventory.money < item.price - 1e-6) { g.ui.notify('No te alcanza', `Necesitas $${item.price.toFixed(2)}`); g.audio.playDryFire(); return; }
    g.inventory.addMoney(-item.price);
    Object.entries(item.give || {}).forEach(([k, n]) => g.inventory.add(k, n, true));
    if (item.upgrade) g.upgrades.add(item.upgrade);
    g.audio.playCash();
    g.ui.notify(`Comprado: ${item.name}`, `-$${item.price.toFixed(2)}`);
  }
}

export { ShopSystem };
