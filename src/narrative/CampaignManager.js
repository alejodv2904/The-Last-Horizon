// Motor narrativo data-driven: lee campaign.js (8 actos × 6 misiones) y lo convierte en juego.
//
//   · Estado de campaña: misión actual, objetivo en curso, decisiones, desbloqueos, final alcanzado.
//   · Misiones: la siguiente misión "espera" a su dador (marcador !); al aceptarla se interpretan sus objetivos EN ORDEN con
//     ObjectiveHandlers (un manejador por tipo, ver ObjectiveHandlers.js). Los objetivos `optional` corren en paralelo.
//   · Recompensas: dinero, objetos, banderas, desbloqueos y Honor (por misión, por decisión y por bonificaciones).
//   · Transiciones cinematográficas: pantalla negra con el título del capítulo al empezar y terminar cada acto; cambio de
//     campamento (Caps. IV, V y VI), cambio de protagonista en los Epílogos y créditos finales con modo libre infinito.
//   · Guardado: solo se serializa el índice del objetivo; los manejadores se reconstruyen al cargar.
import { createHandler } from './ObjectiveHandlers.js';
import { resolveLocation } from './LocationMap.js';
import { distXZ } from '../core/MathUtils.js';
import { passesCondition, resolveEnding } from '../../data/story/campaign.js';

const BONUS_OF = (o) => o.bonus || (o.nonLethalBonus && 'nonlethal_guards') || (o.avoidCivilians && 'no_civilian_casualties') || (o.civilians && 'warned_families') || null;
// Campamento según la misión en curso (el calendario de la historia): cedar → pantano → ruinas del pantano → Mesa Quebrada → Cedar en ruinas → rancho.
function siteForMission(id) {
  const [, c, n] = /^c(\d)_0(\d)$/.exec(id) || [null, '1', '1'], ch = Number(c), no = Number(n);
  if (ch <= 3 || (ch === 4 && no === 1)) return 'cedar';
  if (ch === 4) return no === 6 ? 'swamp' : 'swamp';
  if (ch === 5) return no === 6 ? 'mesa' : 'swamp_ruins';
  if (ch === 6) return 'cedar_ruins';
  return 'ranch';
}

class CampaignManager {
  constructor(game, data) {
    this.game = game; this.data = data; this.missions = data.MISSIONS; this.acts = data.ACTS; this.byId = new Map(this.missions.map((m) => [m.id, m]));
    this.completed = new Set(); this.currentId = null; this.accepted = false; this.objectives = []; this.objIdx = 0; this.handler = null; this.side = [];
    this.decisions = {}; this.unlocks = new Set(); this.cards = new Set(); this.protagonist = 'eli'; this.endingId = null; this.finalChoice = null;
    this.freeRoam = false; this.credited = false; this.busy = false; this.endShown = false; this.bonusEarned = new Set(); this.playTime = 0;
    this._wpT = 0; this._autoT = 0; this.started = false; this._lawAtStart = 0;
    this.director = null;   // lo crea Game (necesita el mundo)
  }

  get flags() { return this.game.missions.flags; }
  // ¿Hay una infiltración en curso sin alarma? (la música pasa a «sigilo»)
  stealthActive() { const h = this.handler; return !!h && h.o.type === 'stealth' && h.spawned && h.dist < 90 && !h.alerted && this.game.mode === 'explore'; }
  get mission() { return this.byId.get(this.currentId) || null; }
  get active() { return this.started && !this.freeRoam; }
  npcName(id) { return (this.data.NPCS[id] || {}).name || id; }
  setFlag(f) { if (!f) return; if (!this.flags.has(f)) { this.flags.add(f); this.game.bus.emit('flag:set', f); } }

  /* ============================ Ciclo de vida ============================ */
  // Partida nueva: arranca por la primera misión.
  begin() {
    this.started = true; this.game.missions.states.m01_hunt = 'completed';   // la caza de la Fase 4 la sustituye c1_02
    this._enter(this.missions[0].id);
  }

