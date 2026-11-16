// Intérpretes de objetivos de campaign.js. Un objetivo es DATOS ({ type, text, location, count, species… }); aquí vive
// el único código que sabe jugarlos. 15 tipos de campaña se reducen a 10 comportamientos reutilizables:
//
//   travel · ride · escort ───────► ReachHandler    llegar a un lugar (con escoltas, perseguidores o paradas)
//   talk ─────────────────────────► TalkHandler     hablar con un PNJ
//   collect ──────────────────────► CollectHandler  reunir objetos del mundo
//   hunt ─────────────────────────► HuntHandler     cazar una especie concreta (con tiempo límite opcional)
//   stealth ──────────────────────► StealthHandler  infiltrarse / observar sin ser detectado
//   eliminate · defend ───────────► CombatHandler   oleadas de enemigos (con aliados que disparan)
//   survive ──────────────────────► SurviveHandler  resistir un peligro (frío, calor, tormenta, emboscada…)
//   duel ─────────────────────────► DuelHandler     duelo 1v1 (usa DuelSystem)
//   choice ───────────────────────► ChoiceHandler   decisión moral ramificada (flags, Honor, coste, recompensa)
//   interact · craft ─────────────► InteractHandler acción mantenida en un punto o sobre un PNJ
//   shoot ────────────────────────► ShootHandler    competición de tiro a blancos
//
// Contrato común (clase Handler): start() · update(dt) · destroy() · done · failed · label · waypoint() · interaction().
// El CampaignManager solo conoce ese contrato: añadir un tipo nuevo = registrar una clase en HANDLERS / TYPE_MAP.
import * as THREE from 'three';
import { distXZ } from '../core/MathUtils.js';
import { resolveLocation } from './LocationMap.js';
import { ALIAS, SPECIES } from '../ai/SpeciesVariants.js';

const firstSentence = (t) => (String(t).split(/(?<=[.!?…])\s/)[0] || String(t)).trim();
const SKILL = { boone: 0.55, lucas: 0.7, ezra: 0.7, sheriff: 0.74, garrity: 0.68, silas: 0.8, nate: 0.45, marlowe: 0.8 };
const THREAT = { 'frío': 'cold', 'herida y frío': 'cold', calor: 'heat', tormenta: 'storm', 'tormenta de arena': 'storm', fiebres: 'fever', incendio: 'fire', emboscada: 'ambush', redada: 'ambush', francotiradores: 'ambush', 'fuego federal': 'ambush', 'tensión': 'tension', derrumbe: 'collapse' };
const _v = new THREE.Vector3();

class Handler {
  constructor(cm, mission, obj, index) {
    this.cm = cm; this.m = mission; this.o = obj; this.idx = index; this.done = false; this.failed = false; this.t = 0; this.started = false;
  }
  get g() { return this.cm.game; }
  get dir() { return this.cm.director; }
  get locId() { return this.o.to || this.o.crossing || this.o.location || this.m.location; }
  get center() { return resolveLocation(this.locId, this.g.world); }
  get dist() { const c = this.center; return c ? distXZ(this.g.player.position, c) : 0; }
  get label() { return this.o.text + (this.progress ? ` · ${this.progress}` : ''); }
  get progress() { return ''; }
  start() { this.started = true; }
  update(dt) { this.t += dt; }
  destroy() {}
  waypoint() { const c = this.center; return c ? { x: c.x, z: c.z, kind: 'objective' } : null; }
  interaction() { return null; }
  // El jugador murió y reapareció: por defecto, el objetivo se reinicia.
  onRespawn() { this.instant = true; this.destroy(); this.instant = false; this.t = 0; this.done = false; this.start(); }
  finish() { this.done = true; }
}

