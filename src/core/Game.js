// Orquestador: bucle principal, modos de juego, interacciones, cámara cinemática y rendimiento.
// Modos: explore | dialogue | skinning | action | shop | board | camp | map | travel | arrested | dead
import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { clamp, lerp, damp, easeInOut, distXZ } from './MathUtils.js';
import { EventBus } from './EventBus.js';
import { InputManager } from './InputManager.js';
import { createSharedMaterials } from '../render/GeometryKit.js';
import { ParticleSystem } from '../render/ParticleSystem.js';
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
import { CampSystem } from '../systems/CampSystem.js';
import { TreasureSystem } from '../systems/TreasureSystem.js';
import { MapSystem } from '../systems/MapSystem.js';
import { EncounterDirector } from '../ai/EncounterDirector.js';
import { UIManager } from '../ui/UIManager.js';

class Game {
  // data: { story, shops: { pike, hattie }, town, bounties, world }
  constructor(data) {
    const { story } = data;
    this.bus = new EventBus();
    this.story = story; this.townData = data.town; this.worldData = data.world;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game-root').appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1000);

    createSharedMaterials();
    this.ui = new UIManager(this.story);
    this.audio = new AudioSynthesizer();
    this.input = new InputManager(this.renderer.domElement, this.bus);
    this.world = new WorldManager(this);
    this.fx = { dust: new ParticleSystem(this.scene, 320, THREE.NormalBlending), glow: new ParticleSystem(this.scene, 240, THREE.AdditiveBlending) };
    this.inventory = new Inventory(this.bus, this.story.items);
    this.inventory.add('ammo', CONFIG.START_AMMO, true);
    this.upgrades = new Set();
    this.hints = new Set();
    this.honor = new HonorSystem(this, this.townData.honor);
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
    this.camp = new CampSystem(this, data.world.camp, this.world.campLife);
    this.npcs.push(...this.camp.companions);
    this.treasure = new TreasureSystem(this, data.world.treasures);
    this.encounters = new EncounterDirector(this, data.world.encounters);
    this.map = new MapSystem(this);
    this.travel = null; this._fullT = 0;

    this.mode = 'explore'; this.started = false; this.paused = true; this.elapsed = 0;
    this.skinning = null; this.death = null; this.action = null;
    this.cine = { blend: 0, side: 1, pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this._camPos = new THREE.Vector3(); this._camLook = new THREE.Vector3(); this._v = new THREE.Vector3();
    this.perf = { frames: 0, time: 0, lowStreak: 0, highStreak: 0 };
    this.clock = new THREE.Clock();
    this._radarTick = 0; this._inTown = false; this._saloonPos = this.world.town.local(-16, -12);

    this._bindEvents();
    this._setupMenu();
    this.missions.updateTracker();
    this._updateCamera(0.016, true);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  _setupMenu() {
    const has = this.save.hasSave();
    const btn = document.getElementById('btn-start'), btnNew = document.getElementById('btn-new');
    btn.textContent = has ? 'CONTINUAR' : 'CABALGAR';
    btnNew.classList.toggle('hidden', !has);
    document.getElementById('loading-note').textContent = has
      ? 'Partida guardada encontrada. «Nueva partida» borra el progreso guardado.'
      : 'Recomendado: Chrome o Edge. El juego ajusta la resolución automáticamente para mantener 60 FPS.';
  }

  get _menuMode() { return this.mode === 'shop' || this.mode === 'board' || this.mode === 'camp' || this.mode === 'map'; }

  _bindEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    document.getElementById('btn-start').addEventListener('click', () => this.start(this.save.hasSave()));
    document.getElementById('btn-new').addEventListener('click', () => { this.save.clear(); this.start(false); });
    document.getElementById('overlay-pause').addEventListener('click', () => this.input.requestLock());
    window.addEventListener('beforeunload', () => this.save.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save.save(); });
    this.bus.on('pointerlock', (locked) => {
      if (!this.started) return;
      if (locked) { this.paused = false; document.getElementById('overlay-pause').classList.add('hidden'); this.audio.init(); }
      else if (!this.input.fallback && !this._menuMode) {
        this.paused = true; document.getElementById('overlay-pause').classList.remove('hidden'); this.input.mouse.right = false;
        this.save.save();
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
    this.bus.on('flag:set', (f) => { this.world.applyFlag(f); this.townLife.applyFlag(f); this.camp.applyFlag(f); if (this.started) this.save.save(); });
    this.bus.on('inventory:full', (e) => {
      if (this.elapsed - this._fullT < 3) return;
      this._fullT = this.elapsed; this.ui.notify('Alforjas llenas', 'Vende o dona pieles, o mejora la Tienda del campamento (+16).');
    });
    this.bus.on('animal:killed', (a) => {
      if (a.species === 'deer') this._hint('skin', 'Ciervo abatido', 'Acércate al cuerpo y pulsa [E] para despellejarlo.');
      else this._hint('skinwolf', 'Lobo abatido', 'Su piel vale buen dinero en el puesto de Pike.');
    });
  }

  _hint(id, title, text) { if (this.hints.has(id)) return; this.hints.add(id); this.ui.notify(title, text); }

  start(continueSave) {
    if (this.started) return;
    this.audio.init();
    if (continueSave) this.save.apply(this.save.load());
    this.started = true; this.paused = false;
    this.input.enabled = true;
    document.getElementById('overlay-start').classList.add('hidden');
    this.input.requestLock();
    this.missions.updateTracker();
    this.ui.banner(this.story.chapterTitle, this.story.chapterSubtitle, 4.5);
    setTimeout(() => this._hint('move', 'El campamento te espera', 'Habla con Silas Crane junto a la fogata. [Shift] para correr.'), 4800);
    setTimeout(() => this._hint('horse', 'Tu caballo, Ceniza', '[F] montar o desmontar · [H] silbar para llamarlo · [Shift] galopar.'), 11000);
    setTimeout(() => this._hint('instinct', 'Instinto de cazador', 'Pulsa [V] para ver rastros y animales cercanos.'), 18000);
    setTimeout(() => this._hint('camp4', 'El campamento está vivo', 'Habla con tus compañeros. Dona en la Caja de Contribuciones y compra mejoras en el Libro de Contabilidad.'), 33000);
    setTimeout(() => this._hint('map', 'Mapa del valle', 'Pulsa [M] para ver lo explorado. Con la Tienda Mejorada podrás viajar rápido.'), 42000);
    setTimeout(() => this._hint('town', 'Redwood Gulch', 'Un pueblo fronterizo al sureste: sigue el camino de tierra desde el campamento.'), 26000);
    this.save.save();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'explore') { this.ui.hidePrompt(); this.ui.closeInventory(); }
    if (mode === 'dialogue' || mode === 'shop' || mode === 'board' || mode === 'camp' || mode === 'map' || mode === 'travel' || mode === 'dead') this.instinct.deactivate();
  }

  /* ---------------- Interacciones ---------------- */
  startSkinning(animal) {
    this.setMode('skinning');
    this.skinning = { animal, t: 0, dur: animal.species === 'wolf' ? 2.8 : 2.4 };
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
      if (a.species === 'wolf') this.inventory.add('wolf_pelt', 1);
      else {
        this.inventory.add('deer_pelt', 1);
        this.inventory.add('venison', 1);
        if (a.isBuck) this.inventory.add('buck_antlers', 1);
      }
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
  /* Viaje rápido: barras de cine + fundido a negro con el destino; se teletransporta en lo más oscuro y avanza la hora. */
  fastTravel(poi) {
    const dest = poi.travel, from = this.player.position, riding = this.player.riding;
    const hours = clamp(distXZ(from, dest) / (riding ? 10 : 5) * (24 / CONFIG.DAY_LENGTH_SECONDS), 0.2, 6);
    this.setMode('travel'); this.travel = { t: 0, poi, hours, moved: false };
    this.ui.setLetterbox(true); this.ui.setFade(true, `Camino a ${poi.name}…`); this.audio.playWhistle();
  }
  _updateTravel(dt) {
    const T = this.travel; T.t += dt;
    if (!T.moved && T.t > 1.5) {
      T.moved = true;
      const p = this.player, w = this.world, d = T.poi.travel, h = this.horse;
      p.position.set(d.x, w.getHeightAt(d.x, d.z), d.z); p.velocity.set(0, 0, 0);
      p.yaw = p.heading = Math.atan2(T.poi.x - d.x, T.poi.z - d.z);
      if (p.riding) { h.position.copy(p.position); h.heading = p.yaw; h.speed = 0; }
      else { h.position.set(d.x + Math.cos(p.yaw) * 2.6, 0, d.z - Math.sin(p.yaw) * 2.6); h.position.y = w.getHeightAt(h.position.x, h.position.z); h.state = 'idle'; h.speed = 0; }
      h.tracks.reset(); w.time.hour = (w.time.hour + T.hours) % 24;
      w.chunks.update(p.position, true); this._updateCamera(0.016, true);
      this.bandits.releaseAllTokens(); this.bandits.projectiles.clear();
    }
    if (T.t > 2.2) this.ui.setFade(false);
    if (T.t > 3.4) {
      this.ui.setLetterbox(false); this.setMode('explore'); this.travel = null;
      this.ui.banner(T.poi.name, `Han pasado ${Math.max(1, Math.round(T.hours))} h de camino`, 3.2); this.save.save();
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
      p.heal(def.use.heal); this.audio.playDrink();
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
    const campAct = this.camp.getInteraction(pos) || this.treasure.getInteraction(pos) || this.encounters.getInteraction(pos);
    const npc = this.npcs.find((n) => n.active && distXZ(pos, n.position) < 3.0);
    const captive = this.bandits.getNearestSurrendered(pos, 2.8);
    const citizen = this.townLife.nearestCitizen(pos, 2.6);
    const corpse = this.townLife.nearestCorpse(pos, 2.2);
    if (campAct) { key = 'E'; prompt = campAct.prompt; action = campAct.action; }
    else if (npc) {
      key = 'E';
      if (npc.interaction === 'shop') { prompt = `Comerciar con ${npc.name}`; action = () => this.shop.open(npc); }
      else { prompt = `Hablar con ${npc.name}`; action = () => { this.ui.hidePrompt(); this.dialogue.start(npc); }; }
    } else if (sheriff.alive && sheriff.state === 'idle' && sheriff.mode === 'peace' && distXZ(pos, sheriff.position) < 3.0) {
      key = 'E'; prompt = `Hablar con ${sheriff.name}`; action = () => { this.ui.hidePrompt(); this.dialogue.start(sheriff); };
    } else if (captive) {
      key = 'E'; prompt = `Atar a ${captive.name}`;
      action = () => this.startAction({ dur: 2.2, face: captive.position, onDone: () => { if (captive.alive && captive.state === 'surrender') this.bounties.tieCaptive(captive); } });
    } else if (citizen && !this.townLife.weaponDrawn() && citizen.state !== 'flee' && citizen.state !== 'cower') {
      key = 'E'; prompt = `Saludar a ${citizen.name}`; action = () => this.townLife.greetCitizen(citizen);
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
      const sp = CONFIG.PLAYER_SPAWN;
      this.player.respawnAt(sp.x, sp.z);
      if (d.loss > 0) this.inventory.addMoney(-d.loss);
      if (distXZ(this.horse.position, this.player.position) > 60) {
        this.horse.position.set(CONFIG.HORSE_SPAWN.x, this.world.getHeightAt(CONFIG.HORSE_SPAWN.x, CONFIG.HORSE_SPAWN.z), CONFIG.HORSE_SPAWN.z);
        this.horse.state = 'idle'; this.horse.speed = 0; this.horse.tracks.reset();
      }
      this.world.chunks.update(this.player.position, true);
      this.ui.setFade(false);
      this.setMode('explore');
      this.ui.notify('Despiertas en el campamento', d.loss > 0 ? `Perdiste $${d.loss.toFixed(2)}` : 'Silas te curó las heridas.');
      this.save.save();
    }
  }

  /* ---------------- Cámara ---------------- */
  _computeCinematic() {
    const a = this.player.position, b = this.dialogue.npc.position;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const px = dz / len * this.cine.side, pz = -dx / len * this.cine.side;
    const gy = this.world.getHeightAt(mx, mz);
    this.cine.pos.set(mx + px * 3.3 - dx / len * 0.8, gy + 1.55, mz + pz * 3.3 - dz / len * 0.8);
    this.cine.pos.y = Math.max(this.cine.pos.y, this.world.getHeightAt(this.cine.pos.x, this.cine.pos.z) + 0.6);
    const sp = this.dialogue.currentSpeaker === 'player' ? a : b;
    this.cine.look.set(lerp(mx, sp.x, 0.3), gy + 1.45, lerp(mz, sp.z, 0.3));
  }
  _updateCamera(dt, instant = false) {
    const fov = this.player.computeCamera(instant ? 1 : dt, this._camPos, this._camLook);
    this.cine.blend = damp(this.cine.blend, this.mode === 'dialogue' ? 1 : 0, 3.2, dt);
    let finalFov = fov;
    if (this.cine.blend > 0.001 && this.dialogue.npc) {
      this._computeCinematic();
      const k = easeInOut(clamp(this.cine.blend, 0, 1));
      this._camPos.lerp(this.cine.pos, k); this._camLook.lerp(this.cine.look, k);
      finalFov = lerp(fov, 44, k);
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
    const maxPR = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_PIXEL_RATIO);
    if (pf.lowStreak >= 2 && this.pixelRatio > CONFIG.MIN_PIXEL_RATIO) {
      this.pixelRatio = Math.max(CONFIG.MIN_PIXEL_RATIO, this.pixelRatio - 0.1); this.renderer.setPixelRatio(this.pixelRatio); pf.lowStreak = 0;
    } else if (pf.highStreak >= 4 && this.pixelRatio < maxPR) {
      this.pixelRatio = Math.min(maxPR, this.pixelRatio + 0.05); this.renderer.setPixelRatio(this.pixelRatio); pf.highStreak = 0;
    }
    const info = this.renderer.info.render, ch = this.world.chunks;
    this.ui.setFps(`${Math.round(fps)} FPS · ${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k tris · res ${this.pixelRatio.toFixed(2)}x · chunks ${ch.active.size}/9 (cola ${ch.pendingBuilds}) · IA fauna ${this.wildlife.activeCount} · IA pistoleros ${this.bandits.activeCount || 0} · ${this.world.weather.state.name}`);
  }

  /* ---------------- Bucle ---------------- */
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._updatePerformance(dt);
    if (!this.paused || !this.started) this.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
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
    this.camp.update(dt);
    this.treasure.update(dt);
    this.encounters.update(dt);
    this.map.update(dt);
  }

  update(dt) {
    this.elapsed += dt;
    const sky = this.world.update(dt, this.player.position, this.camera);
    if (!this.started) {
      this.player.yaw += dt * 0.05;
      this._simulate(dt);
      this._updateCamera(dt);
      this.fx.dust.update(dt, this.camera, this.renderer); this.fx.glow.update(dt, this.camera, this.renderer);
      return;
    }
    const input = this.input;
    if (this.mode === 'dialogue') this.dialogue.update(dt, input);
    else if (this.mode === 'skinning') this._updateSkinning(dt);
    else if (this.mode === 'action') this._updateAction(dt);
    else if (this.mode === 'shop') { if (input.wasPressed('Escape') || input.wasPressed('KeyE')) { this.shop.close(); input.consume(); } }
    else if (this.mode === 'board') { if (input.wasPressed('Escape') || input.wasPressed('KeyE')) { this.bounties.close(); input.consume(); } }
    else if (this.mode === 'camp') { if (input.wasPressed('Escape') || input.wasPressed('KeyE')) { this.camp.close(); input.consume(); } }
    else if (this.mode === 'map') { if (input.wasPressed('Escape') || input.wasPressed('KeyM')) { this.map.close(); input.consume(); } else this.map.frame(); }
    else if (this.mode === 'travel') this._updateTravel(dt);
    else if (this.mode === 'dead') this._updateDeath(dt);
    this._simulate(dt);
    this.instinct.update(dt);
    if (this.mode === 'explore') {
      this._updateInteractions();
      if (input.wasPressed('Tab') || input.wasPressed('KeyI')) this.ui.toggleInventory(this.inventory, this.upgrades);
      if (this.ui.inventoryOpen) {   // [1-9] usa el objeto consumible de esa posición en las alforjas
        for (let i = 1; i <= 9; i++) if (input.wasPressed(`Digit${i}`) && this.ui.inventoryUsable[i - 1]) this.useItem(this.ui.inventoryUsable[i - 1]);
      }
      if (input.wasPressed('KeyQ')) this.useTonic();
      if (input.wasPressed('KeyM')) this.map.open();
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
    this.fx.dust.update(dt, this.camera, this.renderer);
    this.fx.glow.update(dt, this.camera, this.renderer);
    this._updateCamera(dt);
    this.save.update(dt);

    const wx = this.world.weather;
    this.audio.update(dt, { fireDistance: distXZ(this.player.position, this.world.firePos), night: sky.night, saloonDistance: distXZ(this.player.position, this._saloonPos), rain: wx.v.rain, wind: wx.v.wind });
    const pl = this.player, ui = this.ui, inv = this.inventory;
    ui.update(dt);
    ui.setAmmo(pl.mag, inv.count('ammo'), pl.reloadTimer > 0, this.upgrades.size ? 'RIFLE DE PALANCA +' : 'RIFLE DE PALANCA');
    ui.setStamina(pl.stamina, pl.exhausted);
    ui.setHealth(pl.health);
    ui.setLowHealth(pl.health < 30 && this.mode !== 'dead');
    ui.setHorseStamina(this.horse.stamina, this.horse.exhausted, pl.riding);
    ui.setClock(this.world.time.formatClock(), sky.night, wx.state.icon);
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
      { type: 'camp', x: CONFIG.CAMP.x, z: CONFIG.CAMP.z, clamp: true },
      { type: 'shop', x: CONFIG.TRADING_POST.x, z: CONFIG.TRADING_POST.z, clamp: true },
      { type: 'town', x: town.center.x, z: town.center.z, clamp: true },
    ];
    for (const bc of this.world.banditCamps) if (distXZ(bc.center, pos) < 300) icons.push({ type: 'banditCamp', x: bc.center.x, z: bc.center.z, clamp: false });
    if (!pl.riding) icons.push({ type: 'horse', x: this.horse.position.x, z: this.horse.position.z, clamp: true });
    const marker = ms.getMarkerFor('silas');
    if (marker) icons.push({ type: marker === 'ready' ? 'npcReady' : 'npc', x: this.npcs[0].position.x, z: this.npcs[0].position.z, clamp: true });
    const rescue = this.bandits.ambush.radarPos || this.encounters.radarPos;
    if (rescue) icons.push({ type: 'event', x: rescue.x, z: rescue.z, clamp: true });
    for (const t of this.treasure.items) if (t.revealed && !t.collected && distXZ(t, pos) < 250) icons.push({ type: 'treasure', x: t.x, z: t.z, clamp: true });
    for (const a of this.wildlife.animals) {
      const d = distXZ(a.position, pos);
      if (!a.alive) { if (!a.skinned && d < 400) icons.push({ type: 'carcass', x: a.position.x, z: a.position.z, clamp: true }); continue; }
      if (a.species === 'deer' && d < 60) icons.push({ type: 'deer', x: a.position.x, z: a.position.z, clamp: false });
      if (a.species === 'wolf' && d < 50) icons.push({ type: 'wolf', x: a.position.x, z: a.position.z, clamp: false });
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
