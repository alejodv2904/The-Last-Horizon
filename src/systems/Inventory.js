class Inventory {
  constructor(bus, defs) { this.bus = bus; this.defs = defs; this.items = new Map(); this.money = 4.5; }
  count(id) { return this.items.get(id) || 0; }
  add(id, n = 1, silent = false) {
    this.items.set(id, this.count(id) + n);
    this.bus.emit('inventory:changed', { id, delta: n, silent });
  }
  remove(id, n = 1, silent = false) {
    const c = this.count(id), take = Math.min(c, n);
    if (c - take <= 0) this.items.delete(id); else this.items.set(id, c - take);
    this.bus.emit('inventory:changed', { id, delta: -take, silent });
    return take;
  }
  addMoney(v) { this.money += v; this.bus.emit('inventory:changed', { id: 'money', delta: v, silent: true }); }
  toJSON() { return { money: this.money, items: Object.fromEntries(this.items) }; }
  fromJSON(data) {
    if (!data) return;
    this.money = Number(data.money) || 0;
    this.items = new Map(Object.entries(data.items || {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => [k, Number(n)]));
    this.bus.emit('inventory:changed', { id: 'load', delta: 0, silent: true });
  }
}

export { Inventory };
