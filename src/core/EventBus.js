class EventBus {
  constructor() { this.map = new Map(); }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(fn);
    return () => this.map.get(evt).delete(fn);
  }
  emit(evt, payload) { const set = this.map.get(evt); if (set) for (const fn of set) fn(payload); }
}

export { EventBus };