  _enter(id) {
    const m = this.byId.get(id); if (!m) return;
    this.currentId = id; this.accepted = false; this.handler = null; this.side = []; this.objectives = m.objectives.slice(); this.objIdx = 0; this.endShown = false; this.endingId = id === 'c6_06' ? null : this.endingId;
    const act = this.acts[m.chapter - 1];
    const go = () => { this.refreshWorld(); this.updateTracker(); if (m.giverNPC === 'narrator') this._autoT = 2.2; else this.game.ui.notify('Nueva misión', m.title); };
    if (m.order === 1 && !this.cards.has(`start${act.number}`)) this._cardsThen([this._startCard(act)], go); else go();
  }

  // Aceptar la misión actual (al hablar con su dador o automáticamente si no lo tiene).
  accept() {
    const m = this.mission; if (!m || this.accepted) return;
    this.accepted = true; this._lawAtStart = this.game.law.level; this.bonusEarned = new Set();
    this.game.ui.notify('Misión aceptada', m.title); this.game.audio.playUI();
    this._startStep(0); this.refreshWorld();
  }

  /* ============================ Objetivos ============================ */
  isFirstStep(idx) { return this.objectives.slice(0, idx).every((o) => !passesCondition(o, this.flags) || o.optional); }
  isLastStep(idx) { return this.objectives.slice(idx + 1).every((o) => !passesCondition(o, this.flags) || o.optional); }

  _startStep(i) {
    this.handler = null;
    for (; i < this.objectives.length; i++) {
      const o = this.objectives[i];
      if (!passesCondition(o, this.flags)) continue;
      if (o.optional) { const h = createHandler(this, this.mission, o, i); h.start(); this.side.push(h); continue; }
      this.objIdx = i; this.handler = createHandler(this, this.mission, o, i); this.handler.start();
      this.updateTracker(); this._wpT = 0; return;
    }
    this.objIdx = this.objectives.length; this._completeMission();
  }
  sceneAnchor() {
    const g = this.game, p = g.player.position;
    let best = null, bd = 40;
    for (const n of g.npcs) { if (!n.active || n.id === this.protagonist) continue; const d = distXZ(n.position, p); if (d < bd) { bd = d; best = n; } }
    if (best) return best;
    const h = g.player.heading;
    return { position: { x: p.x + Math.sin(h) * 3, y: p.y, z: p.z + Math.cos(h) * 3 }, name: '', talking: false };
  }

  _stepDone(h, side = false) {
    const g = this.game, o = h.o;
    if (h.consume) h.consume();
    const key = BONUS_OF(o);
    if (key) {
      const ok = key === 'no_civilian_casualties' ? g.law.level <= this._lawAtStart : (h.bonusOk ? h.bonusOk() : true);
      if (ok) this.bonusEarned.add(key);
    }
    if (o.item && !g.inventory.count(o.item) && g.story.items[o.item] && o.type !== 'collect') g.inventory.add(o.item, 1);
    (o.recipe || []).forEach((id) => { if (g.story.items[id]) g.inventory.add(id, 1); });
    (o.builds || []).forEach((id) => { if (this.data.UNLOCKS[id]) this._unlock(id, true); });
    if (o.type === 'choice' && h.picked && this.mission.id === 'c6_06') this._resolveEnding(h.picked);
    h.destroy();
    if (!side) {
      g.ui.notify('Objetivo cumplido', o.text.length > 70 ? `${o.text.slice(0, 68)}…` : o.text); g.audio.playItem();
      this._startStep(this.objIdx + 1);
    } else this.side = this.side.filter((x) => x !== h);
  }

  // Elección final de c6_06 + Honor acumulado → uno de los 4 finales; sus objetivos se añaden a la misión.
  _resolveEnding(op) {
    const g = this.game, end = resolveEnding(g.honor.value, op.id);
    this.endingId = end.id; this.finalChoice = op.id;
    this.objectives = this.objectives.concat(end.objectives);
    if (end.honorImpact) g.honor.add(end.honorImpact, end.title);
    g.ui.notify('Tu destino se decide', end.title);
  }

