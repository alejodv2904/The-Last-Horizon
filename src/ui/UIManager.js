// HUD y pantallas en DOM: núcleos (salud, resistencia, caballo), radar, diálogo, tienda, inventario, avisos.
// Cada setter cachea su último valor para no tocar el DOM si nada cambió.
import { clamp } from '../core/MathUtils.js';

const CORE_C = 131.9;

class UIManager {
  constructor(story) {
    this.story = story;
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.el = {
      prompt: $('prompt'), promptKey: $('prompt-key'), promptText: $('prompt-text'), toasts: $('toasts'), tracker: $('tracker'),
      ammo: $('ammo'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'), ammoLabel: $('ammo-label'),
      stamina: $('stamina-core'), staminaArc: $('stamina-arc'), health: $('health-core'), healthArc: $('health-arc'),
      horse: $('horse-core'), horseArc: $('horse-arc'),
      clock: $('clock-time'), clockIcon: $('clock-icon'), fps: $('fps'), crosshair: $('crosshair'), ring: $('cross-ring'),
      hit: $('hitmarker'), progress: $('progress-ring'), progressArc: $('progress-arc'), dialogue: $('dialogue'),
      speaker: $('dlg-speaker'), text: $('dlg-text'), choices: $('choices'), hint: $('dlg-hint'),
      banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
      inventory: $('inventory'), invMoney: $('inv-money'), invList: $('inv-list'),
      damage: $('damage-flash'), shop: $('shop'), save: $('save-ind'), fade: $('fade'), fadeText: $('fade-text'),
      honorTier: $('honor-tier'), honorDelta: $('honor-delta'), honorMark: $('honor-mark'),
      wanted: $('wanted'), wantedStars: $('wanted-stars'), wantedText: $('wanted-text'),
      bark: $('bark'), barkWho: $('bark').querySelector('.who'), barkTxt: $('bark').querySelector('.txt'),
      quick: $('quick-use'), hitDir: $('hit-dir'), board: $('board'),
    };
    this.touch = document.documentElement.classList.contains('touch');
    // Ganchos para la interfaz táctil / Game (se asignan desde fuera)
    this.onPrompt = null; this.onChoice = null; this.onUseItem = null;
    this.el.choices.addEventListener('click', (e) => {
      const c = e.target.closest('.choice');
      if (c && this.onChoice) this.onChoice(+c.dataset.i);
    });
    this.el.invList.addEventListener('click', (e) => {
      const row = e.target.closest('[data-use]');
      if (row && this.onUseItem) this.onUseItem(row.dataset.use);
    });
    $('inv-close').addEventListener('click', () => this.closeInventory());
    this._barkTimer = null; this._honorTimer = null; this._boardHandler = null; this.inventoryUsable = [];
    this.el.board.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (b && this._boardHandler && !b.disabled) this._boardHandler(b.dataset.action, b.dataset.id);
    });
    this.radar = $('radar').getContext('2d');
    this._prompt = null; this._typing = null; this._bannerTimer = null; this._hitTimer = null; this._saveTimer = null;
    this._cache = {};
    this._shopHandler = null;
    this._init5b();
    this.el.shop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (b && this._shopHandler && !b.disabled) this._shopHandler(b.dataset.action, b.dataset.id);
    });
  }
  _set(key, value, fn) { if (this._cache[key] === value) return; this._cache[key] = value; fn(value); }

  showPrompt(key, text) {
    const v = key + text;
    if (this._prompt === v) return;
    this._prompt = v; this.el.promptKey.textContent = key; this.el.promptText.textContent = text; this.el.prompt.classList.add('show');
    if (this.onPrompt) this.onPrompt(key, text);
  }
  hidePrompt() {
    if (this._prompt === null) return;
    this._prompt = null; this.el.prompt.classList.remove('show');
    if (this.onPrompt) this.onPrompt(null);
  }

  notify(title, sub = '') {
    const d = document.createElement('div'); d.className = 'toast';
    d.innerHTML = '<div class="t"></div><div class="s"></div>';
    d.querySelector('.t').textContent = title; d.querySelector('.s').textContent = sub;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 650); }, 4200);
  }
  setTracker(data) {
    const t = this.el.tracker, key = data ? JSON.stringify(data) : '';
    if (key === this._trackerKey) return;   // sin cambios: no se toca el DOM (la campaña lo refresca cada 0.4 s)
    this._trackerKey = key;
    t.innerHTML = '';
    if (!data) return;
    const title = document.createElement('div'); title.className = 'title'; title.textContent = data.title; t.appendChild(title);
    data.objectives.forEach((o) => {
      const d = document.createElement('div'); d.className = 'obj' + (o.done ? ' done' : '');
      d.textContent = (o.done ? '✓ ' : '◆ ') + o.text; t.appendChild(d);
    });
  }
  setAmmo(mag, reserve, reloading, label) {
    this._set('ammo', `${mag}|${reserve}|${reloading}|${label}`, () => {
      this.el.ammoMag.textContent = mag; this.el.ammoRes.textContent = reserve;
      this.el.ammo.classList.toggle('reloading', reloading);
      this.el.ammoLabel.textContent = label;
    });
  }
  _core(el, arc, key, v, low) {
    this._set(key, Math.round(v) + (low ? 'x' : ''), () => {
      arc.style.strokeDashoffset = (CORE_C * (1 - clamp(v, 0, 100) / 100)).toFixed(1);
      el.classList.toggle('low', low);
    });
  }
  setStamina(v, exhausted) { this._core(this.el.stamina, this.el.staminaArc, 'stam', v, exhausted); }
  setHealth(v) { this._core(this.el.health, this.el.healthArc, 'hp', v, v < 30); }
  setHorseStamina(v, exhausted, visible) {
    this._set('horseVis', visible, (on) => this.el.horse.classList.toggle('hidden', !on));
    if (visible) this._core(this.el.horse, this.el.horseArc, 'horse', v, exhausted);
  }
  setClock(text, night) {
    this._set('clock', text, () => { this.el.clock.textContent = text; });
    this._set('clockIcon', night > 0.5, (n) => { this.el.clockIcon.textContent = n ? '☾' : '☀'; });
  }
  setCrosshair(visible, aim, spread) {
    this._set('cross', `${visible}|${aim > 0.5}|${spread.toFixed(2)}`, () => {
      this.el.crosshair.style.opacity = visible ? 1 : 0;
      this.el.ring.style.transform = `scale(${(0.55 + spread).toFixed(2)})`;
      this.el.ring.style.opacity = aim > 0.5 ? 0.25 : 0.7;
    });
  }
  hitMarker(headshot = false) {
    this.el.hit.style.filter = headshot ? 'hue-rotate(150deg) brightness(2)' : '';
    this.el.hit.classList.add('show');
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => this.el.hit.classList.remove('show'), 120);
  }
  damageFlash() {
    const d = this.el.damage;
    d.classList.remove('hit'); void d.offsetWidth; d.classList.add('hit');
  }
  flashSaved() {
    this.el.save.classList.add('show');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.el.save.classList.remove('show'), 1600);
  }
  setFade(on, text = '') { this.el.fade.classList.toggle('show', on); this.el.fadeText.textContent = text; }
  setProgress(v) {
    if (v === null) { this.el.progress.classList.remove('show'); return; }
    this.el.progress.classList.add('show');
    this.el.progressArc.style.strokeDashoffset = (213.6 * (1 - clamp(v, 0, 1))).toFixed(1);
  }
  setLetterbox(on) { document.body.classList.toggle('cinematic', on); if (on) this.hidePrompt(); }

  showDialogueLine(name, text) {
    this.el.dialogue.classList.add('show');
    this.el.speaker.textContent = name;
    this.el.choices.innerHTML = ''; this.el.hint.textContent = this.touch ? 'Toca para continuar' : '[E] continuar';
    this._typing = { text, shown: 0 };
    this.el.text.textContent = '';
  }
  isTyping() { return !!this._typing && this._typing.shown < this._typing.text.length; }
  finishTyping() { if (!this._typing) return; this._typing.shown = this._typing.text.length; this.el.text.textContent = this._typing.text; }
  showChoices(list, disabled = []) {
    this.el.speaker.textContent = this.story.player.name; this.el.text.textContent = ''; this._typing = null;
    this.el.choices.innerHTML = '';
    list.forEach((txt, i) => {
      const d = document.createElement('div'); d.className = 'choice' + (disabled[i] ? ' disabled' : ''); d.dataset.i = i;
      d.innerHTML = `<span class="key">${i + 1}</span><span></span>`;
      d.lastChild.textContent = txt; this.el.choices.appendChild(d);
    });
    this.el.hint.textContent = this.touch ? 'Toca una opción' : 'Pulsa el número para elegir';
  }
  hideChoices() { this.el.choices.innerHTML = ''; }
  hideDialogue() { this.el.dialogue.classList.remove('show'); this._typing = null; }
  banner(title, sub, seconds = 4) {
    this.el.bannerTitle.textContent = title; this.el.bannerSub.textContent = sub;
    this.el.banner.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.el.banner.classList.remove('show'), seconds * 1000);
  }

  toggleInventory(inv, upgrades) {
    const open = !this.el.inventory.classList.contains('open');
    this.el.inventory.classList.toggle('open', open);
    if (open) this.renderInventory(inv, upgrades);
  }
  closeInventory() { this.el.inventory.classList.remove('open'); }
  get inventoryOpen() { return this.el.inventory.classList.contains('open'); }
  renderInventory(inv, upgrades) {
    const ups = upgrades && upgrades.size ? ` · Mejoras: ${[...upgrades].map((u) => (u === 'barrel' ? 'cañón largo' : 'cartuchos expansivos')).join(', ')}` : '';
    this.el.invMoney.textContent = `Dinero: $${inv.money.toFixed(2)}${ups}`;
    this.el.invList.innerHTML = '';
    const entries = [...inv.items.entries()].filter(([, n]) => n > 0);
    this.inventoryUsable = [];
    if (!entries.length) { this.el.invList.innerHTML = '<div class="item"><span class="ds">Las alforjas están vacías.</span></div>'; return; }
    entries.forEach(([id, n]) => {
      const def = this.story.items[id] || { name: id, icon: '•', desc: '' };
      let right = `×${n}`;
      const usable = !!def.use && this.inventoryUsable.length < 9;
      if (usable) { this.inventoryUsable.push(id); right = this.touch ? `×${n}  ·  Usar` : `×${n}  ·  [${this.inventoryUsable.length}] usar`; }
      const row = this._itemRow(def, right);
      if (usable) { row.dataset.use = id; row.classList.add('usable'); }
      this.el.invList.appendChild(row);
    });
  }
  _itemRow(def, right, button) {
    const d = document.createElement('div'); d.className = 'item';
    d.innerHTML = '<span class="ic"></span><div class="tx"><div class="nm"></div><div class="ds"></div></div><span class="ct"></span>';
    d.querySelector('.ic').textContent = def.icon; d.querySelector('.nm').textContent = def.name;
    d.querySelector('.ds').textContent = def.desc || ''; d.querySelector('.ct').textContent = right;
    if (button) d.appendChild(button);
    return d;
  }
  _button(label, action, id, disabled) {
    const b = document.createElement('button'); b.className = 'sbtn'; b.textContent = label;
    b.dataset.action = action; if (id) b.dataset.id = id; b.disabled = !!disabled;
    return b;
  }

  showShop(view, handler) {
    this._shopHandler = handler;
    this.closeInventory(); this.hidePrompt();
    this.el.shop.classList.add('open');
    document.body.classList.add('shopping');
    this.renderShop(view);
  }
  hideShop() { this.el.shop.classList.remove('open'); document.body.classList.remove('shopping'); this._shopHandler = null; }
  renderShop(v) {
    const s = this.el.shop;
    s.querySelector('.shop-title').textContent = v.title;
    s.querySelector('.shop-greet').textContent = `«${v.greeting}»`;
    s.querySelector('.shop-money').textContent = `Tu dinero: $${v.money.toFixed(2)}`;
    const sell = s.querySelector('.shop-sell'), buy = s.querySelector('.shop-buy');
    sell.innerHTML = ''; buy.innerHTML = '';
    v.sell.forEach((it) => sell.appendChild(this._itemRow(it, `${it.count} × $${it.price.toFixed(2)}`,
      this._button(it.count ? `Vender ($${(it.count * it.price).toFixed(2)})` : 'Vender', 'sell', it.id, it.count === 0))));
    v.buy.forEach((it) => buy.appendChild(this._itemRow(it, `$${it.price.toFixed(2)}`,
      this._button(it.owned ? 'Comprado' : 'Comprar', 'buy', it.id, it.owned || !it.affordable))));
  }

  /* ---------- Fase 3: honor, se busca, frases, tablón ---------- */
  setHonor(ratio, tierName) {
    this._set('honorMark', ratio.toFixed(3), () => { this.el.honorMark.style.left = `${(ratio * 100).toFixed(1)}%`; });
    this._set('honorTier', tierName, () => { this.el.honorTier.textContent = tierName; });
  }
  honorDelta(text, up) {
    const d = this.el.honorDelta; d.textContent = text; d.className = `show ${up ? 'up' : 'down'}`;
    clearTimeout(this._honorTimer); this._honorTimer = setTimeout(() => { d.className = up ? 'up' : 'down'; }, 2200);
  }
  setWanted(level, bounty) {
    this._set('wanted', `${level}|${bounty}`, () => {
      this.el.wanted.classList.toggle('show', level > 0);
      this.el.wantedStars.textContent = '★'.repeat(level) + '☆'.repeat(Math.max(0, 3 - level));
      this.el.wantedText.textContent = `SE BUSCA · $${bounty}`;
    });
  }
  bark(who, text) {
    this.el.barkWho.textContent = who ? `${who}:` : ''; this.el.barkTxt.textContent = `«${text}»`;
    this.el.bark.classList.add('show');
    clearTimeout(this._barkTimer); this._barkTimer = setTimeout(() => this.el.bark.classList.remove('show'), 3300);
  }
  setQuick(text) { this._set('quick', text || '', () => { this.el.quick.textContent = text || ''; this.el.quick.classList.toggle('show', !!text); }); }
  setLowHealth(on) { this._set('lowhp', on, (v) => document.body.classList.toggle('lowhp', v)); }
  // angle: ángulo (rad, sentido horario desde "arriba") de donde vino el disparo respecto a la cámara
  hitDirection(angle) {
    const h = this.el.hitDir; h.style.transform = `rotate(${angle}rad)`;
    h.classList.remove('show'); void h.offsetWidth; h.classList.add('show');
  }
  showBoard(view, handler) {
    this._boardHandler = handler;
    this.closeInventory(); this.hidePrompt();
    this.el.board.classList.add('open'); document.body.classList.add('shopping');
    this.renderBoard(view);
  }
  hideBoard() { this.el.board.classList.remove('open'); document.body.classList.remove('shopping'); this._boardHandler = null; }
  renderBoard(v) {
    const b = this.el.board;
    b.querySelector('.shop-title').textContent = v.title; b.querySelector('.board-sub').textContent = v.subtitle;
    b.querySelector('.board-info').textContent = `Tu dinero: $${v.money.toFixed(2)} · Reputación: ${v.honor}` + (v.wanted > 0 ? ` · SE BUSCA: $${v.wanted}` : '');
    const payBtn = b.querySelector('[data-action="pay"]'); payBtn.textContent = v.canPay ? `Pagar mi recompensa ($${v.wanted})` : 'Sin cargos pendientes'; payBtn.disabled = !v.canPay;
    const list = b.querySelector('.board-list'); list.innerHTML = '';
    v.contracts.forEach((c) => {
      const d = document.createElement('div'); d.className = 'contract' + (c.state === 'completed' ? ' done' : '');
      d.innerHTML = '<div class="tx"><div class="nm"></div><div class="tg"></div><div class="ds"></div><div class="rw"></div></div><div class="btns"></div>';
      d.querySelector('.nm').textContent = c.title; d.querySelector('.tg').textContent = `Objetivo: ${c.target}`; d.querySelector('.ds').textContent = c.desc;
      const rw = c.reward.alive ? `Recompensa: $${c.reward.alive.toFixed(2)} vivo · $${c.reward.dead.toFixed(2)} muerto` : `Recompensa: $${c.reward.dead.toFixed(2)}`;
      const st = c.state === 'completed' ? ' · COBRADO' : c.state === 'active' ? ' · EN CURSO' : c.state === 'ready' ? ' · LISTO PARA COBRAR' : '';
      d.querySelector('.rw').textContent = rw + (c.type === 'cleanup' && c.state !== 'available' && c.state !== 'completed' ? ` · ${Math.min(c.progress, c.count)}/${c.count}` : '') + st;
      const btns = d.querySelector('.btns');
      if (c.state === 'available') btns.appendChild(this._button('Aceptar contrato', 'accept', c.id, c.busy));
      if (c.state === 'active' || c.state === 'ready') btns.appendChild(this._button('Abandonar', 'abandon', c.id, false));
      if (c.canClaimAlive) btns.appendChild(this._button(`Entregar vivo ($${c.reward.alive.toFixed(2)})`, 'claimAlive', c.id, false));
      if (c.state === 'ready') btns.appendChild(this._button(c.type === 'leader' ? `Entregar prueba ($${c.reward.dead.toFixed(2)})` : `Cobrar ($${c.reward.dead.toFixed(2)})`, 'claimDead', c.id, !c.canClaimDead));
      list.appendChild(d);
    });
  }


  /* ---------- Fase 5B: Dead Eye, duelo, tarjetas de capítulo, créditos, clima ---------- */
  _init5b() {
    const $ = this.$;
    Object.assign(this.el, {
      deadCore: $('deadeye-core'), deadArc: $('deadeye-arc'), duel: $('duel-ui'), duelName: $('duel-name'), duelSub: $('duel-sub'), duelFlash: $('duel-flash'),
      duelGauge: $('duel-gauge'), duelFill: $('duel-gauge').querySelector('.fill'), duelZone: $('duel-gauge').querySelector('.zone'), duelPromptEl: $('duel-prompt'),
      card: $('chapter-card'), ccKicker: $('cc-kicker'), ccTitle: $('cc-title'), ccSub: $('cc-sub'), credits: $('credits'), creditsRoll: $('credits-roll'), creditsSkip: $('credits-skip'),
    });
    this.marks = [...document.querySelectorAll('#de-marks .de-mark')];
  }
  // Núcleo de Dead Eye (junto a salud y resistencia)
  setDeadEye(v, active) {
    this._core(this.el.deadCore, this.el.deadArc, 'dead', v, false);
    this._set('deActive', !!active, (on) => this.el.deadCore.classList.toggle('active', on));
  }
  // Cruces rojas de los objetivos marcados (elementos DOM reutilizados: nunca se crean ni se destruyen en partida)
  setMark(i, x, y, show) {
    const m = this.marks[i]; if (!m) return;
    if (!show) { if (m._on) { m.style.display = 'none'; m._on = false; } return; }
    if (!m._on) { m.style.display = 'block'; m._on = true; }
    m.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }
  clearMarks() { this.marks.forEach((m, i) => this.setMark(i, 0, 0, false)); }

  // Interfaz de Duelo del Oeste
  duelShow(name, sub) {
    this.el.duelName.textContent = name; this.el.duelSub.textContent = sub || '';
    this.el.duel.classList.add('show'); this._duelSweet = null;
  }
  duelHide() { this.el.duel.classList.remove('show'); this.el.duelPromptEl.textContent = ''; }
  duelPrompt(t) {
    if (this.touch) t = t.replace('Mantén el CLIC IZQUIERDO', 'Mantén DISPARAR').replace('Clic derecho o ESPACIO: desenfunda', 'Toca APUNTAR: desenfunda');
    this.el.duelPromptEl.textContent = t;
  }
  duelGauge(value, sweet, jitter) {
    if (!this._duelSweet) { this._duelSweet = true; this.el.duelZone.style.left = `${sweet[0]}%`; this.el.duelZone.style.width = `${sweet[1] - sweet[0]}%`; }
    this.el.duelFill.style.width = `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
    this._set('duelJit', !!jitter, (j) => this.el.duelGauge.classList.toggle('jitter', j));
  }
  duelFlash(text) {
    const f = this.el.duelFlash; f.textContent = text; f.classList.remove('pop'); void f.offsetWidth; f.classList.add('pop');
  }

  // Tarjeta de capítulo: pantalla negra, tipografía Western (Rye). `onBlack` se ejecuta con la pantalla totalmente negra
  // (aquí se mueve el mundo: campamento, protagonista…). `done` cuando la tarjeta termina de desvanecerse.
  showCard(c, done, onBlack) {
    const e = this.el;
    e.ccKicker.textContent = c.kicker; e.ccTitle.textContent = c.title; e.ccSub.textContent = c.sub || '';
    e.card.classList.remove('show'); void e.card.offsetWidth; e.card.classList.add('show'); this.hidePrompt();
    setTimeout(() => { if (onBlack) onBlack(); }, 1400);
    setTimeout(() => e.card.classList.remove('show'), (1.4 + c.hold) * 1000);
    setTimeout(() => { if (done) done(); }, (1.4 + c.hold + 1.4) * 1000);
  }
  // Créditos finales: lista de { h } títulos, { s, t } entradas o '' (espacio). Avanza sola; se puede continuar con el botón.
  showCredits(lines, done) {
    const e = this.el, roll = e.creditsRoll; roll.innerHTML = '';
    lines.forEach((l) => {
      const d = document.createElement('div');
      if (!l) { d.style.height = '34px'; } else if (l.h) { d.className = 'cr-h'; d.textContent = l.h; } else { if (l.s) { const s = document.createElement('div'); s.className = 'cr-s'; s.textContent = l.s; d.appendChild(s); } if (l.t) { const t = document.createElement('div'); t.className = 'cr-t'; t.textContent = l.t; d.appendChild(t); } }
      roll.appendChild(d);
    });
    const dur = Math.max(30, lines.length * 3.4);
    roll.style.animation = 'none'; void roll.offsetWidth; roll.style.animation = `creditsRoll ${dur}s linear forwards`;
    e.credits.classList.add('show'); e.creditsSkip.classList.remove('show');
    let finished = false;
    const end = () => { if (finished) return; finished = true; e.credits.classList.remove('show'); e.creditsSkip.onclick = null; roll.onanimationend = null; setTimeout(() => done && done(), 1500); };
    roll.onanimationend = end; e.creditsSkip.onclick = end;
    setTimeout(() => e.creditsSkip.classList.add('show'), 4000);
  }
  // Clima/peligro ambiental como overlay CSS (gratis para la GPU): cold | heat | storm | fever | fire | null
  setWeather(kind) {
    this._set('wx', kind || '', (k) => { ['cold', 'heat', 'storm', 'fever', 'fire'].forEach((n) => document.body.classList.toggle(`wx-${n}`, n === k)); });
  }

  setFps(text) { this.el.fps.textContent = text; }
  update(dt) {
    if (this._typing && this._typing.shown < this._typing.text.length) {
      this._typing.shown = Math.min(this._typing.text.length, this._typing.shown + dt * 48);
      this.el.text.textContent = this._typing.text.slice(0, Math.floor(this._typing.shown));
    }
  }

  // Radar orientado con la cámara. info.icons: [{x, z, type, clamp}]
  drawRadar(info) {
    const ctx = this.radar, S = 170, C = S / 2, R = C - 4, scale = R / info.range;
    const sy = Math.sin(info.yaw), cy = Math.cos(info.yaw);
    const proj = (wx, wz, clampEdge) => {
      const dx = wx - info.px, dz = wz - info.pz;
      let sx = (dx * -cy + dz * sy) * scale, syy = -(dx * sy + dz * cy) * scale;
      const d = Math.hypot(sx, syy);
      if (clampEdge && d > R - 9) { sx *= (R - 9) / d; syy *= (R - 9) / d; }
      return [C + sx, C + syy, d];
    };
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.clip();
    const bg = ctx.createRadialGradient(C, C, 10, C, C, R);
    bg.addColorStop(0, 'rgba(70,58,40,0.82)'); bg.addColorStop(1, 'rgba(28,22,14,0.9)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(216,180,106,0.18)'; ctx.lineWidth = 1;
    [R * 0.33, R * 0.66].forEach((r) => { ctx.beginPath(); ctx.arc(C, C, r, 0, Math.PI * 2); ctx.stroke(); });
    if (info.roads) {
      ctx.strokeStyle = 'rgba(200,160,110,0.55)'; ctx.lineWidth = 3;
      info.roads.forEach((road) => {
        ctx.beginPath();
        road.forEach(([x, z], i) => { const [a, b] = proj(x, z, false); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
        ctx.stroke();
      });
    }
    info.zones.forEach((z) => {
      const [x, y] = proj(z.x, z.z, false);
      ctx.beginPath(); ctx.arc(x, y, z.r * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(190,70,50,0.16)'; ctx.fill();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(220,110,80,0.6)'; ctx.stroke(); ctx.setLineDash([]);
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const ic of info.icons) {
      const [x, y, dist] = proj(ic.x, ic.z, ic.clamp);
      if (!ic.clamp && dist > R) continue;
      switch (ic.type) {
        case 'camp':
          ctx.fillStyle = '#e9dcb9'; ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y + 5); ctx.lineTo(x - 7, y + 5); ctx.closePath(); ctx.fill(); break;
        case 'shop':
          ctx.fillStyle = '#9fd08a'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#1a1209'; ctx.font = 'bold 11px Georgia'; ctx.fillText('$', x, y + 0.5); break;
        case 'horse':
          ctx.fillStyle = '#c8d8ff'; ctx.font = 'bold 13px Georgia'; ctx.fillText('♞', x, y); break;
        case 'npc': case 'npcReady':
          ctx.fillStyle = ic.type === 'npcReady' ? '#ffffff' : '#e8c25a'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#1a1209'; ctx.font = 'bold 10px Georgia'; ctx.fillText('!', x, y + 0.5); break;
        case 'deer': ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill(); break;
        case 'wolf': ctx.fillStyle = '#ff6a4a'; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y + 3); ctx.lineTo(x - 4, y + 3); ctx.closePath(); ctx.fill(); break;
        case 'carcass': ctx.fillStyle = '#ff5a3c'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); break;
        case 'town':
          ctx.fillStyle = '#f0c860'; ctx.beginPath(); ctx.moveTo(x - 7, y + 5); ctx.lineTo(x - 7, y - 1); ctx.lineTo(x, y - 7); ctx.lineTo(x + 7, y - 1); ctx.lineTo(x + 7, y + 5); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#1a1209'; ctx.fillRect(x - 1.5, y + 0.5, 3, 4.5); break;
        case 'bandit': ctx.fillStyle = '#e03a2a'; ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); break;
        case 'banditCamp':
          ctx.fillStyle = '#c0301f'; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y + 5); ctx.lineTo(x - 6, y + 5); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 8px Georgia'; ctx.fillText('☠', x, y + 2); break;
        case 'law': ctx.fillStyle = '#6aa8ff'; ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); break;
        case 'event': ctx.fillStyle = '#ffd860'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#1a1209'; ctx.font = 'bold 11px Georgia'; ctx.fillText('?', x, y + 0.5); break;
        case 'objective': ctx.fillStyle = '#ffd860'; ctx.strokeStyle = '#1a1209'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
        case 'board': ctx.fillStyle = '#d8c496'; ctx.fillRect(x - 5, y - 5, 10, 10); ctx.fillStyle = '#7a1810'; ctx.font = 'bold 8px Georgia'; ctx.fillText('$', x, y + 0.5); break;
        default: break;
      }
    }
    const [nx, ny] = proj(info.px, info.pz - 100000, true);
    ctx.fillStyle = '#d8b46a'; ctx.font = 'bold 12px Georgia'; ctx.fillText('N', nx, ny);
    ctx.restore();
    const hx = Math.sin(info.heading), hz = Math.cos(info.heading);
    const ang = Math.atan2(hx * -cy + hz * sy, (hx * sy + hz * cy));
    ctx.save(); ctx.translate(C, C); ctx.rotate(ang);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  }
}

export { UIManager };
