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
    this.game.ui.notify('Misión aceptada', m.title);
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
  complete(id) {
    if (this.states[id] !== 'ready') return;
    const m = this.story.missions[id], inv = this.game.inventory;
    m.objectives.filter((o) => o.type === 'collect').forEach((o) => inv.remove(o.item, o.count, true));
    this.states[id] = 'completed';
    if (m.rewards.money) inv.addMoney(m.rewards.money);
    Object.entries(m.rewards.items || {}).forEach(([item, n]) => inv.add(item, n, true));
    (m.rewards.flags || []).forEach((f) => { this.flags.add(f); this.game.bus.emit('flag:set', f); });
    this.trackedId = null; this.postHint = m.nextHint || null;
    this.game.ui.banner(m.completeTitle, m.completeSubtitle, 5);
    this.game.audio.playMissionComplete();
    const rewardText = [`$${m.rewards.money.toFixed(2)}`, ...Object.entries(m.rewards.items || {}).map(([k, n]) => `${n} × ${this.story.items[k].name}`)].join(' · ');
    setTimeout(() => this.game.ui.notify('Recompensa', rewardText), 1200);
    this.updateTracker();
  }
  runAction(action) {
    if (!action) return;
    const [verb, arg] = action.split(':');
    if (verb === 'accept') this.accept(arg);
    else if (verb === 'complete') this.complete(arg);
  }
  getDialogueFor(npcId) {
    const list = this.story.dialogues[npcId] || [];
    return list.find((e) => this._match(e.when)) || null;
  }
  _match(w) {
    if (!w) return true;
    if (w.flag && !this.flags.has(w.flag)) return false;
    if (w.mission && this.states[w.mission] !== w.state) return false;
    return true;
  }
  getMarkerFor(npcId) {
    for (const [id, m] of Object.entries(this.story.missions)) {
      if (m.giver !== npcId) continue;
      if (this.states[id] === 'available') return 'available';
      if (this.states[id] === 'ready') return 'ready';
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
    } else if (this.postHint) ui.setTracker(this.postHint);
    else if (Object.values(this.states).every((s) => s === 'available')) ui.setTracker(this.story.intro);
    else ui.setTracker(null);
  }
}

export { MissionSystem };
