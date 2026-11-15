// Misiones y diálogos basados en JSON.
// Acciones de diálogo (cadena separada por ';'): accept:ID · complete:ID[:final] · honor:N · money:N · item:ID:N · flag:F · shop:NPC · board · wanted:N
// Los "finales" (endings) de una misión permiten que la decisión del jugador cambie recompensa, Honor y banderas del mundo.
class MissionSystem {
  constructor(game, story) {
    this.game = game; this.story = story;
    this.states = {}; this.flags = new Set(); this.trackedId = null; this.postHint = null;
    Object.keys(story.missions).forEach((id) => { this.states[id] = 'available'; });
    game.bus.on('inventory:changed', () => this.evaluate());
  }
  getState(id) { return this.states[id]; }
  accept(id) {
    if (this.states[id] !== 'available') return;
    this.states[id] = 'active'; this.trackedId = id;
    const m = this.story.missions[id];
    this.game.ui.notify(m.side ? 'Misión secundaria' : 'Misión aceptada', m.title);
    this.game.audio.playUI();
    this.evaluate(); this.updateTracker();
  }
  _objectiveDone(obj) {
    if (obj.type === 'collect') return this.game.inventory.count(obj.item) >= obj.count;
    return false;
  }
  evaluate() {
    for (const [id, state] of Object.entries(this.states)) {
      if (state !== 'active' && state !== 'ready') continue;
      const m = this.story.missions[id];
      const collectDone = m.objectives.filter((o) => o.type === 'collect').every((o) => this._objectiveDone(o));
      if (state === 'active' && collectDone) {
        this.states[id] = 'ready';
        this.game.ui.notify('Objetivo actualizado', m.objectives.find((o) => o.type === 'talk')?.text || '');
        this.game.audio.playUI();
      } else if (state === 'ready' && !collectDone) this.states[id] = 'active';
    }
    this.updateTracker();
  }
  complete(id, ending) {
    if (this.states[id] !== 'ready') return;
    const g = this.game, m = this.story.missions[id], inv = g.inventory;
    const end = ending && m.endings ? m.endings[ending] : null;
    const base = m.rewards || {}, extra = end ? end.rewards || {} : {};
    const money = (base.money || 0) + (extra.money || 0), honor = (base.honor || 0) + (extra.honor || 0);
    const items = { ...(base.items || {}) }; Object.entries(extra.items || {}).forEach(([k, n]) => { items[k] = (items[k] || 0) + n; });
    const flags = [...(base.flags || []), ...(extra.flags || [])];
    m.objectives.filter((o) => o.type === 'collect').forEach((o) => inv.remove(o.item, o.count, true));
    this.states[id] = 'completed';
    if (money) inv.addMoney(money);
    Object.entries(items).forEach(([item, n]) => inv.add(item, n, true));
    flags.forEach((f) => { this.flags.add(f); g.bus.emit('flag:set', f); });
    if (honor) g.honor.add(honor, m.title);
    this.trackedId = null; this.postHint = m.nextHint || this.postHint;
    g.ui.banner(m.completeTitle, end?.subtitle || m.completeSubtitle, 5);
    g.audio.playMissionComplete();
    const parts = [];
    if (money > 0) parts.push(`$${money.toFixed(2)}`);
    Object.entries(items).forEach(([k, n]) => parts.push(`${n} × ${this.story.items[k].name}`));
    if (parts.length) setTimeout(() => g.ui.notify('Recompensa', parts.join(' · ')), 1200);
    this.updateTracker();
  }
  meets(req) {
    if (!req) return true;
    if (req.money !== undefined && this.game.inventory.money < req.money - 1e-6) return false;
    return true;
  }
  runAction(action) {
    if (!action) return;
    const g = this.game;
    for (const part of String(action).split(';')) {
      const [verb, a, b] = part.trim().split(':');
      switch (verb) {
        case 'accept': this.accept(a); break;
        case 'complete': this.complete(a, b); break;
        case 'honor': g.honor.add(Number(a), 'Decisión'); break;
        case 'money': g.inventory.addMoney(Number(a)); break;
        case 'item': g.inventory.add(a, Number(b) || 1); break;
        case 'flag': this.flags.add(a); g.bus.emit('flag:set', a); break;
        case 'shop': g.openShopById(a); break;
        case 'board': g.openBoard(); break;
        case 'wanted': g.law.addBounty(Number(a), 'Decisión'); break;
        default: break;
      }
    }
  }
  getDialogueFor(npcId) {
    const list = this.story.dialogues[npcId] || [];
    return list.find((e) => this._match(e.when)) || null;
  }
  _match(w) {
    if (!w) return true;
    if (w.flag && !this.flags.has(w.flag)) return false;
    if (w.mission && this.states[w.mission] !== w.state) return false;
    if (w.honorTier && this.game.honor.tier.id !== w.honorTier) return false;
    if (w.wanted !== undefined && (this.game.law.level > 0) !== !!w.wanted) return false;
    return true;
  }
  getMarkerFor(npcId) {
    for (const [id, m] of Object.entries(this.story.missions)) {
      const st = this.states[id];
      if (st === 'available' && m.giver === npcId) return 'available';
      if (st === 'ready') {
        const talk = m.objectives.find((o) => o.type === 'talk');
        if ((talk ? talk.npc : m.giver) === npcId) return 'ready';
      }
    }
    return null;
  }
  toJSON() { return { states: { ...this.states }, flags: [...this.flags], trackedId: this.trackedId }; }
  fromJSON(data) {
    if (!data) return;
    Object.entries(data.states || {}).forEach(([id, st]) => { if (id in this.states) this.states[id] = st; });
    (data.flags || []).forEach((f) => { this.flags.add(f); this.game.bus.emit('flag:set', f); });
    this.trackedId = data.trackedId && this.states[data.trackedId] !== 'completed' ? data.trackedId : null;
    this.postHint = null;
    Object.entries(this.states).forEach(([id, st]) => { if (st === 'completed' && this.story.missions[id].nextHint) this.postHint = this.story.missions[id].nextHint; });
    this.evaluate();
  }
  updateTracker() {
    const ui = this.game.ui;
    if (this.trackedId) {
      const id = this.trackedId, m = this.story.missions[id], st = this.states[id];
      const objectives = m.objectives.map((o) => {
        if (o.type === 'collect') {
          const c = Math.min(this.game.inventory.count(o.item), o.count);
          return { text: `${o.text}: ${c}/${o.count}`, done: c >= o.count };
        }
        return { text: o.text, done: false, hidden: st !== 'ready' };
      }).filter((o) => !o.hidden);
      ui.setTracker({ title: m.title, objectives });
    } else if (this.game.bounties && this.game.bounties.trackerData()) ui.setTracker(this.game.bounties.trackerData());
    else if (this.postHint) ui.setTracker(this.postHint);
    else if (Object.entries(this.states).filter(([id]) => !this.story.missions[id].side).every(([, s]) => s === 'available')) ui.setTracker(this.story.intro);
    else ui.setTracker(null);
  }
}

export { MissionSystem };
