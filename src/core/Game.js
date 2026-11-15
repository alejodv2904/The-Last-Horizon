// Orquestador: bucle principal, modos de juego, interacciones, cámara cinemática y rendimiento.
// Modos: explore | dialogue | skinning | action | shop | board | arrested | dead | duel | cutscene
import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { Settings } from './Settings.js';
import { clamp, lerp, damp, easeInOut, distXZ } from './MathUtils.js';
import { EventBus } from './EventBus.js';
import { InputManager } from './InputManager.js';
import { createSharedMaterials } from '../render/GeometryKit.js';
import { ParticleSystem } from '../render/ParticleSystem.js';
import { EffectsHub } from '../render/EffectsPool.js';
import { AudioSynthesizer } from '../systems/AudioSynthesizer.js';
import { WorldManager } from '../world/WorldManager.js';
import { PlayerController } from '../entities/PlayerController.js';
import { Horse } from '../entities/Horse.js';
import { NPC } from '../entities/NPC.js';
import { WildlifeAI } from '../ai/WildlifeAI.js';
import { BanditSystem } from '../ai/BanditSystem.js';
import { Inventory } from '../systems/Inventory.js';
import { MissionSystem } from '../systems/MissionSystem.js';
import { DialogueSystem } from '../systems/DialogueSystem.js';
import { ShopSystem } from '../systems/ShopSystem.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { HunterInstinct } from '../systems/HunterInstinct.js';
import { HonorSystem } from '../systems/HonorSystem.js';
import { LawSystem } from '../systems/LawSystem.js';
import { TownLife } from '../systems/TownLife.js';
import { BountySystem } from '../systems/BountySystem.js';
import { LootSystem } from '../systems/Loot.js';
import { UIManager } from '../ui/UIManager.js';
import { MenuManager } from '../ui/MenuManager.js';
import { DeadEye } from '../systems/DeadEye.js';
import { DuelSystem } from '../systems/DuelSystem.js';
import { CampaignManager } from '../narrative/CampaignManager.js';
import { StoryDirector } from '../narrative/StoryDirector.js';

