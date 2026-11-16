// Diálogos cinematográficos: líneas con orador, opciones con requisitos (p. ej. dinero) y acciones al terminar.
// Fase 5B: también reproduce escenas de la campaña (varios hablantes, líneas condicionales onlyIf/unless, opciones con callbacks).
class DialogueSystem {
  constructor(game) { this.game = game; this.active = false; this.queue = []; this.choices = null; this.pendingChoices = null; this.actions = []; this.justStarted = false; this.onEnd = null; this.emotional = false; this.currentSpeaker = 'npc'; }

  // Diálogo clásico con un PNJ: la entrada sale de chapter1.json (o de la campaña, que tiene prioridad).
  start(npc) {
    const g = this.game, entry = (g.campaign && g.campaign.getDialogueFor(npc.id)) || g.missions.getDialogueFor(npc.id);
    if (!entry) return;
    this.play(entry, npc);
  }

  // entry: { lines, choices?, action?, onEnd?, emotional? }. npc: PNJ ancla de la cámara (puede ser un objeto { position, name } improvisado).
  play(entry, npc) {
    const g = this.game, flags = g.missions.flags;
    const pass = (e) => (!e.onlyIf || flags.has(e.onlyIf)) && (!e.unless || !flags.has(e.unless));
    this.npc = npc; this.active = true; this.justStarted = true; this.onEnd = entry.onEnd || null; this.emotional = !!entry.emotional;
    this.queue = (entry.lines || []).filter(pass); this.pendingChoices = entry.choices || null; this.choices = null;
    this.actions = entry.action ? [entry.action] : [];
    g.setMode('dialogue');
    g.player.faceTarget = npc.position; npc.talking = true;
    const a = g.player.position, b = npc.position;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const px = dz / len, pz = -dx / len;
    const camSide = (g.camera.position.x - (a.x + b.x) / 2) * px + (g.camera.position.z - (a.z + b.z) / 2) * pz;
    g.cine.side = camSide >= 0 ? 1 : -1;
    g.ui.setLetterbox(true); g.audio.setDuck(true);
    this._next();
  }

  // Posición de quien habla (para que la cámara cinemática encuadre al orador real si está en escena).
  speakerPos() {
    const g = this.game, s = this.currentSpeaker;
    if (s === 'player') return g.player.position;
    const n = g.npcs.find((x) => x.id === s && x.active);
    return n ? n.position : this.npc.position;
  }
  _speaker(line) {
    const g = this.game;
    if (line.speaker === 'player') return g.story.player.name;
    if (line.speaker === 'npc') return this.npc.name;
    if (line.speaker === 'narrator') return '';
    return (g.story.npcs[line.speaker] && g.story.npcs[line.speaker].name) || this.npc.name;
  }
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
      const ms = this.game.missions;
      ui.showChoices(this.choices.map((c) => (c.requires && !ms.meets(c.requires) ? `${c.text}  [no te alcanza]` : c.text)),
        this.choices.map((c) => !!(c.requires && !ms.meets(c.requires))));
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
    const c = this.choices[i], list = this.choices; this.choices = null;
    const flags = this.game.missions.flags;
    this.game.ui.hideChoices(); this.game.audio.playUI();
    if (c.requires && !this.game.missions.meets(c.requires)) {   // no cumple: responde el PNJ y se vuelven a ofrecer las opciones
      this.queue = (c.altReply || []).slice(); this.pendingChoices = list; this._next(); return;
    }
    if (c.action) this.actions.push(c.action);
    if (c.fn) c.fn(c);   // callback directo (decisiones morales de la campaña)
    this.queue = (c.reply || []).filter((e) => (!e.onlyIf || flags.has(e.onlyIf)) && (!e.unless || !flags.has(e.unless)));
    this._next();
  }
  end() {
    const g = this.game, cb = this.onEnd;
    this.active = false; this.npc.talking = false; this.onEnd = null;
    g.ui.hideDialogue(); g.ui.setLetterbox(false); g.audio.setDuck(false);
    g.player.faceTarget = null;
    g.setMode('explore');
    const acts = this.actions; this.actions = [];
    setTimeout(() => acts.forEach((a) => g.missions.runAction(a)), 500);
    if (cb) cb();
  }
  // Cierra un diálogo en curso sin ejecutar acciones (al morir o cargar partida).
  abort() { if (!this.active) return; this.queue = []; this.pendingChoices = null; this.choices = null; this.actions = []; this.onEnd = null; this.npc.talking = false; this.active = false; this.game.ui.hideDialogue(); this.game.ui.setLetterbox(false); this.game.audio.setDuck(false); this.game.player.faceTarget = null; if (this.game.mode === 'dialogue') this.game.setMode('explore'); }
}

export { DialogueSystem };
