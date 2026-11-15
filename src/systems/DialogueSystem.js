class DialogueSystem {
  constructor(game) { this.game = game; this.active = false; this.queue = []; this.choices = null; this.pendingChoices = null; this.actions = []; this.justStarted = false; }
  start(npc) {
    const g = this.game, entry = g.missions.getDialogueFor(npc.id);
    if (!entry) return;
    this.npc = npc; this.active = true; this.justStarted = true;
    this.queue = entry.lines.slice(); this.pendingChoices = entry.choices || null; this.choices = null;
    this.actions = entry.action ? [entry.action] : [];
    g.setMode('dialogue');
    g.player.faceTarget = npc.position; npc.talking = true;
    const a = g.player.position, b = npc.position;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const px = dz / len, pz = -dx / len;
    const camSide = (g.camera.position.x - (a.x + b.x) / 2) * px + (g.camera.position.z - (a.z + b.z) / 2) * pz;
    g.cine.side = camSide >= 0 ? 1 : -1;
    g.ui.setLetterbox(true);
    this._next();
  }
  _speaker(line) { return line.speaker === 'player' ? this.game.story.player.name : this.npc.name; }
  _next() {
    const ui = this.game.ui;
    if (this.queue.length) {
      const line = this.queue.shift();
      this.currentSpeaker = line.speaker;
      ui.showDialogueLine(this._speaker(line), line.text);
      return;
    }
    if (this.pendingChoices) {
      this.choices = this.pendingChoices; this.pendingChoices = null;
      ui.showChoices(this.choices.map((c) => c.text));
      return;
    }
    this.end();
  }
  update(dt, input) {
    if (!this.active) return;
    if (this.justStarted) { this.justStarted = false; return; }
    if (this.choices) {
      for (let i = 0; i < this.choices.length; i++) {
        if (input.wasPressed(`Digit${i + 1}`) || input.wasPressed(`Numpad${i + 1}`)) { input.consume(); this.choose(i); return; }
      }
      return;
    }
    if (input.wasPressed('KeyE') || input.wasPressed('Space') || input.wasPressed('Enter') || input.mouse.leftPressed) {
      // Se consume la entrada para que la misma tecla/clic no dispare ni reabra el diálogo al cerrarse.
      input.consume();
      if (this.game.ui.isTyping()) this.game.ui.finishTyping(); else this._next();
    }
  }
  choose(i) {
    const c = this.choices[i]; this.choices = null;
    this.game.ui.hideChoices(); this.game.audio.playUI();
    if (c.action) this.actions.push(c.action);
    this.queue = (c.reply || []).slice();
    this._next();
  }
  end() {
    const g = this.game;
    this.active = false; this.npc.talking = false;
    g.ui.hideDialogue(); g.ui.setLetterbox(false);
    g.player.faceTarget = null;
    g.setMode('explore');
    const acts = this.actions; this.actions = [];
    setTimeout(() => acts.forEach((a) => g.missions.runAction(a)), 500);
  }
}

export { DialogueSystem };