/* ============================== travel · ride · escort ============================== */
class ReachHandler extends Handler {
  start() {
    super.start();
    const o = this.o, g = this.g, cm = this.cm;
    this.stops = o.stops || [this.locId]; this.si = 0; this.pursuers = [];
    this.exit = null;
    if (!o.to && !o.location && !o.stops && !o.crossing) {   // "huye", "escapa": salir del lugar de la misión hacia el campamento
      const l = resolveLocation(this.m.location, g.world), camp = g.world.firePos;
      const dx = camp.x - l.x, dz = camp.z - l.z, len = Math.hypot(dx, dz) || 1;
      this.exit = { x: l.x + dx / len * 90, z: l.z + dz / len * 90, r: 16 };
    }
    // El jugador empieza lejos de donde arranca la escena (p. ej. "Escapa de Silver Ridge"): corte a negro y traslado.
    if (o.from && cm.isFirstStep(this.idx)) {
      const f = resolveLocation(o.from, g.world);
      if (f && distXZ(g.player.position, f) > 150) cm.teleportPlayer(f.x + 6, f.z + 6, o.from === 'silver_ridge' ? 'Silver Ridge' : '');
    }
    const esc = Array.isArray(o.escort) ? o.escort.filter((id) => g.story.npcs[id]) : (o.type === 'escort' && o.npc ? [o.npc] : []);
    if (esc.length) this.dir.setCompanions(esc);
    if (o.pursuers) {   // perseguidores: aparecen detrás del jugador y lo atacan
      const p = g.player.position, h = g.player.riding ? g.horse.heading : g.player.heading;
      this.pursuers = this.dir.spawnGunmen(Math.min(o.pursuers, 6), p.x - Math.sin(h) * 55, p.z - Math.cos(h) * 55, { tag: `pur_${this.m.id}_${this.idx}`, minR: 4, maxR: 14 });
      g.ui.notify('¡Os persiguen!', 'Galopa o responde al fuego.');
    }
    if (o.type === 'ride' && !g.player.riding) g.ui.notify('A caballo', 'Silba a Ceniza con [H] y móntala con [F].');
  }
  get target() { return this.exit || resolveLocation(this.stops[this.si], this.g.world); }
  waypoint() { const t = this.target; return t ? { x: t.x, z: t.z, kind: 'objective' } : null; }
  update(dt) {
    super.update(dt);
    const t = this.target; if (!t) { this.finish(); return; }
    const r = t.r && this.exit ? t.r : Math.max(12, (t.r || 24) * 0.55);
    if (distXZ(this.g.player.position, t) < r && this.g.mode === 'explore') {
      if (++this.si >= this.stops.length || this.exit) this.finish();
      else this.g.ui.notify('Siguiente parada', this.stops[this.si].replace(/_/g, ' '));
    }
  }
  destroy() { if (this.o.escort || this.o.type === 'escort') this.dir.clearCompanions(); if (this.pursuers.length) this.dir.despawnGunmen(this.pursuers, this.instant ? 0 : 20000); }
}

/* ============================== talk ============================== */
class TalkHandler extends Handler {
  start() {
    super.start();
    const id = this.o.npc, g = this.g;
    this.last = this.cm.isLastStep(this.idx);
    if (id && id !== 'sheriff') {
      let n = this.dir.npc(id);
      if (!n) n = this.dir.ensureNPC(id, this.o.location || this.dir.homeOf(id, this.m.location), this.idx);
      else if (this.center && distXZ(n.position, this.center) > 150) {   // un miembro de la banda está lejos de la escena: se le traslada allí
        const a = this.dir.anchor(this.locId, this.idx, 4), p = g.player.position;
        n.setActive(true); n.moveTo(a.x, a.z, p.x, p.z); n.pinned = true;
      }
    }
    g.ui.notify('Habla con ' + ((g.story.npcs[id] && g.story.npcs[id].name) || id), '');
  }
  get npcPos() { const id = this.o.npc; if (id === 'sheriff') return this.g.law.sheriff.position; const n = this.cm.director.npc(id); return n && n.active ? n.position : null; }
  waypoint() { const p = this.npcPos; if (p) return { x: p.x, z: p.z, kind: 'npc' }; const c = this.center; return c ? { x: c.x, z: c.z, kind: 'objective' } : null; }
  // Entrada de diálogo para DialogueSystem.play cuando el jugador habla con el PNJ del objetivo.
  entry() {
    const o = this.o, m = this.m, id = o.npc;
    let lines;
    if (o.dialogue) lines = o.dialogue;
    else if (this.last && !this.cm.endingId) { lines = m.dialogueEnd; this.cm.endShown = true; }
    else lines = [{ speaker: id, text: firstSentence(m.description) }, { speaker: 'player', text: 'Entendido. Me pongo en marcha.' }];
    return { lines, onEnd: () => this.finish(), emotional: !!o.emotional };
  }
}

