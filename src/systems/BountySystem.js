// Tablón de recompensas y contratos de cazarrecompensas (data/bounties.json).
//   Estados por contrato: available → active → ready → completed.
//   leader:  eliminar al cabecilla. Muerto → recoge su pañuelo (prueba) y cobra el 66 %. Vivo (se rinde con poca vida,
//            lo atas con [E] y te sigue) → entrégalo en el tablón y cobras el 100 % y más Honor.
//   cleanup: abate N bandidos del campamento indicado mientras el contrato está activo.
import { CONFIG } from '../core/Config.js';
import { distXZ } from '../core/MathUtils.js';

class BountySystem {
  constructor(game, data) {
    this.game = game; this.data = data;
    this.states = {}; this.progress = {};
    data.contracts.forEach((c) => { this.states[c.id] = 'available'; this.progress[c.id] = 0; });
    this.leaderRetired = false;      // el cabecilla ya cobró su condena: no reaparece
    this.captive = null;             // pistolero atado que te sigue
    this.isOpen = false;
    game.bus.on('bandit:killed', (g) => this._onKilled(g));
  }
  contract(id) { return this.data.contracts.find((c) => c.id === id); }
  get active() { return this.data.contracts.find((c) => this.states[c.id] === 'active' || this.states[c.id] === 'ready') || null; }
  isActive(id) { return this.states[id] === 'active' || this.states[id] === 'ready'; }
  proofFor(g) { const c = this.active; return c && c.type === 'leader' && g.leader && g.campId === c.camp ? c.proof : null; }
  canCapture(g) { const c = this.active; return !!c && c.type === 'leader' && g.leader && g.campId === c.camp && this.states[c.id] === 'active'; }

  _onKilled(g) {
    const c = this.active;
    if (!c || g.campId !== c.camp) return;
    if (c.type === 'cleanup') {
      this.progress[c.id]++;
      this.game.ui.notify('Contrato', `${c.target}: ${Math.min(this.progress[c.id], c.count)}/${c.count}`);
      if (this.progress[c.id] >= c.count && this.states[c.id] === 'active') this._ready(c);
    } else if (c.type === 'leader' && g.leader && this.states[c.id] === 'active') this._ready(c, 'Recoge su pañuelo y vuelve al tablón.');
    this.game.missions.updateTracker();
  }
  _ready(c, text) {
    this.states[c.id] = 'ready';
    this.game.ui.notify('Contrato cumplido', text || 'Vuelve al tablón de recompensas de Redwood Gulch para cobrar.');
    this.game.audio.playUI();
  }
  trackerData() {
    const c = this.active; if (!c) return null;
    const st = this.states[c.id], camp = CONFIG.BANDIT_CAMPS.find((x) => x.id === c.camp);
    const obj = [];
    if (st === 'ready') obj.push({ text: c.type === 'leader' && !this.captive ? 'Toma la prueba y vuelve al tablón (o entrega al prisionero)' : 'Cobra en el tablón de Redwood Gulch', done: false });
    else if (c.type === 'cleanup') obj.push({ text: `Abate bandidos en ${camp.name}: ${Math.min(this.progress[c.id], c.count)}/${c.count}`, done: false });
    else obj.push({ text: `Elimina o captura al líder en ${camp.name}`, done: false });
    return { title: `Contrato: ${c.target}`, objectives: obj };
  }
  radarZone() {
    const c = this.active; if (!c || this.states[c.id] !== 'active') return null;
    const camp = CONFIG.BANDIT_CAMPS.find((x) => x.id === c.camp); return camp ? { x: camp.x, z: camp.z, r: 28 } : null;
  }