  /* ============================ Fin de misión ============================ */
  _completeMission() {
    const g = this.game, m = this.mission, end = this.endingId && m.endings ? m.endings[this.endingId] : null;
    this.side.forEach((h) => h.destroy()); this.side = [];
    g.duel.clearLeftovers(); this.director.clearCompanions(); this.director.setWaypoints([]); this.director.unpinAll();
    this.handler = null;
    // Honor: la mayor parte llega al decidir; aquí, la base de la misión y las bonificaciones logradas.
    const hi = m.honorImpact || {}; let honor = hi.onComplete || 0;
    for (const [k, v] of Object.entries(hi.bonuses || {})) if (this.bonusEarned.has(k)) honor += v;
    if (honor) g.honor.add(honor, m.title);
    // Recompensas (de la misión + del final, si lo hay)
    const r = m.rewards || {}, er = end ? end.rewards || {} : {};
    const money = (r.money || 0) + (er.money || 0), items = { ...(r.items || {}) };
    Object.entries(er.items || {}).forEach(([k, n]) => { items[k] = (items[k] || 0) + n; });
    if (money) g.inventory.addMoney(money);
    Object.entries(items).forEach(([k, n]) => { if (n > 0 && g.story.items[k]) g.inventory.add(k, n, true); });
    [...(r.flags || []), ...(er.flags || [])].forEach((f) => this.setFlag(f));
    [...(r.unlocks || []), ...(er.unlocks || [])].forEach((u) => this._unlock(u));
    this.completed.add(m.id); this.bonusEarned.clear();
    g.audio.playMissionComplete();
    g.ui.banner('MISIÓN COMPLETADA', m.title, 4.5);
    const parts = []; if (money > 0) parts.push(`$${money.toFixed(2)}`);
    Object.entries(items).forEach(([k, n]) => { if (n > 0 && g.story.items[k]) parts.push(`${n} × ${g.story.items[k].name}`); });
    if (parts.length) setTimeout(() => g.ui.notify('Recompensa', parts.join(' · ')), 1200);
    g.save.save();
    // Escena de cierre (si el último objetivo no fue ya un diálogo con ese texto) y siguiente paso.
    const lines = [...m.dialogueEnd];
    if (end) { lines.push(...end.dialogueEnd); (end.narration || []).forEach((t) => lines.push({ speaker: 'narrator', text: t })); }
    const after = () => this._afterMission(m);
    if (this.endShown && !end) after();
    else if (this.game.mode === 'dead' || this.game.mode === 'cutscene') after();
    else setTimeout(() => g.dialogue.play({ lines, emotional: m.beat === 'climax' || !!end, onEnd: after }, this.sceneAnchor()), 1800);
    this._wpT = 0; this.updateTracker();
  }

  _afterMission(m) {
    const act = this.acts[m.chapter - 1], idx = this.missions.indexOf(m), next = this.missions[idx + 1];
    this.currentId = null; this.accepted = false; this.director.pruneSpawned();
    if (m.order === 6) {   // fin de acto: tarjeta de cierre → (siguiente acto | créditos)
      const list = [this._endCard(act)];
      if (next) { const nact = this.acts[next.chapter - 1]; list.push(this._startCard(nact, () => this._actSwitch(next))); this._cardsThen(list, () => this._enter(next.id)); }
      else this._cardsThen(list, () => this._credits());
    } else if (next) this._enter(next.id);
    this.game.save.save();
  }

  // Al empezar un acto nuevo (con la pantalla en negro) se mueve el mundo: campamento, protagonista…
  _actSwitch(nextMission) {
    if (nextMission.chapter === 7) this.switchProtagonist('wren');
    this.currentId = nextMission.id;   // el campamento depende de la misión en curso
    this.refreshWorld();
  }

