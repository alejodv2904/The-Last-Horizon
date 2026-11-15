// Orquestador: bucle principal, modos de juego, interacciones, cámara cinemática y rendimiento.
// Modos: explore | dialogue | skinning | shop | dead
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
import { Inventory } from '../systems/Inventory.js';
import { MissionSystem } from '../systems/MissionSystem.js';
import { DialogueSystem } from '../systems/DialogueSystem.js';
import { ShopSystem } from '../systems/ShopSystem.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { HunterInstinct } from '../systems/HunterInstinct.js';
import { UIManager } from '../ui/UIManager.js';

class Game {
  constructor(story, shopCatalog) {
    this.bus = new EventBus();
    this.story = story;
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
    this.player = new PlayerController(this);
    this.horse = new Horse(this, CONFIG.HORSE_SPAWN.x, CONFIG.HORSE_SPAWN.z);
    const post = this.world.post;
    this.npcs = [
      new NPC(this, { id: 'silas', palette: 'silas', interaction: 'dialogue', x: -2.3, z: -2.1, faceX: CONFIG.PLAYER_SPAWN.x, faceZ: CONFIG.PLAYER_SPAWN.z }),
      new NPC(this, { id: 'pike', palette: 'trader', interaction: 'shop', x: post.traderPos.x, z: post.traderPos.z, faceX: post.traderFace.x, faceZ: post.traderFace.z }),
    ];
    this.wildlife = new WildlifeAI(this);
    this.missions = new MissionSystem(this, this.story);
    this.dialogue = new DialogueSystem(this);
    this.shop = new ShopSystem(this, shopCatalog);
    this.instinct = new HunterInstinct(this);
    this.save = new SaveSystem(this);

    this.mode = 'explore'; this.started = false; this.paused = true; this.elapsed = 0;
    this.skinning = null; this.death = null;
    this.cine = { blend: 0, side: 1, pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this._camPos = new THREE.Vector3(); this._camLook = new THREE.Vector3(); this._v = new THREE.Vector3();
    this.perf = { frames: 0, time: 0, lowStreak: 0, highStreak: 0 };
    this.clock = new THREE.Clock();
    this._radarTick = 0;

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
      else if (!this.input.fallback && this.mode !== 'shop') {
        this.paused = true; document.getElementById('overlay-pause').classList.remove('hidden'); this.input.mouse.right = false;
        this.save.save();
      }
    });
    this.bus.on('pointerlock:error', (fallback) => {
      if (!this.started || this.mode === 'shop') return;
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
    this.bus.on('flag:set', (f) => { this.world.applyFlag(f); if (this.started) this.save.save(); });
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
    this.save.save();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'explore') { this.ui.hidePrompt(); this.ui.closeInventory(); }
    if (mode === 'dialogue' || mode === 'shop' || mode === 'dead') this.instinct.deactivate();
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
  _callHorse() {
    if (this.player.riding) return;
    this.audio.playWhistle();
    const d = distXZ(this.horse.position, this.player.position);
    if (this.horse.call(this.player.position)) {
      setTimeout(() => this.audio.playNeigh(distXZ(this.horse.position, this.player.position)), 650);
      if (d > 4) this.ui.notify('Silbas a Ceniza', d > CONFIG.HORSE.CALL_TELEPORT_DIST ? 'Viene desde lejos…' : `A ${Math.round(d)} m`);
    }
  }
  _updateInteractions() {
    const p = this.player, pos = p.position, input = this.input, H = CONFIG.HORSE;
    if (p.riding) {
      if (this.horse.speed < 4) this.ui.showPrompt('F', 'Desmontar'); else this.ui.hidePrompt();
      if (input.wasPressed('KeyF')) {
        if (this.horse.speed < 4) p.dismountHorse(); else this.ui.notify('Frena primero', 'Suelta [W] para que Ceniza aminore.');
      }
      return;
    }
    let key = null, prompt = null, action = null;
    const npc = this.npcs.find((n) => distXZ(pos, n.position) < 3.0);
    if (npc) {
      key = 'E';
      if (npc.interaction === 'shop') { prompt = `Comerciar con ${npc.name}`; action = () => this.shop.open(npc); }
      else { prompt = `Hablar con ${npc.name}`; action = () => { this.ui.hidePrompt(); this.dialogue.start(npc); }; }
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
    this.setMode('dead');
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
    this.ui.setFps(`${Math.round(fps)} FPS · ${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k tris · res ${this.pixelRatio.toFixed(2)}x · chunks ${ch.active.size}/9 (cola ${ch.pendingBuilds}) · IA activa ${this.wildlife.activeCount}`);
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
    else if (this.mode === 'shop') { if (input.wasPressed('Escape') || input.wasPressed('KeyE')) this.shop.close(); }
    else if (this.mode === 'dead') this._updateDeath(dt);
    this._simulate(dt);
    this.instinct.update(dt);
    if (this.mode === 'explore') {
      this._updateInteractions();
      if (input.wasPressed('Tab') || input.wasPressed('KeyI')) this.ui.toggleInventory(this.inventory, this.upgrades);
      if (input.wasPressed('KeyT')) {
        this.world.time.timeScale = this.world.time.timeScale > 1 ? 1 : 40;
        this.ui.notify(this.world.time.timeScale > 1 ? 'Tiempo acelerado ×40' : 'Tiempo normal');
      }
      if (input.wasPressed('KeyH')) this._callHorse();
      if (input.wasPressed('KeyV')) this.instinct.toggle();
      if (this.player.isAiming) this._hint('aim', 'Apuntando', 'Clic izquierdo para disparar. Quieto, los ciervos apenas te oyen.');
      if (this.wildlife.nearbyThreat(this.player.position, 40)) this._hint('wolves', '¡Lobos!', 'Dispara para ahuyentarlos o huye a caballo.');
    }
    this.fx.dust.update(dt, this.camera, this.renderer);
    this.fx.glow.update(dt, this.camera, this.renderer);
    this._updateCamera(dt);
    this.save.update(dt);

    this.audio.update(dt, { fireDistance: distXZ(this.player.position, this.world.firePos), night: sky.night });
    const pl = this.player, ui = this.ui;
    ui.update(dt);
    ui.setAmmo(pl.mag, this.inventory.count('ammo'), pl.reloadTimer > 0, this.upgrades.size ? 'RIFLE DE PALANCA +' : 'RIFLE DE PALANCA');
    ui.setStamina(pl.stamina, pl.exhausted);
    ui.setHealth(pl.health);
    ui.setHorseStamina(this.horse.stamina, this.horse.exhausted, pl.riding);
    ui.setClock(this.world.time.formatClock(), sky.night);
    const spread = lerp(1.0, 0.2, pl.aimBlend) + pl.speedNorm * 0.4 + pl.recoil * 6;
    ui.setCrosshair(this.mode === 'explore', pl.aimBlend, spread);
    if (++this._radarTick % 3 === 0) this._drawRadar();
  }

  _drawRadar() {
    const pl = this.player, ms = this.missions, pos = pl.position;
    const icons = [
      { type: 'camp', x: CONFIG.CAMP.x, z: CONFIG.CAMP.z, clamp: true },
      { type: 'shop', x: CONFIG.TRADING_POST.x, z: CONFIG.TRADING_POST.z, clamp: true },
    ];
    if (!pl.riding) icons.push({ type: 'horse', x: this.horse.position.x, z: this.horse.position.z, clamp: true });
    const marker = ms.getMarkerFor('silas');
    if (marker) icons.push({ type: marker === 'ready' ? 'npcReady' : 'npc', x: this.npcs[0].position.x, z: this.npcs[0].position.z, clamp: true });
    for (const a of this.wildlife.animals) {
      const d = distXZ(a.position, pos);
      if (!a.alive) { if (!a.skinned && d < 400) icons.push({ type: 'carcass', x: a.position.x, z: a.position.z, clamp: true }); continue; }
      if (a.species === 'deer' && d < 60) icons.push({ type: 'deer', x: a.position.x, z: a.position.z, clamp: false });
      if (a.species === 'wolf' && d < 50) icons.push({ type: 'wolf', x: a.position.x, z: a.position.z, clamp: false });
    }
    this.ui.drawRadar({
      yaw: pl.yaw, heading: pl.heading, px: pos.x, pz: pos.z, range: pl.riding ? 150 : 90,
      road: CONFIG.ROAD, icons,
      zones: ms.getState('m01_hunt') === 'active' ? CONFIG.HERDS.map((h) => ({ x: h.x, z: h.z, r: 26 })) : [],
    });
  }
}

export { Game };