  /* ---- acciones del tablón ---- */
  view() {
    const g = this.game, inv = g.inventory;
    const board = g.world.town.board.pos, nearCaptive = this.captive && this.captive.alive && distXZ(this.captive.position, board) < 22;
    return {
      title: this.data.title, subtitle: this.data.subtitle, money: inv.money, honor: g.honor.tier.name, wanted: Math.ceil(g.law.bounty), canPay: g.law.bounty > 0,
      contracts: this.data.contracts.map((c) => {
        const st = this.states[c.id], hasProof = c.proof ? inv.count(c.proof) > 0 : false;
        return {
          ...c, state: st, progress: this.progress[c.id], busy: !!this.active && this.active.id !== c.id,
          canClaimDead: st === 'ready' && ((c.type === 'cleanup') || hasProof), canClaimAlive: this.isActive(c.id) && c.type === 'leader' && !!nearCaptive,
        };
      }),
    };
  }
  open() {
    const g = this.game;
    this.isOpen = true; g.setMode('board'); g.input.exitLock();
    g.ui.showBoard(this.view(), (action, id) => this.handle(action, id)); g.audio.playUI();
  }
  close() {
    if (!this.isOpen) return;
    const g = this.game;
    this.isOpen = false; g.ui.hideBoard(); g.setMode('explore'); g.input.requestLock(); g.save.save();
  }
  handle(action, id) {
    const g = this.game, c = id ? this.contract(id) : null;
    if (action === 'close') { this.close(); return; }
    if (action === 'accept' && c && this.states[id] === 'available' && !this.active) {
      this.states[id] = 'active'; this.progress[id] = 0;
      const ok = this._repopulate(c);
      g.ui.notify('Contrato aceptado', c.title); g.audio.playUI();
      if (!ok) g.ui.notify('Bandidos en el campamento', 'Aún quedan sus hombres. Ve con cuidado.');
    } else if (action === 'abandon' && c && this.isActive(id)) {
      this.states[id] = 'available'; this.progress[id] = 0; this.releaseCaptive(); g.ui.notify('Contrato abandonado', c.title);
    } else if (action === 'claimDead' && c) this.claim(c, 'dead');
    else if (action === 'claimAlive' && c) this.claim(c, 'alive');
    else if (action === 'pay') g.law.payBounty();
    g.ui.renderBoard(this.view()); g.missions.updateTracker();
  }
  _repopulate(c) { return this.game.bandits.repopulate(c.camp, c.type === 'leader' && !this.leaderRetired); }
  claim(c, how) {
    const g = this.game;
    if (this.states[c.id] === 'completed') return;
    if (how === 'dead') {
      if (c.proof) { if (g.inventory.count(c.proof) < 1) return; g.inventory.remove(c.proof, 1, true); }
    } else {
      if (!this.captive || !this.captive.alive) return;
      const cell = g.world.town.spots.tomasCell;   // junto a Tomás, si está encerrado
      this.captive.jail({ x: cell.x + 1.1, y: cell.y, z: cell.z - 1.2 }, cell.x, cell.z + 10);
      this.captive.model.rifle.visible = false; this.captive = null;
    }
    const pay = c.reward[how], honor = c.honor[how] ?? 0;
    this.states[c.id] = 'completed';
    g.inventory.addMoney(pay); g.honor.add(honor, how === 'alive' ? 'Fugitivo entregado vivo' : 'Recompensa cobrada');
    g.ui.banner('RECOMPENSA COBRADA', `${c.target} · $${pay.toFixed(2)}`, 4.5); g.audio.playMissionComplete();
    if (c.type === 'leader') this.leaderRetired = true;
    g.bus.emit('bounty:claimed', c.id);
    g.missions.updateTracker();
  }

  /* ---- prisionero ---- */
  tieCaptive(gm) {
    if (this.captive) this.releaseCaptive();
    gm.tie(); this.captive = gm;
    this.game.ui.notify('Prisionero atado', 'Te seguirá. Llévalo al tablón de Redwood Gulch.');
    const c = this.active; if (c && this.states[c.id] === 'active') this._ready(c, 'Lleva a Boone vivo al tablón de recompensas.');
  }
  releaseCaptive() { if (this.captive && this.captive.alive) this.captive.setState('idle'); this.captive = null; }

  toJSON() { return { states: { ...this.states }, progress: { ...this.progress }, leaderRetired: this.leaderRetired }; }
  fromJSON(d) {
    if (!d) return;
    Object.entries(d.progress || {}).forEach(([id, n]) => { if (id in this.progress) this.progress[id] = n; });
    Object.entries(d.states || {}).forEach(([id, st]) => {
      if (!(id in this.states)) return;
      const c = this.contract(id);
      // 'ready' solo se conserva si sigue cumpliéndose (prueba en las alforjas / contador completo); el prisionero no se guarda.
      this.states[id] = st === 'ready' && !((c.type === 'leader' && this.game.inventory.count(c.proof) > 0) || (c.type === 'cleanup' && this.progress[id] >= c.count)) ? 'active' : st;
    });
    this.leaderRetired = !!d.leaderRetired;
    if (this.leaderRetired) this.campLeaderRetire();
  }
  campLeaderRetire() { /* el cabecilla de un contrato completado permanece derrotado */
    this.game.bandits.campMembers('canon_norte').forEach((m) => { if (m.leader && m.alive) { m.hp = 0; m.state = 'dead'; m.deathT = 1; m.deadTime = 999; m.root.visible = false; } });
  }
}

export { BountySystem };