/* ============================== collect ============================== */
const NATURAL = new Set(['venison', 'deer_pelt', 'wolf_pelt']);   // se consiguen cazando/despellejando, no hace falta esparcirlos
class CollectHandler extends Handler {
  get item() { return this.o.item || (this.o.species === 'res' ? 'cattle_head' : null); }
  start() {
    super.start(); this.scattered = false;
    this.count = this.o.count || 1;
  }
  get have() { return this.g.inventory.count(this.item); }
  get progress() { return `${Math.min(this.have, this.count)}/${this.count}`; }
  update(dt) {
    super.update(dt);
    const g = this.g, c = this.center;
    // Los objetos se esparcen por la zona cuando el jugador se acerca (el botín usa un único InstancedMesh con pool).
    if (!this.scattered && c && this.dist < 150 && !NATURAL.has(this.item)) {
      this.scattered = true;
      const need = Math.max(0, this.count - this.have);
      for (let i = 0; i < need; i++) {
        const a = i * 2.39996 + 0.5, r = 6 + (i % 5) * 4 + Math.floor(i / 5) * 3;
        _v.set(c.x + Math.sin(a) * r, 0, c.z + Math.cos(a) * r); _v.y = g.world.getHeightAt(_v.x, _v.z);
        g.loot.drop(_v, [{ kind: 'item', id: this.item, n: 1 }]);
      }
    }
    if (this.have >= this.count) this.finish();
  }
  // Los objetos de carga se consumen al terminar (los documentos y llaves no).
  consume() { if (this.item && !['document', 'key', 'keepsake'].includes((this.g.story.items[this.item] || {}).type)) this.g.inventory.remove(this.item, this.count, true); }
  waypoint() { return this.scattered && this.o.item === 'lumber' ? null : super.waypoint(); }
}

/* ============================== hunt ============================== */
class HuntHandler extends Handler {
  start() {
    super.start();
    const o = this.o, g = this.g;
    this.sp = ALIAS[o.species] || o.species; this.kills = 0; this.animals = []; this.spawned = false; this.need = o.count || 1; this.hold = 0; this.time = o.timeLimitSeconds || 0; this.t0 = g.elapsed;
    this.off = g.bus.on('animal:killed', (a) => { if (a.species === this.sp) this.kills++; });
    if (o.tracking) g.ui.notify('Rastro', 'Pulsa [V] para el Instinto de cazador y sigue las huellas.');
  }
  get progress() { return this.o.observe ? '' : `${Math.min(this.kills, this.need)}/${this.need}` + (this.time ? ` · ${Math.max(0, Math.ceil(this.time - (this.g.elapsed - this.t0)))} s` : ''); }
  update(dt) {
    super.update(dt);
    const g = this.g, c = this.center, o = this.o;
    if (!this.spawned && c && this.dist < 175) {
      this.spawned = true;
      const n = o.observe ? Math.max(4, this.need) : this.need + (this.sp === 'deer' || this.sp === 'wolf' ? 1 : 0);
      this.animals = g.wildlife.spawnTemp(this.sp, c.x, c.z, n);
      if (o.boss && this.animals[0]) { this.animals[0].maxHp = this.animals[0].hp *= 1.3; this.animals[0].label = 'alfa'; }
    }
    if (o.observe) { if (c && this.dist < 55) { this.hold += dt; if (this.hold > 4) this.finish(); } else this.hold = 0; return; }
    if (this.time && g.elapsed - this.t0 > this.time) { this.t0 = g.elapsed; this.kills = 0; g.ui.notify('Tiempo agotado', 'Se reinicia la prueba: inténtalo de nuevo.'); }
    if (this.kills >= this.need) this.finish();
  }
  destroy() {
    if (this.off) this.off(); this.off = null;
    const dead = this.animals.filter((a) => !a.alive), live = this.animals.filter((a) => a.alive), w = this.g.wildlife;
    w.despawnTemp(live);
    if (dead.length) { if (this.instant) w.despawnTemp(dead); else setTimeout(() => w.despawnTemp(dead), 150000); }   // los cadáveres se pueden despellejar un buen rato
    this.animals = [];
  }
}