  switchProtagonist(who) {
    const g = this.game, co = (this.endingId && this.data.ENDINGS[this.endingId] && this.data.ENDINGS[this.endingId].epilogueCarryover) || { startingHonor: 0, startingMoney: 50 };
    this.protagonist = who;
    g.story.player.name = this.npcName(who);
    g.player.setAppearance(who === 'wren' ? 'wren' : 'player');
    if (who === 'wren') {   // Wren hereda lo justo: dinero, honor y munición según el final
      g.inventory.items.clear(); g.inventory.money = co.startingMoney;
      g.inventory.add('ammo', 30, true); g.inventory.add('tonic', 2, true); g.inventory.add('rope', 2, true);
      g.honor.value = Math.max(-100, Math.min(100, co.startingHonor)); g.bus.emit('honor:changed', g.honor.value);
      g.deadEye.value = 40; g.player.health = 100;
      g.world.setCampSite('ranch'); const f = g.world.firePos;
      g.player.respawnAt(f.x + 2, f.z - 9); g.player.pitch = -0.1; g.player.yaw = 0;
      g.horse.position.set(f.x + 6, g.world.getHeightAt(f.x + 6, f.z - 8), f.z - 8); g.horse.state = 'idle'; g.horse.speed = 0;
      g.world.chunks.update(g.player.position, true);
    }
  }

  /* ============================ Tarjetas, créditos, modo libre ============================ */
  _startCard(act, onBlack) {
    return { id: `start${act.number}`, kicker: `${act.kind === 'epilogue' ? 'EPÍLOGO' : 'CAPÍTULO'} ${act.numeral}`, title: act.title.toUpperCase(), sub: act.period, hold: 4.6, onBlack };
  }
  _endCard(act) {
    return { id: `end${act.number}`, kicker: `FIN DEL ${act.kind === 'epilogue' ? 'EPÍLOGO' : 'CAPÍTULO'} ${act.numeral}`, title: act.title.toUpperCase(), sub: '', hold: 3.2 };
  }
  _cardsThen(cards, done) {
    const g = this.game;
    this.busy = true; g.setMode('cutscene'); g.deadEye.deactivate();
    const run = (i) => {
      if (i >= cards.length) { this.busy = false; if (g.mode === 'cutscene') g.setMode('explore'); done && done(); return; }
      const c = cards[i]; this.cards.add(c.id);
      g.audio.music && g.audio.music.stinger('chapter');
      g.ui.showCard(c, () => run(i + 1), c.onBlack);
    };
    run(0);
  }

  _credits() {
    const g = this.game, end = this.data.ENDINGS[this.endingId];
    this.busy = true; g.setMode('cutscene');
    const lines = [{ h: 'THE LAST HORIZON' }, { s: end ? end.title : 'El último horizonte' }, ''];
    if (end) { end.narration.forEach((t) => lines.push({ t })); lines.push(''); }
    lines.push({ h: 'REPARTO' });
    const cast = ['eli', 'wren', 'silas', 'abner', 'josie', 'nate', 'marta', 'isaiah', 'marlowe', 'whitmore', 'remedios'];
    cast.forEach((id) => lines.push({ s: this.npcName(id), t: (this.data.NPCS[id] || {}).role || '' }));
    lines.push('', { h: 'MÚSICA' }, { t: 'Banda sonora Western procedural, sintetizada en tiempo real' }, '', { h: 'GRACIAS POR CABALGAR' }, { t: 'El horizonte no tiene fin.' });
    g.audio.music && g.audio.music.stinger('victory');
    g.ui.showCredits(lines, () => { this.busy = false; this._freeRoam(); });
  }
  _freeRoam() {
    const g = this.game;
    this.freeRoam = true; this.credited = true; this.currentId = null; this.objectives = []; this.handler = null;
    g.setMode('explore'); g.world.setInfinite(true);
    this._unlock('mode_free_roam_infinite'); this.setFlag('free_roam_infinite');
    g.ui.banner('MUNDO ABIERTO INFINITO', 'El terreno ya no tiene fronteras', 6);
    this.refreshWorld(); this.updateTracker(); g.save.save();
  }

