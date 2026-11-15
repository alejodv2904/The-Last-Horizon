// Object pooling genérico. Evita crear/destruir objetos en caliente (balas, partículas, rastros, impactos):
// los objetos se reservan una vez, se reutilizan y nunca llegan al recolector de basura durante la partida.
//
//   const pool = new ObjectPool(() => ({ x: 0, alive: false }), (o) => { o.alive = false; }, 32);
//   const o = pool.acquire();   // null si el pool está lleno y no puede crecer
//   pool.release(o);
//
// `active` es una lista densa (swap-remove) para iterar solo lo que está vivo.
class ObjectPool {
  constructor(factory, reset = () => {}, size = 16, { growable = false, recycleOldest = false } = {}) {
    this.factory = factory; this.reset = reset; this.growable = growable; this.recycleOldest = recycleOldest;
    this.free = []; this.active = []; this.total = 0; this.acquired = 0; this.recycled = 0; this.misses = 0;
    for (let i = 0; i < size; i++) this.free.push(this._make());
  }
  _make() { const o = this.factory(); o.__poolIndex = -1; this.total++; return o; }
  // Devuelve un objeto reciclado. Si no quedan: crece (si se permite), recicla el más antiguo (si se pide) o devuelve null.
  acquire() {
    let o = this.free.pop();
    if (!o) {
      if (this.growable) o = this._make();
      else if (this.recycleOldest && this.active.length) { o = this.active[0]; this._detach(o); this.reset(o); this.recycled++; }
      else { this.misses++; return null; }
    }
    o.__poolIndex = this.active.length; this.active.push(o); this.acquired++;
    return o;
  }
  _detach(o) {
    const i = o.__poolIndex; if (i < 0) return false;
    const last = this.active.pop();
    if (last !== o) { this.active[i] = last; last.__poolIndex = i; }
    o.__poolIndex = -1; return true;
  }
  release(o) {
    if (!this._detach(o)) return;
    this.reset(o); this.free.push(o);
  }
  releaseAll() { while (this.active.length) this.release(this.active[this.active.length - 1]); }
  get activeCount() { return this.active.length; }
  get stats() { return { total: this.total, active: this.active.length, free: this.free.length, acquired: this.acquired, recycled: this.recycled, misses: this.misses }; }
}

export { ObjectPool };