/* ============================== stealth ============================== */
// Infiltración: los vigilantes forman un anillo en torno al lugar y la meta está al otro lado (a 26 m del centro, opuesta a la
// entrada del jugador): hay que cruzar el recinto sin que la IA enemiga detecte al jugador. `observe`: aguantar 6 s a la vista del lugar.
class StealthHandler extends Handler {
  start() {
    super.start();
    this.guards = []; this.spawned = false; this.alerted = false; this.hold = 0; this.limit = this.o.detectionLimit === 'media' ? 2 : 1; this.goal = null;
    this.tag = `guard_${this.m.id}_${this.idx}`;
  }
  get progress() { return this.o.observe ? `${Math.min(6, Math.floor(this.hold))}/6` : (this.alerted ? '¡detectado!' : ''); }
  waypoint() { if (this.goal && !this.o.observe) return { x: this.goal.x, z: this.goal.z, kind: 'objective' }; return super.waypoint(); }
  update(dt) {
    super.update(dt);
    const g = this.g, c = this.center;
    if (!this.spawned && c && this.dist < 160) {
      this.spawned = true;
      const p = g.player.position, dx = c.x - p.x, dz = c.z - p.z, len = Math.hypot(dx, dz) || 1;
      this.goal = { x: c.x + dx / len * 26, z: c.z + dz / len * 26 };
      const n = Math.max(3, Math.min(this.o.observe ? 5 : 4, this.o.count || (this.o.observe ? 3 : 4)));   // pocos vigilantes bien repartidos: hay huecos por los que colarse
      this.guards = this.dir.spawnGunmen(n, c.x, c.z, { tag: this.tag, minR: this.o.observe ? 14 : 15, maxR: this.o.observe ? 30 : 22, mode: 'guard', peaceful: !!this.o.observe });
      g.ui.notify(this.o.observe ? 'Observa' : 'Sigilo', this.o.observe ? 'Mantente cerca y a la vista del lugar unos segundos.' : 'Agáchate con [C] o [Ctrl] y pasa entre los vigilantes: si te ven, dispararán.');
    }
    const aware = this.guards.filter((x) => x.alive && x.inCombat).length;
    if (aware >= this.limit && !this.alerted) { this.alerted = true; g.ui.notify('¡Te han visto!', 'Aguanta el tiroteo o huye y vuelve a intentarlo.'); }
    if (aware === 0 && this.alerted && this.guards.every((x) => !x.alive || !x.inCombat) && this.dist > 60) this.alerted = false;
    if (!c || !this.spawned) return;
    if (this.o.observe) {
      if (this.dist < 48 && !this.alerted) { this.hold += dt; if (this.hold >= 6) this.finish(); } else this.hold = Math.max(0, this.hold - dt);
    } else if (distXZ(g.player.position, this.goal) < 7 && aware === 0) this.finish();
  }
  bonusOk() { return !this.alerted; }
  destroy() { if (this.guards.length) this.dir.despawnGunmen(this.guards, this.instant ? 0 : 25000); }
}