  /* ============================ Desbloqueos ============================ */
  _unlock(id, quiet = false) {
    if (this.unlocks.has(id)) return;
    this.unlocks.add(id);
    const u = this.data.UNLOCKS[id];
    if (!quiet && u && u.kind !== 'mode') this.game.ui.notify(u.kind === 'zone' ? 'Nueva zona' : 'Desbloqueado', u.name);
    if (id === 'camp_stove' || id === 'camp_tents' || id === 'camp_stable' || id === 'camp_infirmary') this.game.bus.emit('camp:upgrade', id);
  }
  hasUnlock(id) { return this.unlocks.has(id); }
  // Viaje rápido al campamento (desbloqueo `fast_travel_camp`): fundido a negro y traslado junto a la fogata.
  fastTravelCamp() {
    const g = this.game;
    if (!this.unlocks.has('fast_travel_camp') || g.mode !== 'explore') return false;
    if (g.bandits.hostileNear(g.player.position, 80)) { g.ui.notify('Viaje rápido', 'No con enemigos cerca.'); return false; }
    const f = g.world.firePos; this.teleportPlayer(f.x + 3, f.z - 7, g.world.camp.site.name || 'Campamento'); return true;
  }

  /* ============================ Mundo y radar ============================ */
  // Sincroniza campamento, miembros de la banda, dador y waypoints con la misión actual y las banderas.
  refreshWorld() {
    const g = this.game, m = this.mission, f = this.flags;
    const id = m ? m.id : (this.freeRoam ? 'c8_06' : 'c1_01');
    const site = this.freeRoam ? 'ranch' : siteForMission(id), ch = m ? m.chapter : 8;
    // ¿Quién está en el campamento ahora?
    const p = new Set();
    const gone = (this.protagonist === 'wren');
    const away = !gone && ch === 5 && id !== 'c5_06';   // Eli está solo en el desierto
    if (!away) {
      const add = (x) => p.add(x);
      if (!gone) { add('silas'); add('wren'); }
      if (!f.has('josie_dead') && !(f.has('josie_captured') && !f.has('josie_rescued') && ch === 1)) add('josie');
      if (!f.has('abner_dead')) add('abner');
      add('marta'); add('toby');
      const at = (x) => this.missions.findIndex((q) => q.id === x), cur = at(id);
      if (!(f.has('isaiah_exiled') || f.has('isaiah_executed')) && cur >= at('c1_03')) add('isaiah');   // el rastreador llega con la banda en el Cap. I
      if (ch >= 4 && !f.has('doc_dead')) add('doc');
      if (!f.has('ch6_mutiny_decided') && !f.has('nate_revealed') && ch <= 6) add('nate');
      if (gone) { p.delete('silas'); p.delete('wren'); p.delete('doc'); p.delete('isaiah'); p.delete('nate'); if (!f.has('ending_dawn')) p.delete('abner'); }
    }
    this.director.syncCamp(site, p);
    // Dador de la misión disponible: aparece donde corresponde (miembros de la banda ya están en el campamento).
    if (m && !this.accepted && m.giverNPC !== 'narrator' && m.giverNPC !== 'sheriff' && !p.has(m.giverNPC) && !g.npcs.some((n) => n.id === m.giverNPC && n.active)) {
      this.director.ensureNPC(m.giverNPC, this.director.homeOf(m.giverNPC, m.location), 0);
    }
    this._wpT = 0;
  }
  _giverPos() {
    const m = this.mission; if (!m) return null;
    if (m.giverNPC === 'sheriff') return this.game.law.sheriff.position;
    const n = this.director.npc(m.giverNPC);
    if (n && n.active) return n.position;
    const l = resolveLocation(this.director.homeOf(m.giverNPC, m.location), this.game.world); return l;
  }
  _waypoints() {
    const pts = [];
    if (this.freeRoam || !this.mission) return pts;
    if (!this.accepted) { const p = this._giverPos(); if (p && this.mission.giverNPC !== 'narrator') pts.push({ x: p.x, z: p.z, kind: 'npc' }); }
    else if (this.handler) { const w = this.handler.waypoint(); if (w) pts.push(w); }
    return pts;
  }
  getMarkerFor(npcId) {
    const m = this.mission; if (!m || this.freeRoam) return null;
    if (!this.accepted && m.giverNPC === npcId) return 'available';
    if (this.accepted && this.handler && this.handler.o.type === 'talk' && this.handler.o.npc === npcId) return 'ready';
    return null;
  }
  // Punto de interacción activo (InteractHandler) cerca del jugador: { key, prompt, action } o null.
  getInteraction() { return this.handler && this.handler.interaction ? this.handler.interaction() : null; }