class Game {
  // data: { story, shops: { pike, hattie }, town, bounties, campaign }
  constructor(data) {
    const { story } = data;
    this.bus = new EventBus();
    this.settings = new Settings();
    this.story = story; this.townData = data.town;
    this.renderer = new THREE.WebGLRenderer({ antialias: this.settings.get('quality') !== 'low', powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_PIXEL_RATIO, this.settings.quality.pixelMax);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game-root').appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1000);

    createSharedMaterials();
    this.ui = new UIManager(this.story);
    this.audio = new AudioSynthesizer(this.settings);
    this.input = new InputManager(this.renderer.domElement, this.bus);
    this.world = new WorldManager(this);
    this.fx = { dust: new ParticleSystem(this.scene, 320, THREE.NormalBlending), glow: new ParticleSystem(this.scene, 240, THREE.AdditiveBlending) };
    this.fx.impact = new EffectsHub(this);   // estelas, agujeros de bala, huellas e impactos: todo con object pooling
    this.inventory = new Inventory(this.bus, this.story.items);
    this.inventory.add('ammo', CONFIG.START_AMMO, true);
    this.upgrades = new Set();
    this.hints = new Set();
    this.honor = new HonorSystem(this, this.townData.honor);
    this.deadEye = new DeadEye(this); this.duel = new DuelSystem(this);
    this.player = new PlayerController(this);
    this.horse = new Horse(this, CONFIG.HORSE_SPAWN.x, CONFIG.HORSE_SPAWN.z);
    const post = this.world.post, ts = this.world.town.spots;
    const townNpc = (id, palette, interaction, spot, fx, fz, extra = {}) => new NPC(this, { id, palette, interaction, x: spot.x, z: spot.z, faceX: spot.x + fx, faceZ: spot.z + fz, lite: true, viewDist: 140, ...extra });
    this.npcs = [
      new NPC(this, { id: 'silas', palette: 'silas', interaction: 'dialogue', x: -2.3, z: -2.1, faceX: CONFIG.PLAYER_SPAWN.x, faceZ: CONFIG.PLAYER_SPAWN.z }),
      new NPC(this, { id: 'pike', palette: 'trader', interaction: 'shop', x: post.traderPos.x, z: post.traderPos.z, faceX: post.traderFace.x, faceZ: post.traderFace.z }),
      townNpc('hattie', 'storekeeper', 'dialogue', ts.hattie, 0, 10, { shopId: 'hattie' }),
      townNpc('tomas', 'tomas', 'dialogue', ts.tomas, 0, -10),
      townNpc('clara', 'clara', 'dialogue', ts.clara, 0, -10),
      townNpc('pruitt', 'pruitt', 'dialogue', ts.pruitt, 0, 10),
      townNpc('sal', 'barkeep', 'dialogue', ts.sal, 0, 10),
    ];
    this.wildlife = new WildlifeAI(this);
    this.missions = new MissionSystem(this, this.story);
    this.dialogue = new DialogueSystem(this);
    this.shop = new ShopSystem(this, data.shops);
    this.instinct = new HunterInstinct(this);
    this.save = new SaveSystem(this);
    this.loot = new LootSystem(this);
    this.bandits = new BanditSystem(this);
    this.townLife = new TownLife(this, this.world.town, this.townData);
    this.law = new LawSystem(this, this.bandits, this.world.town, this.townData);
    this.bandits.law = this.law;
    this.bounties = new BountySystem(this, data.bounties);
    this.director = new StoryDirector(this);
    this.campaign = new CampaignManager(this, data.campaign); this.campaign.director = this.director;
    this.applyQuality(this.settings.get('quality'), true);
    this.menu = new MenuManager(this);

    this.mode = 'explore'; this.started = false; this.paused = true; this.elapsed = 0; this.musicState = 'calm'; this._combatT = 0;
    this.skinning = null; this.death = null; this.action = null;
    this.cine = { blend: 0, side: 1, pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this._camPos = new THREE.Vector3(); this._camLook = new THREE.Vector3(); this._v = new THREE.Vector3();
    this.perf = { frames: 0, time: 0, lowStreak: 0, highStreak: 0 };
    this.clock = new THREE.Clock();
    this._radarTick = 0; this._inTown = false; this._saloonPos = this.world.town.local(-16, -12);

    this._bindEvents();
    this.missions.updateTracker();
    this._updateCamera(0.016, true);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // Calidad gráfica (Baja / Media / Alta): resolución, sombras, niebla y distancia de chunks, vegetación (InstancedMesh), partículas,
  // radio de la IA y capas de música. El suavizado de bordes (MSAA) solo se decide al crear el contexto: se aplica al recargar.
  applyQuality(id, silent = false) {
    this.settings.set('quality', id);
    const q = this.settings.quality;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, q.pixelMax); this.renderer.setPixelRatio(this.pixelRatio);
    this.world.setQuality(q); this.fx.impact.setQuality(q);
    this.fx.dust.limit = Math.max(40, Math.floor(this.fx.dust.capacity * q.particles)); this.fx.glow.limit = Math.max(30, Math.floor(this.fx.glow.capacity * q.particles));
    CONFIG.AI_ACTIVE_RADIUS = q.aiRadius;
    for (const n of this.npcs) if (n.viewDist > q.npcView) n.viewDist = q.npcView;
    if (this.audio.music) this.audio.music.setLayers(q.musicLayers);
    if (!silent) this.ui.notify(`Calidad gráfica: ${q.label}`, id === 'low' ? 'Sin sombras y menos vegetación. El suavizado de bordes se aplica al recargar.' : 'Aplicada.');
  }

  // PNJ de la campaña (se crean y retiran en caliente).
  addNPC(cfg) { const n = new NPC(this, cfg); this.npcs.push(n); return n; }
  removeNPC(id) {
    const i = this.npcs.findIndex((n) => n.id === id && n.dynamic !== false); if (i < 1) return;   // el índice 0 es Silas y nunca se borra
    const n = this.npcs[i]; this.npcs.splice(i, 1); n.dispose();
  }

  get _menuMode() { return this.mode === 'shop' || this.mode === 'board'; }

  _bindEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('beforeunload', () => this.save.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save.save(); });
    this.bus.on('pointerlock', (locked) => {
      if (!this.started) return;
      if (locked) { this.paused = false; document.getElementById('overlay-pause').classList.add('hidden'); this.audio.init(); this.menu.refreshSlots(); }
      else if (!this.input.fallback && !this._menuMode) {
        this.paused = true; document.getElementById('overlay-pause').classList.remove('hidden'); this.input.mouse.right = false;
        this.deadEye.deactivate();
        this.save.save(); this.menu.refreshSlots();
      }
    });
    this.bus.on('pointerlock:error', (fallback) => {
      if (!this.started || this._menuMode) return;
      if (fallback) {
        this.paused = false; document.getElementById('overlay-pause').classList.add('hidden');
        this._hint('nolock', 'Modo sin captura de ratón', 'El navegador no permite bloquear el puntero; mueve el ratón dentro de la ventana.');
      } else { this.paused = true; document.getElementById('overlay-pause').classList.remove('hidden'); }
    });
    this.bus.on('inventory:changed', (e) => {
      if (this.ui.inventoryOpen) this.ui.renderInventory(this.inventory, this.upgrades);
      if (!e.silent && e.delta > 0) {
        const def = this.story.items[e.id];
        if (def) { this.ui.notify(`+${e.delta} ${def.name}`, def.desc); this.audio.playItem(); }
      }
    });
    this.bus.on('flag:set', (f) => { this.world.applyFlag(f); this.townLife.applyFlag(f); if (f === 'reed_dead') this.law.retireSheriff(); if (this.started) this.save.save(); });
    this.bus.on('animal:killed', (a) => {
      if (a.species === 'deer') this._hint('skin', 'Ciervo abatido', 'Acércate al cuerpo y pulsa [E] para despellejarlo.');
      else this._hint('skinwolf', 'Lobo abatido', 'Su piel vale buen dinero en el puesto de Pike.');
    });
  }