/* ============================== eliminate · defend ============================== */
class CombatHandler extends Handler {
  start() {
    super.start();
    const o = this.o;
    this.keep = o.keepAlive || 0; this.need = o.count || o.enemies || (o.waves ? o.waves * 4 : 6); this.total = this.need + this.keep;
    this.waves = Math.max(1, o.waves || Math.ceil(this.total / 5)); this.perWave = Math.ceil(this.total / this.waves);
    this.spawnedN = 0; this.kills = 0; this.list = []; this.waveN = 0; this.wait = 0; this.triggered = false; this.alerted = false;
    this.tag = `foe_${this.m.id}_${this.idx}`; this.nextAlly = 1.4;
    this.off = this.g.bus.on('bandit:killed', (m) => { if (m.storyTag === this.tag) this.kills++; });
    if (Array.isArray(o.allies) && o.allies.length) this.dir.setCompanions(o.allies);
  }
  get progress() { return `${Math.min(this.kills, this.need)}/${this.need}`; }
  _spawnWave() {
    const c = this.center, p = this.g.player.position, n = Math.min(this.perWave, this.total - this.spawnedN);
    if (n <= 0) return;
    const near = !c || this.dist > 90 ? p : c;
    const names = this.waveN === 0 && this.o.targets ? this.o.targets.map((id) => (this.g.story.npcs[id] || {}).name).filter(Boolean) : null;
    const fresh = this.dir.spawnGunmen(n, near.x, near.z, { tag: this.tag, minR: near === p ? 38 : 24, maxR: near === p ? 60 : 44, mode: 'ambush', names });
    this.list.push(...fresh); this.spawnedN += n; this.waveN++;
    if (this.waveN === 1 || this.waveN === this.waves) this.g.ui.notify(this.waveN === this.waves && this.waves > 1 ? 'Última oleada' : '¡Enemigos!', '');
  }
  update(dt) {
    super.update(dt);
    const g = this.g, c = this.center;
    if (!this.triggered) { if (!c || this.dist < 130) { this.triggered = true; this._spawnWave(); } return; }
    const alive = this.list.filter((m) => m.alive);
    if (alive.some((m) => m.inCombat)) this.alerted = true;
    if (this.spawnedN < this.total) { this.wait += dt; if (alive.length <= 1 && this.wait > 2.5) { this._spawnWave(); this.wait = 0; } }
    // Los aliados disparan a los enemigos cercanos (la IA enemiga solo apunta al jugador, así que el apoyo se resuelve con daño directo).
    this.nextAlly -= dt;
    if (this.nextAlly <= 0 && this.dir.companions.length) {
      this.nextAlly = 1.1 + Math.random() * 0.8;
      for (const co of this.dir.companions) {
        let best = null, bd = 55; for (const m of alive) { const d = distXZ(m.position, co.npc.position); if (d < bd) { bd = d; best = m; } }
        if (!best) continue;
        _v.set(co.npc.position.x, co.npc.position.y + 1.4, co.npc.position.z);
        g.fx.impact.tracer(_v, { x: best.position.x, y: best.position.y + 1.3, z: best.position.z }, 0.08, null);
        g.fx.glow.burst(_v, 3, { color: 0xffc070, size: 0.2, life: 0.1, speed: 0.4, up: 1 });
        g.audio.playShotAt(distXZ(co.npc.position, g.player.position));
        if (Math.random() < 0.55) best.takeDamage(32 + Math.random() * 14, _v.set(0, 0, 1), { x: best.position.x, y: best.position.y + 1.2, z: best.position.z }, 'ally');
      }
    }
    if (this.kills >= this.need) {
      alive.forEach((m) => m.setState && m.setState('flee'));   // el superviviente de "deja a uno con vida" huye
      this.finish();
    }
  }
  bonusOk() { return !this.alerted; }
  destroy() {
    if (this.off) this.off(); this.off = null;
    if (this.o.allies) this.dir.clearCompanions();
    if (this.list.length) this.dir.despawnGunmen(this.list, this.instant ? 0 : 30000);
  }
}