  /* ============================ Diálogo con PNJ ============================ */
  getDialogueFor(npcId) {
    const m = this.mission; if (!m || this.freeRoam || this.busy) return null;
    const pass = (e) => passesCondition(e, this.flags);
    if (this.accepted && this.handler && this.handler.o.type === 'talk' && this.handler.o.npc === npcId) {
      const e = this.handler.entry(); return { ...e, lines: e.lines.filter(pass) };
    }
    if (!this.accepted && m.giverNPC === npcId) {
      const lines = m.dialogueStart.filter(pass);
      return {
        lines, emotional: m.beat === 'climax' || m.beat === 'dilema',
        choices: [
          { text: `Acepto: ${m.title}`, reply: [], fn: () => setTimeout(() => this.accept(), 300) },
          { text: 'Dame un minuto.', reply: [{ speaker: npcId, text: 'Aquí estaré. No tardes: el tiempo no perdona.' }] },
        ],
      };
    }
    if (this.accepted && m.giverNPC === npcId && this.handler) {   // recordatorio del dador a mitad de misión
      return { lines: [{ speaker: npcId, text: `Sigue con lo tuyo: ${this.handler.o.text}` }] };
    }
    return null;
  }

  /* ============================ Bucle y utilidades ============================ */
  update(dt) {
    if (!this.started || this.busy) return;
    const g = this.game;
    this.playTime += dt;
    if (this.freeRoam) { this.director.update(dt); return; }
    const m = this.mission;
    if (m && !this.accepted && m.giverNPC === 'narrator' && this._autoT > 0 && g.mode === 'explore') { this._autoT -= dt; if (this._autoT <= 0) this.accept(); }
    if (g.mode !== 'cutscene' && g.mode !== 'dead') {
      for (const h of this.side.slice()) { h.update(dt); if (h.done) this._stepDone(h, true); }
      if (this.handler && g.mode !== 'duel') {
        this.handler.update(dt);
        if (this.handler.done) this._stepDone(this.handler);
        else if (this.handler.o.type === 'duel' || this.handler.o.type === 'choice') { /* los gestionan sus propios sistemas */ }
      }
    }
    this._wpT -= dt;
    if (this._wpT <= 0) { this._wpT = 0.4; this.director.setWaypoints(this._waypoints()); if (this.handler) this.updateTracker(); }
    this.director.update(dt);
  }
  onPlayerRespawn() { if (this.handler && this.handler.onRespawn) this.handler.onRespawn(); this.refreshWorld(); }

  // Fundido a negro, traslado del jugador (y del caballo) y fundido de vuelta.
  teleportPlayer(x, z, label = '') {
    const g = this.game, prev = g.mode;
    g.setMode('cutscene'); g.ui.setFade(true, label);
    setTimeout(() => {
      const p = g.player; if (p.riding) p.dismountHorse();
      p.position.set(x, g.world.getHeightAt(x, z), z); p.velocity.set(0, 0, 0);
      g.horse.position.set(x + 4, g.world.getHeightAt(x + 4, z + 2), z + 2); g.horse.state = 'idle'; g.horse.speed = 0; g.horse.tracks.reset();
      g.world.chunks.update(p.position, true);
      g.ui.setFade(false); g.setMode(prev === 'dead' ? 'explore' : prev === 'cutscene' ? 'explore' : prev);
    }, 1300);
  }