  _hint(id, title, text) { if (this.hints.has(id)) return; this.hints.add(id); this.ui.notify(title, text); }

  start(continueSave) {
    if (this.started) return;
    this.audio.init();
    this.started = true; this.paused = false;
    this.input.enabled = true;
    this.save.enabled = false;   // durante la carga se emiten banderas que dispararían guardados con el estado a medio restaurar
    try {
      if (continueSave && this.save.load()) this.save.apply(this.save.load());
      else { continueSave = false; this.campaign.begin(); }
    } finally { this.save.enabled = true; }
    document.getElementById('overlay-start').classList.add('hidden');
    this.input.requestLock();
    this.missions.updateTracker();
    if (!continueSave) {
      setTimeout(() => this._hint('move', 'Controles básicos', '[Shift] correr · [E] interactuar · [Tab] alforjas. Silas te espera junto a la fogata.'), 9000);
      setTimeout(() => this._hint('horse', 'Tu caballo, Ceniza', '[F] montar o desmontar · [H] silbar para llamarlo · [Shift] galopar.'), 16000);
      setTimeout(() => this._hint('instinct', 'Instinto de cazador', 'Pulsa [V] para ver rastros y animales cercanos.'), 24000);
    }
    setTimeout(() => this._hint('deadeye', 'Dead Eye', 'Apunta con clic derecho y pulsa [Q]: el tiempo se ralentiza para marcar blancos. Se recarga cazando y con tónicos.'), 40000);
    this.save.save();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'explore') { this.ui.hidePrompt(); this.ui.closeInventory(); }
    if (mode === 'dialogue' || mode === 'shop' || mode === 'board' || mode === 'dead') this.instinct.deactivate();
  }

  /* ---------------- Interacciones ---------------- */
  startSkinning(animal) {
    this.setMode('skinning');
    this.skinning = { animal, t: 0, dur: animal.species === 'deer' ? 2.4 : animal.species === 'wolf' ? 2.8 : 3.4 };
    this.player.faceTarget = animal.getCenter(new THREE.Vector3());
    this.audio.playSkin(this.skinning.dur);
  }
  _updateSkinning(dt) {
    const s = this.skinning;
    s.t += dt;
    this.ui.setProgress(s.t / s.dur);
    if (Math.random() < dt * 6) this.fx.dust.burst(s.animal.getCenter(this._v), 1, { color: 0x7a1a12, size: 0.06, life: 0.5, speed: 0.6, up: 1, gravity: 6 });
    if (s.t >= s.dur) {
      const a = s.animal;
      a.setSkinned();
      // Cada especie tiene sus piezas (alce, oso, puma…); ciervo y lobo conservan las suyas de la Fase 2.
      const yields = a.skinYields || (a.species === 'wolf' ? ['wolf_pelt'] : ['deer_pelt', 'venison', ...(a.isBuck ? ['buck_antlers'] : [])]);
      yields.forEach((id) => this.inventory.add(id, 1));
      this.ui.setProgress(null);
      this.player.faceTarget = null;
      this.skinning = null;
      this.setMode('explore');
      this.save.save();
    }
  }
  // Acción con barra de progreso (atar un prisionero, forzar un cofre). Se cancela si te hieren.
  startAction({ dur, face, onDone }) {
    this.setMode('action');
    this.action = { t: 0, dur, onDone };
    this.player.faceTarget = face;
  }
  _updateAction(dt) {
    const a = this.action;
    a.t += dt;
    this.ui.setProgress(a.t / a.dur);
    if (this.player.lastHurt < 0.15) { this._endAction(false); return; }
    if (a.t >= a.dur) this._endAction(true);
  }
  _endAction(done) {
    const a = this.action;
    this.ui.setProgress(null); this.player.faceTarget = null; this.action = null;
    this.setMode('explore');
    if (done && a.onDone) a.onDone();
  }
  _callHorse() {
    if (this.player.riding) return;
    this.audio.playWhistle();
    const d = distXZ(this.horse.position, this.player.position);
    if (this.horse.call(this.player.position)) {
      setTimeout(() => this.audio.playNeigh(distXZ(this.horse.position, this.player.position)), 650);
      if (d > 4) this.ui.notify('Silbas a Ceniza', d > CONFIG.HORSE.CALL_TELEPORT_DIST ? 'Viene desde lejos…' : `A ${Math.round(d)} m`);
    }
  }
  openShopById(id) { const npc = this.npcs.find((n) => n.id === id); if (npc) this.shop.open(npc); }
  openBoard() { this.bounties.open(); }

  /* Tónicos y objetos consumibles (Alforjas con [Tab], teclas 1-9; o [Q] para el mejor tónico) */
  useItem(id) {
    const def = this.story.items[id], p = this.player;
    if (!def || !def.use || this.inventory.count(id) < 1) return false;
    if (def.use.heal) {
      if (p.health + p.healPool >= CONFIG.PLAYER_MAX_HEALTH - 0.5) { this.ui.notify('Ya estás sano', 'Guarda el tónico para cuando lo necesites.'); return false; }
      this.inventory.remove(id, 1, true);
      p.heal(def.use.heal); this.audio.playDrink(); this.deadEye.addTonic();
      this.ui.notify(def.name, `+${def.use.heal} de salud`);
    }
    return true;
  }
  useTonic() {
    const inv = this.inventory, low = this.player.health < 45;
    const id = low && inv.count('tonic_strong') ? 'tonic_strong' : inv.count('tonic') ? 'tonic' : inv.count('tonic_strong') ? 'tonic_strong' : null;
    if (!id) { this.ui.notify('Sin tónicos', 'Cómpralos en la tienda de Hattie o saquea a los bandidos.'); return; }
    this.useItem(id);
  }

  _updateInteractions() {
    const p = this.player, pos = p.position, input = this.input, H = CONFIG.HORSE, town = this.world.town;
    if (p.riding) {
      if (this.horse.speed < 4) this.ui.showPrompt('F', 'Desmontar'); else this.ui.hidePrompt();
      if (input.wasPressed('KeyF')) {
        if (this.horse.speed < 4) p.dismountHorse(); else this.ui.notify('Frena primero', 'Suelta [W] para que Ceniza aminore.');
      }
      return;
    }
    let key = null, prompt = null, action = null;
    const sheriff = this.law.sheriff;
    let npc = null, nd = 3.0;   // el PNJ más cercano (en el campamento hay varios a pocos metros)
    for (const n of this.npcs) { if (!n.active || !n.root.visible) continue; const d = distXZ(pos, n.position); if (d < nd) { nd = d; npc = n; } }
    const captive = this.bandits.getNearestSurrendered(pos, 2.8);
    const citizen = this.townLife.nearestCitizen(pos, 2.6);
    const corpse = this.townLife.nearestCorpse(pos, 2.2);
    const ci = this.campaign.getInteraction();
    if (npc) {
      key = 'E';
      if (npc.interaction === 'shop') { prompt = `Comerciar con ${npc.name}`; action = () => this.shop.open(npc); }
      else { prompt = `Hablar con ${npc.name}`; action = () => { this.ui.hidePrompt(); this.dialogue.start(npc); }; }
    } else if (sheriff.alive && !sheriff.retired && sheriff.active !== false && sheriff.state === 'idle' && sheriff.mode === 'peace' && distXZ(pos, sheriff.position) < 3.0) {
      key = 'E'; prompt = `Hablar con ${sheriff.name}`; action = () => { this.ui.hidePrompt(); this.dialogue.start(sheriff); };
    } else if (captive) {
      key = 'E'; prompt = `Atar a ${captive.name}`;
      action = () => this.startAction({ dur: 2.2, face: captive.position, onDone: () => { if (captive.alive && captive.state === 'surrender') this.bounties.tieCaptive(captive); } });
    } else if (citizen && !this.townLife.weaponDrawn() && citizen.state !== 'flee' && citizen.state !== 'cower') {
      key = 'E'; prompt = `Saludar a ${citizen.name}`; action = () => this.townLife.greetCitizen(citizen);
    } else if (ci) {
      key = 'E'; prompt = ci.prompt; action = ci.action;
    } else if (distXZ(pos, town.board.pos) < 3.4) {
      key = 'E'; prompt = 'Tablón de recompensas'; action = () => this.openBoard();
    } else if (this.townLife.strongboxReady && distXZ(pos, town.strongbox.pos) < 2.2) {
      key = 'E'; prompt = 'Forzar el cofre de la tienda (robo)';
      action = () => this.startAction({ dur: 2.6, face: town.strongbox.pos, onDone: () => this.townLife.robStrongbox() });
    } else if (corpse) {
      key = 'E'; prompt = 'Saquear el cadáver (robo)'; action = () => this.townLife.lootCorpse(corpse);
    } else {
      const carcass = this.wildlife.getNearestCarcass(pos, 2.8);
      if (carcass) {
        key = 'E';
        prompt = carcass.species === 'wolf' ? 'Despellejar lobo' : carcass.isBuck ? 'Despellejar ciervo macho' : 'Despellejar ciervo';
        action = () => this.startSkinning(carcass);
      }
    }
    const horseNear = distXZ(pos, this.horse.position) < H.MOUNT_DIST && this.horse.speed < 3;
    if (!prompt && horseNear) { key = 'F'; prompt = `Montar a ${this.horse.name}`; }
    if (prompt) this.ui.showPrompt(key, prompt); else this.ui.hidePrompt();
    if (action && input.wasPressed('KeyE')) action();
    if (horseNear && input.wasPressed('KeyF')) { p.mountHorse(); this.ui.hidePrompt(); }
  }

  /* ---------------- Muerte y reaparición ---------------- */
  onPlayerDeath() {
    if (this.mode === 'dead') return;
    if (this.skinning) { this.ui.setProgress(null); this.skinning = null; this.player.faceTarget = null; }
    if (this.action) { this.ui.setProgress(null); this.action = null; this.player.faceTarget = null; }
    this.deadEye.deactivate(); this.duel.abort();
    this.setMode('dead');
    this.bandits.releaseAllTokens(); this.bandits.projectiles.clear();
    const loss = Math.min(this.inventory.money, Math.max(1, Math.round(this.inventory.money * 10) / 100));
    this.death = { t: 0, loss, done: false };
    this.ui.setFade(true, 'HAS MUERTO');
  }
  _updateDeath(dt) {
    const d = this.death;
    d.t += dt;
    if (d.t > 3.2 && !d.done) {
      d.done = true;
      const fp = this.world.firePos;
      this.player.respawnAt(fp.x + (CONFIG.PLAYER_SPAWN.x - CONFIG.CAMP.x), fp.z + (CONFIG.PLAYER_SPAWN.z - CONFIG.CAMP.z));
      if (d.loss > 0) this.inventory.addMoney(-d.loss);
      if (distXZ(this.horse.position, this.player.position) > 60) {
        const hx = fp.x + (CONFIG.HORSE_SPAWN.x - CONFIG.CAMP.x), hz = fp.z + (CONFIG.HORSE_SPAWN.z - CONFIG.CAMP.z);
        this.horse.position.set(hx, this.world.getHeightAt(hx, hz), hz);
        this.horse.state = 'idle'; this.horse.speed = 0; this.horse.tracks.reset();
      }
      this.world.chunks.update(this.player.position, true);
      this.ui.setFade(false);
      this.setMode('explore');
      this.ui.notify('Despiertas en el campamento', d.loss > 0 ? `Perdiste $${d.loss.toFixed(2)}` : 'Te curaron las heridas.');
      this.campaign.onPlayerRespawn();
      this.save.save();
    }
  }

  /* ---------------- Cámara ---------------- */
  _computeCinematic() {
    if (this.mode === 'duel') { const c = this.duel.cam; this.cine.pos.copy(c.pos); this.cine.look.copy(c.look); return; }
    const a = this.player.position, b = this.dialogue.npc.position;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const px = dz / len * this.cine.side, pz = -dx / len * this.cine.side;
    const gy = this.world.getHeightAt(mx, mz);
    this.cine.pos.set(mx + px * 3.3 - dx / len * 0.8, gy + 1.55, mz + pz * 3.3 - dz / len * 0.8);
    this.cine.pos.y = Math.max(this.cine.pos.y, this.world.getHeightAt(this.cine.pos.x, this.cine.pos.z) + 0.6);
    const sp = this.dialogue.speakerPos();
    this.cine.look.set(lerp(mx, sp.x, 0.3), gy + 1.45, lerp(mz, sp.z, 0.3));
  }
  _updateCamera(dt, instant = false) {
    const fov = this.player.computeCamera(instant ? 1 : dt, this._camPos, this._camLook);
    const cinema = this.mode === 'dialogue' || this.mode === 'duel';
    this.cine.blend = damp(this.cine.blend, cinema ? 1 : 0, this.mode === 'duel' ? 4.5 : 3.2, dt);
    let finalFov = fov;
    if (this.cine.blend > 0.001 && (this.dialogue.npc || this.mode === 'duel')) {
      this._computeCinematic();
      const k = easeInOut(clamp(this.cine.blend, 0, 1));
      this._camPos.lerp(this.cine.pos, k); this._camLook.lerp(this.cine.look, k);
      finalFov = lerp(fov, this.mode === 'duel' ? this.duel.cam.fov : 44, k);
    }
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camLook);
    if (Math.abs(this.camera.fov - finalFov) > 0.01) { this.camera.fov = finalFov; this.camera.updateProjectionMatrix(); }
  }

  /* ---------------- Rendimiento ---------------- */
  _updatePerformance(dt) {
    const pf = this.perf;
    pf.frames++; pf.time += dt;
    if (pf.time < 1.0) return;
    const fps = pf.frames / pf.time; pf.frames = 0; pf.time = 0;
    if (fps < 50) { pf.lowStreak++; pf.highStreak = 0; } else if (fps > 58.5) { pf.highStreak++; pf.lowStreak = 0; } else { pf.lowStreak = 0; pf.highStreak = 0; }
    const q = this.settings.quality, maxPR = Math.min(window.devicePixelRatio || 1, q.pixelMax);
    if (pf.lowStreak >= 2 && this.pixelRatio > q.pixelMin) {
      this.pixelRatio = Math.max(q.pixelMin, this.pixelRatio - 0.1); this.renderer.setPixelRatio(this.pixelRatio); pf.lowStreak = 0;
    } else if (pf.highStreak >= 4 && this.pixelRatio < maxPR) {
      this.pixelRatio = Math.min(maxPR, this.pixelRatio + 0.05); this.renderer.setPixelRatio(this.pixelRatio); pf.highStreak = 0;
    }
    // Aviso (una sola vez) si la calidad elegida no llega a 40 FPS sostenidos.
    if (fps < 40) { pf.slow = (pf.slow || 0) + 1; if (pf.slow === 8 && this.settings.get('quality') !== 'low') this.ui.notify('Rendimiento bajo', 'Prueba una calidad gráfica menor en el menú de pausa [Esc].'); } else pf.slow = Math.max(0, (pf.slow || 0) - 1);
    const info = this.renderer.info.render, ch = this.world.chunks, st = this.fx.impact.stats, bp = this.bandits.projectiles.pool;
    this.ui.setFps(`${Math.round(fps)} FPS · ${q.label} · ${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k tris · res ${this.pixelRatio.toFixed(2)}x · chunks ${ch.active.size}/9 (cola ${ch.pendingBuilds}) · IA fauna ${this.wildlife.activeCount} · IA pistoleros ${this.bandits.activeCount || 0} · pools: balas ${bp.activeCount}/${bp.total}, estelas ${st.tracers.active}/${st.tracers.total}, agujeros ${st.holes.active}/${st.holes.total}, huellas ${st.prints.active}/${st.prints.total}`);
  }

  /* ---------------- Bucle ---------------- */
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._updatePerformance(dt);
    if (!this.paused || !this.started) this.update(dt);
    this.audio.updateMusic(this._musicState(dt));   // también en pausa: la música no se corta al abrir el menú
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  // Estado musical según lo que ocurre: duelo > escena emotiva > tiroteo (con 6 s de cola) > sigilo > exploración tranquila.
  _musicState(dt) {
    if (!this.started) return 'calm';
    if (this.paused) return this.musicState;
    const p = this.player.position;
    let st = 'calm';
    if (this.duel.active) st = 'duel';
    else if ((this.dialogue.active && this.dialogue.emotional) || this.campaign.busy) st = 'emotional';
    else {
      if (this.bandits.hostileNear(p, 85) || this.wildlife.nearbyThreat(p, 45) || this.deadEye.active) this._combatT = 6; else this._combatT = Math.max(0, this._combatT - dt);
      if (this._combatT > 0 && this.mode !== 'dialogue') st = 'combat';
      else if (this.campaign.stealthActive()) st = 'stealth';
    }
    this.musicState = st;
    return st;
  }

  _simulate(dt) {
    this.player.update(dt);
    this.horse.update(dt);
    this.player.lateUpdate(dt);
    for (const n of this.npcs) n.update(dt);
    this.wildlife.update(dt);
    this.bandits.update(dt);
    this.townLife.update(dt);
    this.law.update(dt);
    this.loot.update(dt);
  }

  // rdt = tiempo real; dt = tiempo de juego (Dead Eye lo ralentiza a 0.25x y el final de un duelo a 0.3x). La cámara, la interfaz,
  // el audio y las entradas usan rdt para seguir siendo ágiles en cámara lenta.
  update(rdt) {
    if (this.started) this.deadEye.update(rdt, this.input);
    const dt = rdt * (this.duel.active ? this.duel.slow : this.deadEye.timeScale);
    this.elapsed += dt;
    const sky = this.world.update(dt, this.player.position, this.camera);
    if (!this.started) {
      this.player.yaw += dt * 0.05;
      this._simulate(dt);
      this._updateCamera(dt);
      this.fx.dust.update(dt, this.camera, this.renderer); this.fx.glow.update(dt, this.camera, this.renderer); this.fx.impact.update(dt);
      return;
    }
    const input = this.input;
    if (this.mode === 'dialogue') this.dialogue.update(rdt, input);
    else if (this.mode === 'duel') this.duel.update(rdt, input);
    else if (this.mode === 'skinning') this._updateSkinning(dt);
    else if (this.mode === 'action') this._updateAction(dt);
    else if (this.mode === 'shop') { if (input.wasPressed('Escape') || input.wasPressed('KeyE')) this.shop.close(); }
    else if (this.mode === 'board') { if (input.wasPressed('Escape') || input.wasPressed('KeyE')) this.bounties.close(); }
    else if (this.mode === 'dead') this._updateDeath(dt);
    this._simulate(dt);
    this.instinct.update(dt);
    if (this.mode === 'explore') {
      this._updateInteractions();
      if (input.wasPressed('Tab') || input.wasPressed('KeyI')) this.ui.toggleInventory(this.inventory, this.upgrades);
      if (this.ui.inventoryOpen) {   // [1-9] usa el objeto consumible de esa posición en las alforjas
        for (let i = 1; i <= 9; i++) if (input.wasPressed(`Digit${i}`) && this.ui.inventoryUsable[i - 1]) this.useItem(this.ui.inventoryUsable[i - 1]);
      }
      if (input.wasPressed('KeyQ')) { if (this.player.isAiming || this.deadEye.active) this.deadEye.toggle(); else this.useTonic(); }   // Q apuntando = Dead Eye
      if (input.wasPressed('KeyB')) this.campaign.fastTravelCamp();
      if (input.wasPressed('KeyT')) {
        this.world.time.timeScale = this.world.time.timeScale > 1 ? 1 : 40;
        this.ui.notify(this.world.time.timeScale > 1 ? 'Tiempo acelerado ×40' : 'Tiempo normal');
      }
      if (input.wasPressed('KeyH')) this._callHorse();
      if (input.wasPressed('KeyV')) this.instinct.toggle();
      if (this.player.isAiming) this._hint('aim', 'Apuntando', 'Clic izquierdo para disparar. Quieto, los ciervos apenas te oyen.');
      if (this.wildlife.nearbyThreat(this.player.position, 40)) this._hint('wolves', '¡Lobos!', 'Dispara para ahuyentarlos o huye a caballo.');
      if (this.bandits.hostileNear(this.player.position, 75)) this._hint('bandits', '¡Bandidos!', 'Busca cobertura: se esconden y se asoman para disparar. Aguanta y responde cuando se asomen. Tónicos con [Q].');
      this._townWatch();
    }
    this.campaign.update(dt);
    this.fx.dust.update(dt, this.camera, this.renderer);
    this.fx.glow.update(dt, this.camera, this.renderer);
    this.fx.impact.update(dt);
    this._updateCamera(rdt);
    this.save.update(rdt);

    this.audio.update(rdt, { fireDistance: distXZ(this.player.position, this.world.firePos), night: sky.night, saloonDistance: distXZ(this.player.position, this._saloonPos) });
    const pl = this.player, ui = this.ui, inv = this.inventory;
    ui.update(rdt);
    ui.setAmmo(pl.mag, inv.count('ammo'), pl.reloadTimer > 0, this.upgrades.size ? 'RIFLE DE PALANCA +' : 'RIFLE DE PALANCA');
    ui.setStamina(pl.stamina, pl.exhausted);
    ui.setHealth(pl.health);
    ui.setLowHealth(pl.health < 30 && this.mode !== 'dead');
    ui.setHorseStamina(this.horse.stamina, this.horse.exhausted, pl.riding);
    ui.setClock(this.world.time.formatClock(), sky.night);
    ui.setHonor(this.honor.ratio, this.honor.tier.name);
    const tonics = inv.count('tonic') + inv.count('tonic_strong');
    ui.setQuick(tonics > 0 ? `[Q] Tónico ×${tonics}` : '');
    const spread = lerp(1.0, 0.2, pl.aimBlend) + pl.speedNorm * 0.4 + pl.recoil * 6;
    ui.setCrosshair(this.mode === 'explore', pl.aimBlend, spread);
    if (++this._radarTick % 3 === 0) this._drawRadar();
  }

  // Cartel de bienvenida al entrar/salir del pueblo
  _townWatch() {
    const t = this.world.town, inside = distXZ(this.player.position, t.center) < t.radius;
    if (inside && !this._inTown) { this._inTown = true; this.ui.banner(t.name, 'Pueblo fronterizo · la ley es el sheriff Reed', 3.2); this._hint('townrules', 'Las reglas del pueblo', 'No desenfundes entre civiles. Los ciudadanos reaccionan a tu honor. El tablón de recompensas está junto a la oficina del sheriff.'); }
    else if (!inside && this._inTown && distXZ(this.player.position, t.center) > t.radius + 12) this._inTown = false;
  }

  _drawRadar() {
    const pl = this.player, ms = this.missions, pos = pl.position, town = this.world.town;
    const icons = [
      { type: 'camp', x: this.world.firePos.x, z: this.world.firePos.z, clamp: true },
      { type: 'shop', x: CONFIG.TRADING_POST.x, z: CONFIG.TRADING_POST.z, clamp: true },
      { type: 'town', x: town.center.x, z: town.center.z, clamp: true },
    ];
    for (const bc of this.world.banditCamps) if (distXZ(bc.center, pos) < 300) icons.push({ type: 'banditCamp', x: bc.center.x, z: bc.center.z, clamp: false });
    if (!pl.riding) icons.push({ type: 'horse', x: this.horse.position.x, z: this.horse.position.z, clamp: true });
    const marker = this.campaign.getMarkerFor('silas') || ms.getMarkerFor('silas');
    if (marker && this.npcs[0].active) icons.push({ type: marker === 'ready' ? 'npcReady' : 'npc', x: this.npcs[0].position.x, z: this.npcs[0].position.z, clamp: true });
    for (const w of this.director.waypoints) icons.push({ type: 'objective', x: w.x, z: w.z, clamp: true });   // objetivo de la campaña (rombo dorado)
    const rescue = this.bandits.ambush.radarPos;
    if (rescue) icons.push({ type: 'event', x: rescue.x, z: rescue.z, clamp: true });
    for (const a of this.wildlife.animals) {
      const d = distXZ(a.position, pos);
      if (!a.alive) { if (!a.skinned && d < 400) icons.push({ type: 'carcass', x: a.position.x, z: a.position.z, clamp: true }); continue; }
      const kind = a.radarKind || a.species;
      if (kind === 'deer' && d < 60) icons.push({ type: 'deer', x: a.position.x, z: a.position.z, clamp: false });
      if (kind === 'wolf' && d < 50) icons.push({ type: 'wolf', x: a.position.x, z: a.position.z, clamp: false });
    }
    for (const g of this.bandits.gunmen) {
      if (!g.active || !g.alive || g.state === 'jailed') continue;
      const d = distXZ(g.position, pos);
      if (g.faction === 'bandit' && d < 75 && (g.inCombat || d < 45)) icons.push({ type: 'bandit', x: g.position.x, z: g.position.z, clamp: false });
      else if (g.faction === 'law' && this.law.level > 0 && d < 120) icons.push({ type: 'law', x: g.position.x, z: g.position.z, clamp: false });
    }
    const zones = ms.getState('m01_hunt') === 'active' ? CONFIG.HERDS.map((h) => ({ x: h.x, z: h.z, r: 26 })) : [];
    const bz = this.bounties.radarZone(); if (bz) zones.push(bz);
    this.ui.drawRadar({
      yaw: pl.yaw, heading: pl.heading, px: pos.x, pz: pos.z, range: pl.riding ? 150 : 90,
      roads: [CONFIG.ROAD, CONFIG.ROAD_TOWN], icons, zones,
    });
  }
}

export { Game };