/* ============================== survive ============================== */
class SurviveHandler extends Handler {
  start() {
    super.start();
    const o = this.o, g = this.g;
    this.kind = THREAT[o.threat] || 'none'; this.T = o.durationSeconds || 60; this.elapsed = 0; this.combat = null; this.out = 0;
    g.ui.setWeather(this.kind);
    if (this.kind === 'ambush') {   // sobrevivir a una emboscada = resistir oleadas durante el tiempo indicado
      this.combat = new CombatHandler(this.cm, this.m, { ...o, count: Math.ceil(this.T / 9) + 3, waves: Math.ceil(this.T / 18) }, this.idx);
      this.combat.start();
    }
    g.ui.notify(o.threat ? o.threat.charAt(0).toUpperCase() + o.threat.slice(1) : 'Resiste', 'Aguanta ' + this.T + ' segundos.');
  }
  get progress() { return `${Math.max(0, Math.ceil(this.T - this.elapsed))} s`; }
  update(dt) {
    super.update(dt);
    const g = this.g, p = g.player, c = this.center;
    const inside = !c || !this.o.location || this.dist < Math.max(55, (c.r || 30) * 1.8);
    if (!inside) { this.out += dt; if (this.out > 4) { g.ui.notify('Vuelve a la zona', 'El tiempo no corre mientras estás lejos.'); this.out = 0; } return; }
    this.elapsed += dt;
    const warm = distXZ(p.position, g.world.firePos) < 9;
    if (this.kind === 'cold') { const k = warm ? 0 : g.inventory.count('winter_coat') ? 0.25 : 1; this._hurt(1.1 * k * dt); }
    else if (this.kind === 'heat') { const k = g.inventory.count('canyon_poncho') ? 0.25 : 1; this._hurt(0.8 * k * dt); }
    else if (this.kind === 'fever') this._hurt(0.9 * dt);
    else if (this.kind === 'storm' || this.kind === 'collapse') p.shake = Math.max(p.shake, 0.18);
    if (this.kind === 'fire' && Math.random() < dt * 14) g.fx.glow.emit(_v.set(p.position.x + (Math.random() - 0.5) * 30, p.position.y + 0.5, p.position.z + (Math.random() - 0.5) * 30), { x: 0, y: 2 + Math.random() * 2, z: 0 }, { life: 1.4, size: 0.25, color: 0xff7a30, gravity: -0.5 });
    if (this.combat) this.combat.update(dt);
    if (this.elapsed >= this.T) this.finish();
  }
  _hurt(d) { const p = this.g.player; if (p.health > 18) { p.health = Math.max(18, p.health - d); p.lastHurt = Math.min(p.lastHurt, 4); } }
  destroy() { this.g.ui.setWeather(null); if (this.combat) { this.combat.instant = this.instant; this.combat.destroy(); } }
}

/* ============================== duel ============================== */
class DuelHandler extends Handler {
  start() { super.start(); this.began = false; this.wait = 0; }
  update(dt) {
    super.update(dt);
    const g = this.g, o = this.o;
    if (this.began) return;
    if (this.dist < 38 && g.mode === 'explore') {
      if (this.wait === 0) g.ui.notify('Duelo', `${(g.story.npcs[o.target] || {}).name || 'Tu rival'} te espera.`);
      this.wait += dt;
      if (this.wait > 1.6) {
        this.began = true;
        const c = this.center;
        // el sheriff del pueblo desaparece de la plaza mientras dura el duelo (el rival es su "doble" escenificado)
        if (o.target === 'sheriff') { g.law.sheriff.root.visible = false; g.law.sheriff.active = false; }
        g.duel.start({ id: o.target, name: (g.story.npcs[o.target] || {}).name || 'Rival', palette: o.target, skill: SKILL[o.target] ?? 0.6, mercy: !!o.mercyAllowed, toward: c ? { x: c.x, z: c.z } : null, onEnd: (res) => { this.result = res; this.finish(); } });
      }
    }
  }
  destroy() { if (this.g.duel.active) this.g.duel.abort(); }
  onRespawn() { this.began = false; this.wait = 0; }
}

