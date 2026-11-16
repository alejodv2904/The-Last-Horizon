// Gestor del ecosistema: percepción (ruido del jugador), eventos (disparos, bajas) y LOD de IA.
// Los animales más allá de AI_ACTIVE_RADIUS "duermen": no se mueven ni se animan, solo esperan.
import { CONFIG } from '../core/Config.js';
import { distXZ, mulberry32 } from '../core/MathUtils.js';
import { Deer, DEER_STATE } from './Deer.js';
import { Wolf } from './Wolf.js';
import { makeAnimal } from './SpeciesVariants.js';

class WildlifeAI {
  constructor(game) {
    this.game = game;
    const rand = mulberry32(2024); this._rand = mulberry32(7771);
    this.deer = []; this.wolves = [];
    CONFIG.HERDS.forEach((h) => { for (let i = 0; i < h.count; i++) this.deer.push(new Deer(game, h, rand)); });
    CONFIG.WOLF_PACKS.forEach((p) => { for (let i = 0; i < p.count; i++) this.wolves.push(new Wolf(game, p, i, rand)); });
    this.animals = [...this.deer, ...this.wolves];
    game.bus.on('gunshot', (e) => this.onGunshot(e.position));
    game.bus.on('animal:killed', (a) => this.onAnimalKilled(a));
    this._ctx = { playerPos: null, noiseRadius: 14, playerRunning: false, animate: true, dist: 0, night: 0, mounted: false, horseSpeed: 0, playerDead: false };
    this.activeCount = 0;
  }

  update(dt) {
    const g = this.game, p = g.player, ctx = this._ctx, H = CONFIG.HORSE;
    ctx.playerPos = p.position; ctx.playerRunning = p.isRunning || (p.mounted && g.horse.speed > H.TROT + 1);
    ctx.mounted = p.mounted; ctx.horseSpeed = g.horse.speed; ctx.night = g.world.time.state.night; ctx.playerDead = g.mode === 'dead';
    if (p.mounted) ctx.noiseRadius = g.horse.speed > H.CANTER ? 60 : g.horse.speed > H.WALK + 0.5 ? 30 : 18;
    else ctx.noiseRadius = p.isRunning ? 38 : p.isAiming ? 6 : p.isMoving ? 14 : 7;
    let active = 0;
    for (const a of this.animals) {
      const dist = distXZ(a.position, p.position);
      ctx.dist = dist;
      a.model.root.visible = dist < 230;
      if (dist > CONFIG.AI_ACTIVE_RADIUS && a.alive) continue;
      active++;
      ctx.animate = dist < 170;
      a.update(dt, ctx);
    }
    this.activeCount = active;
  }

  // Fauna de misión (campaña): nace en (x, z) y se añade a las listas de IA. Devuelve los animales creados.
  spawnTemp(species, x, z, count = 1) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = makeAnimal(this.game, species, x + (Math.random() - 0.5) * 16, z + (Math.random() - 0.5) * 16, this._rand);
      this.animals.push(a); (a.radarKind === 'wolf' || a.species === 'wolf' ? this.wolves : this.deer).push(a); out.push(a);
    }
    return out;
  }
  despawnTemp(list) {
    for (const a of list) {
      for (const arr of [this.animals, this.deer, this.wolves]) { const i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); }
      this.game.scene.remove(a.model.root); a.model.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      if (a._tintMat) a._tintMat.dispose();
    }
  }

  onGunshot(pos) {
    for (const d of this.deer) {
      if (!d.alive) continue;
      const dist = distXZ(d.position, pos);
      if (dist < 140) d.scheduleFlee(pos, dist / 340 + Math.random() * 0.3);
    }
    for (const w of this.wolves) {
      const dist = distXZ(w.position, pos);
      if (dist < 140) w.onGunshot(pos, dist);
    }
  }
  onAnimalKilled(a) {
    if (a.species !== 'wolf') return;
    for (const w of this.wolves) if (w !== a && w.pack === a.pack) w.onPackmateDied();
  }
  propagateFlee(source) {
    for (const d of this.deer) {
      if (d === source || !d.alive || d.state === DEER_STATE.FLEE) continue;
      if (distXZ(d.position, source.position) < 30) d.scheduleFlee(this.game.player.position, 0.2 + Math.random() * 0.5);
    }
  }
  // Se actualizan las matrices solo de los animales candidatos (barato) para que el disparo use su pose actual.
  getHitboxes() {
    return this.animals.filter((a) => a.alive && a.model.root.visible).map((a) => { a.model.root.updateMatrixWorld(true); return a.model.hitbox; });
  }
  getNearestCarcass(pos, maxDist) {
    let best = null, bestD = maxDist;
    for (const a of this.animals) {
      if (a.alive || a.skinned || a.deathT < 1) continue;
      const c = a.getCenter(a._tmp), dist = distXZ(c, pos);
      if (dist < bestD) { bestD = dist; best = a; }
    }
    return best;
  }
  getTrackables() { return this.animals.map((a) => ({ entity: a, species: a.species, alive: a.alive || a.skinned })); } // cadáveres sin despellejar: alive=false → marcador }
  setHighlight(on) { for (const a of this.animals) a.setHighlight(on); }
  nearbyThreat(pos, r) { return this.wolves.some((w) => w.alive && w.state === 'attack' && distXZ(w.position, pos) < r); }
}

export { WildlifeAI };