  /* ============================ Tracker (HUD) ============================ */
  updateTracker() {
    const g = this.game, ms = g.missions;
    if (ms.trackedId || (g.bounties && g.bounties.trackerData())) { ms.updateTracker(); return; }   // un contrato o misión secundaria tiene prioridad
    const m = this.mission;
    if (this.freeRoam) { g.ui.setTracker({ title: 'Mundo abierto', objectives: [{ text: 'El horizonte no tiene fin: caza, comercia y cabalga.' }] }); return; }
    if (!m) { g.ui.setTracker(null); return; }
    const act = this.acts[m.chapter - 1], title = `${act.kind === 'epilogue' ? 'Epílogo' : 'Cap.'} ${act.numeral} · ${m.title}`;
    if (!this.accepted) {
      g.ui.setTracker({ title, objectives: [{ text: m.giverNPC === 'narrator' ? 'Sobrevive…' : `Habla con ${this.npcName(m.giverNPC)}`, done: false }] }); return;
    }
    const list = [];
    this.objectives.forEach((o, i) => {
      if (!passesCondition(o, this.flags)) return;
      const cur = this.handler && this.handler.o === o, sideH = this.side.find((h) => h.o === o);
      const done = i < this.objIdx && !o.optional;
      if (done) { list.push({ text: o.text, done: true }); return; }
      if (cur) list.push({ text: this.handler.label, done: false });
      else if (sideH) list.push({ text: `(opcional) ${sideH.label}`, done: false });
      else if (i > this.objIdx && !o.optional) list.push({ text: o.text, done: false });
    });
    // Solo el objetivo actual y los 2 siguientes (más los hechos recientes) para no saturar la pantalla.
    const first = Math.max(0, list.findIndex((x) => !x.done) - 1);
    g.ui.setTracker({ title, objectives: list.slice(first, first + 4) });
  }

  /* ============================ Progreso y guardado ============================ */
  percent() {
    let p = this.completed.size;
    if (this.accepted && this.objectives.length) p += Math.min(0.95, this.objIdx / this.objectives.length);
    if (this.credited) p = this.missions.length;
    return Math.min(100, Math.round(p / this.missions.length * 100));
  }
  // Datos para la ranura de guardado: capítulo actual, misión, etc.
  summary() {
    const m = this.mission || (this.freeRoam ? null : this.missions[this.missions.length - 1]);
    const act = m ? this.acts[m.chapter - 1] : this.acts[7];
    return { chapter: this.freeRoam ? 'Mundo abierto' : `${act.kind === 'epilogue' ? 'Epílogo' : 'Capítulo'} ${act.numeral} · ${act.title}`, mission: this.freeRoam ? 'Post-juego' : (m ? m.title : '—'), percent: this.percent() };
  }
  toJSON() {
    return {
      v: 1, completed: [...this.completed], currentId: this.currentId, accepted: this.accepted, objIdx: this.objIdx, decisions: this.decisions, unlocks: [...this.unlocks],
      cards: [...this.cards], protagonist: this.protagonist, endingId: this.endingId, finalChoice: this.finalChoice, freeRoam: this.freeRoam, credited: this.credited, playTime: this.playTime,
      started: this.started,
    };
  }
  fromJSON(d) {
    const g = this.game;
    if (!d) { this.begin(); return; }
    this.handler = null; this.side = []; this.director.clearAll();
    this.completed = new Set(d.completed || []); this.decisions = d.decisions || {}; this.unlocks = new Set(d.unlocks || []); this.cards = new Set(d.cards || []);
    this.protagonist = d.protagonist || 'eli'; this.endingId = d.endingId || null; this.finalChoice = d.finalChoice || null; this.freeRoam = !!d.freeRoam; this.credited = !!d.credited; this.playTime = d.playTime || 0;
    this.started = true; g.missions.states.m01_hunt = 'completed';
    g.story.player.name = this.npcName(this.protagonist); g.player.setAppearance(this.protagonist === 'wren' ? 'wren' : 'player');
    if (this.freeRoam) { g.world.setInfinite(true); this.currentId = null; this.refreshWorld(); this.updateTracker(); return; }
    const m = this.byId.get(d.currentId) || this.missions.find((x) => !this.completed.has(x.id));
    if (!m) { this._freeRoam(); return; }
    this.currentId = m.id; this.objectives = m.objectives.slice(); this.accepted = false;
    if (m.id === 'c6_06' && this.endingId) { const end = m.endings[this.endingId]; if (end) this.objectives = this.objectives.concat(end.objectives); }
    this.refreshWorld();
    if (d.accepted) { this.accepted = true; this._lawAtStart = g.law.level; this._startStep(Math.min(d.objIdx || 0, this.objectives.length - 1)); } else this.updateTracker();
  }
}

export { CampaignManager, siteForMission };