/* ============================== choice ============================== */
class ChoiceHandler extends Handler {
  start() { super.start(); this.opened = false; this.picked = null; this.wait = 0; }
  waypoint() { return null; }
  update(dt) {
    super.update(dt);
    const g = this.g;
    if (this.opened || g.mode !== 'explore' || g.bandits.hostileNear(g.player.position, 60)) return;
    this.wait += dt; if (this.wait < 0.6) return;
    this.opened = true;
    const o = this.o, cm = this.cm;
    const choices = o.options.map((op) => ({
      text: op.text + (op.cost && op.cost.money ? ` (−$${op.cost.money})` : ''),
      requires: op.cost && op.cost.money ? { money: op.cost.money } : undefined,
      altReply: [{ speaker: 'narrator', text: 'No tienes dinero suficiente para eso.' }],
      reply: op.reply || [],
      fn: () => this.pick(op),
    }));
    g.dialogue.play({ lines: [{ speaker: 'narrator', text: o.text }], choices, emotional: true, onEnd: () => this.finish() }, cm.sceneAnchor());
  }
  pick(op) {
    const g = this.g, cm = this.cm;
    this.picked = op;
    cm.setFlag(op.flag); (op.alsoFlags || []).forEach((f) => cm.setFlag(f));
    if (op.cost && op.cost.money) g.inventory.addMoney(-op.cost.money);
    if (op.rewards) { if (op.rewards.money) g.inventory.addMoney(op.rewards.money); Object.entries(op.rewards.items || {}).forEach(([k, n]) => g.inventory.add(k, n)); }
    if (op.honor) g.honor.add(op.honor, this.m.title);
    cm.decisions[this.m.id] = op.id;
  }
  onRespawn() { if (this.g.dialogue.active) this.g.dialogue.abort(); this.opened = false; this.wait = 0; }
  destroy() { if (!this.done && this.g.dialogue.active) this.g.dialogue.abort(); }
}

/* ============================== interact · craft ============================== */
class InteractHandler extends Handler {
  start() {
    super.start();
    const o = this.o, g = this.g;
    // Objetos necesarios (cuerdas, dinamita, ganzúas…): si faltan, el objetivo los proporciona.
    (o.requires || []).forEach((id) => { if (g.inventory.count(id) < 1 && g.story.items[id]) { g.inventory.add(id, 1, true); g.ui.notify('Recibes', g.story.items[id].name); } });
    this.targetNpc = o.target && g.story.npcs[o.target] ? this.dir.ensureNPC(o.target, this.dir.homeOf(o.target, this.m.location), this.idx) : null;
    this.a = this.targetNpc ? null : this.dir.anchor(this.locId, this.idx, 5);
    this.timer = o.timeLimitSeconds ? g.elapsed : 0;
  }
  get pos() { return this.targetNpc ? this.targetNpc.position : this.a; }
  waypoint() { const p = this.pos; return p ? { x: p.x, z: p.z, kind: 'objective' } : null; }
  get dur() { return this.o.type === 'craft' ? 4.5 : this.o.urgent ? 1.8 : 3.0; }
  update(dt) {
    super.update(dt);
    if (this.timer && this.g.elapsed - this.timer > this.o.timeLimitSeconds + 8) { this.timer = this.g.elapsed; this.g.ui.notify('Se acabó el tiempo', 'Inténtalo de nuevo.'); }
  }
  interaction() {
    const p = this.pos; if (!p || distXZ(this.g.player.position, p) > 3.4 || this.g.mode !== 'explore') return null;
    const verb = this.o.type === 'craft' ? 'Fabricar' : 'Interactuar';
    return { key: 'E', prompt: `${verb}: ${firstSentence(this.o.text).replace(/\.$/, '')}`.slice(0, 74), action: () => this.g.startAction({ dur: this.dur, face: p, onDone: () => this.finish() }) };
  }
}

