class Inventory {
  constructor(bus, defs) { this.bus = bus; this.defs = defs; this.items = new Map(); this.money = 4.5; this.capacity = 16; }
  count(id) { return this.items.get(id) || 0; }
  // La munición y las pruebas de contratos no ocupan espacio. La Tienda Mejorada del campamento amplía la capacidad.
  static exempt(id) { return id === 'ammo' || id.startsWith('proof_'); }
  get carried() { let n = 0; for (const [id, c] of this.items) if (!Inventory.exempt(id)) n += c; return n; }
  add(id, n = 1, silent = false) {
    if (!Inventory.exempt(id)) {
      const room = this.capacity - this.carried;
      if (room < n) { this.bus.emit('inventory:full', { id, lost: n - Math.max(0, room) }); n = Math.max(0, room); if (n === 0) return 0; }
    }
    this.items.set(id, this.count(id) + n);
    this.bus.emit('inventory:changed', { id, delta: n, silent });
    return n;
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