/* ============================== shoot ============================== */
class ShootHandler extends Handler {
  start() {
    super.start();
    this.score = 0; this.hit = new Map(); this.targets = []; this.built = false;
    this.goal = this.o.targetScore || (this.o.versus ? 40 : 30); this.limit = this.o.versus ? 50 : 70; this.t0 = 0;
    this.rival = this.o.versus ? 34 + Math.floor(Math.random() * 14) : 0;
    this.off = this.g.bus.on('player:shot', (e) => this._onShot(e));
  }
  get progress() { return `${this.score}/${this.goal}` + (this.t0 ? ` · ${Math.max(0, Math.ceil(this.limit - (this.g.elapsed - this.t0)))} s` : '') + (this.rival ? ` · rival ${this.rival}` : ''); }
  _build() {
    const g = this.g, c = this.center, p = g.player.position;
    const dx = p.x - c.x, dz = p.z - c.z, len = Math.hypot(dx, dz) || 1, fx = -dx / len, fz = -dz / len;   // hacia el lado opuesto al jugador
    const dists = [24, 34, 44, 54, 66, 80];
    const tex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'); [['#f2e8d0', 30], ['#b8402f', 22], ['#f2e8d0', 14], ['#b8402f', 7]].forEach(([col, r]) => { x.fillStyle = col; x.beginPath(); x.arc(32, 32, r, 0, 7); x.fill(); }); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    this.mat = new THREE.MeshBasicMaterial({ map: tex });
    dists.forEach((d, i) => {
      const lat = (i % 2 ? 1 : -1) * (4 + i * 1.3), x = c.x + fx * d + -fz * lat, z = c.z + fz * d + fx * lat;
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), this.mat); m.position.set(x, g.world.getHeightAt(x, z) + 1.7, z); m.rotation.y = Math.atan2(-fx, -fz) + Math.PI;
      m.userData.shootTarget = true; m.userData.baseX = x; m.userData.baseZ = z; m.userData.phase = i;
      g.scene.add(m); g.world.solidTargets.push(m); this.targets.push(m);
    });
    this.built = true;
  }
  _onShot(e) {
    if (!this.built || !e.object || !e.object.userData.shootTarget || this.done) return;
    const m = e.object, d = m.position.distanceTo(e.point), pts = Math.max(1, Math.round(10 * (1 - d / 0.55)));
    if (!this.t0) this.t0 = this.g.elapsed;
    this.score += pts; this.g.ui.notify(`+${pts} puntos`, `Total ${this.score}`);
    m.visible = false; this.hit.set(m, this.g.elapsed + 3.5);
    if (this.score >= this.goal && (!this.rival || this.score > this.rival)) this.finish();
  }
  update(dt) {
    super.update(dt);
    const g = this.g, c = this.center;
    if (!this.built) { if (c && this.dist < 40) this._build(); return; }
    for (const m of this.targets) {   // dianas móviles en la final; reaparecen a los 3.5 s
      if (!m.visible && g.elapsed > (this.hit.get(m) || 0)) m.visible = true;
      if (this.o.versus) { m.position.x = m.userData.baseX + Math.sin(g.elapsed * 0.9 + m.userData.phase) * 3.5; }
    }
    if (this.t0 && g.elapsed - this.t0 > this.limit) { this.score = 0; this.t0 = 0; g.ui.notify('Se acabó el tiempo', 'Puntuación a cero: vuelve a intentarlo.'); }
  }
  destroy() {
    if (this.off) this.off(); this.off = null;
    const w = this.g.world;
    for (const m of this.targets) { this.g.scene.remove(m); const i = w.solidTargets.indexOf(m); if (i >= 0) w.solidTargets.splice(i, 1); m.geometry.dispose(); }
    if (this.mat) { this.mat.map.dispose(); this.mat.dispose(); }
    this.targets = [];
  }
}

const HANDLERS = { reach: ReachHandler, talk: TalkHandler, collect: CollectHandler, hunt: HuntHandler, stealth: StealthHandler, combat: CombatHandler, survive: SurviveHandler, duel: DuelHandler, choice: ChoiceHandler, interact: InteractHandler, shoot: ShootHandler };
// Tipo de campaign.js → comportamiento. Casos especiales (escort de reses = collect) se resuelven en resolveKind().
const TYPE_MAP = { travel: 'reach', ride: 'reach', escort: 'reach', talk: 'talk', collect: 'collect', hunt: 'hunt', stealth: 'stealth', eliminate: 'combat', defend: 'combat', survive: 'survive', duel: 'duel', choice: 'choice', interact: 'interact', craft: 'interact', shoot: 'shoot' };
function resolveKind(obj) {
  if (obj.type === 'escort' && obj.species === 'res') return 'collect';   // "reúne las reses dispersas"
  return TYPE_MAP[obj.type] || 'interact';
}
function createHandler(cm, mission, obj, index) { return new HANDLERS[resolveKind(obj)](cm, mission, obj, index); }

export { Handler, HANDLERS, TYPE_MAP, SKILL, resolveKind, createHandler, firstSentence, SPECIES };
