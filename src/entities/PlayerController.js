// Jugador: movimiento a pie o a caballo, cámara al hombro, rifle (con mejoras), salud.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { clamp, lerp, damp, dampAngle, smoothstep } from '../core/MathUtils.js';
import { makeGlowTexture } from '../render/GeometryKit.js';
import { PALETTES, buildHumanoid, poseHumanoid } from './CharacterFactory.js';

const _v = new THREE.Vector3(), _dir = new THREE.Vector3(), _org = new THREE.Vector3(), _nrm = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const DE_TINT = new THREE.Color(0xff5a30);
const UNMARKABLE = new Set(['surrender', 'captive', 'jailed', 'dead']);

class PlayerController {
  constructor(game) {
    this.game = game;
    this.model = buildHumanoid(PALETTES.player, true);
    this.root = this.model.root;
    this.root.rotation.order = 'YXZ';
    game.scene.add(this.root);
    const sp = CONFIG.PLAYER_SPAWN;
    this.position = new THREE.Vector3(sp.x, game.world.getHeightAt(sp.x, sp.z), sp.z);
    this.velocity = new THREE.Vector3();
    this.heading = 0; this.yaw = 0; this.pitch = -0.1; this.recoil = 0; this.shake = 0;
    this.phase = 0; this.speedNorm = 0; this.runBlend = 0; this.aimBlend = 0; this.crouchBlend = 0; this.rideBlend = 0;
    this.stamina = 100; this.exhausted = false; this.staminaDelay = 0;
    this.health = CONFIG.PLAYER_MAX_HEALTH; this.lastHurt = 99; this.healPool = 0;
    this.mag = CONFIG.RIFLE_MAG; this.cooldown = 0; this.reloadTimer = 0; this.readyTimer = 0;
    this.isAiming = false; this.isRunning = false; this.isMoving = false; this.isCrouching = false;
    this.riding = false; this.faceTarget = null; this.invulnerable = false; this.paletteKey = 'player';
    this._hit = { dist: 0, point: new THREE.Vector3(), type: 'none', animal: null, actor: null, object: null };
    this.cam = { dist: 4.3, side: 0.65, height: 1.62, fov: 62 };
    this.lastStepSign = 1;
    this.raycaster = new THREE.Raycaster();
    this._fwd = new THREE.Vector3(); this._right = new THREE.Vector3(); this._dir = new THREE.Vector3();
    this._pivot = new THREE.Vector3(); this._tmp = new THREE.Vector3(); this._muzzle = new THREE.Vector3();
    this._buildWeaponFX();
  }

  _buildWeaponFX() {
    const tex = makeGlowTexture('rgba(255,250,220,1)', 'rgba(255,170,60,0.9)');
    const flashMat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffd080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const p1 = new THREE.PlaneGeometry(0.3, 0.6); p1.rotateX(-Math.PI / 2); p1.translate(0, 0, 0.22);
    const p2 = p1.clone(); p2.rotateZ(Math.PI / 2);
    this.flash = new THREE.Group();
    this.flash.add(new THREE.Mesh(p1, flashMat), new THREE.Mesh(p2, flashMat));
    const fs = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    fs.scale.set(0.5, 0.5, 1); this.flash.add(fs);
    this.flash.visible = false; this.model.muzzle.add(this.flash);
    this.flashTimer = 0;
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 14, 2);
    this.game.scene.add(this.muzzleLight);
  }

  // Cambia el aspecto del protagonista (Epílogos: Wren). Reconstruye el modelo y recoloca el fogonazo en el nuevo cañón.
  setAppearance(key) {
    if (key === this.paletteKey || !PALETTES[key]) return;
    const g = this.game, old = this.model;
    old.meshes.forEach((m) => m.geometry.dispose());
    g.scene.remove(old.root); this.flash.parent && this.flash.parent.remove(this.flash);
    this.model = buildHumanoid(PALETTES[key], true); this.root = this.model.root; this.root.rotation.order = 'YXZ';
    g.scene.add(this.root); this.model.muzzle.add(this.flash); this.paletteKey = key;
  }

  get ammoReserve() { return this.game.inventory.count('ammo'); }
  get mounted() { return this.riding; }
  get damage() { return CONFIG.RIFLE_BASE_DAMAGE * (this.game.upgrades.has('rounds') ? 1.6 : 1); }
  get range() { return CONFIG.RIFLE_BASE_RANGE * (this.game.upgrades.has('barrel') ? 1.45 : 1); }
  get aimFov() { return this.game.upgrades.has('barrel') ? 30 : 38; }

  update(dt) {
    const g = this.game, input = g.input, canAct = g.mode === 'explore' && g.started;
    const sens = CONFIG.MOUSE_SENS * (this.isAiming ? 0.55 : 1);
    if (canAct && !g.deadEye.executing) {
      this.yaw -= input.mouse.dx * sens;
      this.pitch = clamp(this.pitch - input.mouse.dy * sens, -0.95, 0.65);
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.readyTimer = Math.max(0, this.readyTimer - dt);
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const take = Math.min(CONFIG.RIFLE_MAG - this.mag, this.ammoReserve);
        this.mag += take; g.inventory.remove('ammo', take, true);
      }
    }
    this.isAiming = canAct && (input.mouse.right || g.deadEye.active) && this.reloadTimer <= 0;
    this.isCrouching = canAct && !this.riding && !this.isAiming && (input.isDown('KeyC') || input.isDown('ControlLeft'));
    this.aimBlend = damp(this.aimBlend, (this.isAiming || this.readyTimer > 0) ? 1 : 0, 12, dt);
    this.crouchBlend = damp(this.crouchBlend, (g.mode === 'skinning' || g.mode === 'action') ? 1 : this.isCrouching ? 0.62 : 0, 8, dt);
    this.rideBlend = damp(this.rideBlend, this.riding ? 1 : 0, 10, dt);
    this.lastHurt += dt;
    // Regeneración lenta fuera de combate + curación de tónicos (se aplica en ~2 s, no de golpe).
    if (this.lastHurt > CONFIG.PLAYER_REGEN_DELAY && this.health < CONFIG.PLAYER_MAX_HEALTH && g.mode !== 'dead') this.health = Math.min(CONFIG.PLAYER_MAX_HEALTH, this.health + CONFIG.PLAYER_REGEN * dt);
    if (this.healPool > 0 && g.mode !== 'dead') { const h = Math.min(this.healPool, 45 * dt); this.healPool -= h; this.health = Math.min(CONFIG.PLAYER_MAX_HEALTH, this.health + h); }
    this.shake = damp(this.shake, 0, 6, dt);

    let ix = 0, iz = 0;
    if (canAct) {
      if (input.isDown('KeyW')) iz += 1; if (input.isDown('KeyS')) iz -= 1;
      if (input.isDown('KeyD')) ix += 1; if (input.isDown('KeyA')) ix -= 1;
      ix += input.axis.x; iz += input.axis.y;   // joystick táctil
    }
    this.isMoving = ix !== 0 || iz !== 0;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this._fwd.set(sy, 0, cy); this._right.set(-cy, 0, sy);
    this._dir.set(0, 0, 0).addScaledVector(this._fwd, iz).addScaledVector(this._right, ix);
    if (this._dir.lengthSq() > 0) this._dir.normalize();

    if (this.riding) {
      this.isRunning = false;
      g.horse.setDrive(this._dir, this.isMoving, canAct && input.isDown('ShiftLeft'), this.isAiming || input.isDown('ControlLeft'));
      this.speedNorm = clamp(g.horse.speed / CONFIG.HORSE.GALLOP, 0, 1);
    } else this._updateOnFoot(dt, canAct);

    if (canAct) {
      if (input.wasPressed('KeyR')) this.startReload();
      if (input.mouse.leftPressed && !g.deadEye.active) this.tryFire();
    }
    if (!this.riding && this.speedNorm > 0.35 && g.mode === 'explore') g.fx.impact.footprint(this.position.x, this.position.y, this.position.z, this.heading, 1.7, false);
    this._updateWeaponFX(dt);
    this.recoil = damp(this.recoil, 0, 7, dt);
  }

  _updateOnFoot(dt, canAct) {
    const g = this.game, input = g.input;
    const wantsRun = canAct && this.isMoving && input.isDown('ShiftLeft') && !this.isAiming && !this.exhausted && !this.isCrouching;
    if (wantsRun) { this.stamina = Math.max(0, this.stamina - 13 * dt); this.staminaDelay = 1.0; if (this.stamina <= 0) this.exhausted = true; }
    else { this.staminaDelay -= dt; if (this.staminaDelay <= 0) this.stamina = Math.min(100, this.stamina + 20 * dt); if (this.stamina > 30) this.exhausted = false; }
    this.isRunning = wantsRun;
    const targetSpeed = !this.isMoving ? 0 : this.isAiming ? CONFIG.AIM_SPEED : wantsRun ? CONFIG.RUN_SPEED : this.isCrouching ? CONFIG.WALK_SPEED * 0.5 : CONFIG.WALK_SPEED;
    this.velocity.x = damp(this.velocity.x, this._dir.x * targetSpeed, 9, dt);
    this.velocity.z = damp(this.velocity.z, this._dir.z * targetSpeed, 9, dt);
    this._move(dt);

    if (this.faceTarget) this.heading = dampAngle(this.heading, Math.atan2(this.faceTarget.x - this.position.x, this.faceTarget.z - this.position.z), 8, dt);
    else if (this.isAiming || this.aimBlend > 0.5) this.heading = dampAngle(this.heading, this.yaw, 18, dt);
    else if (this.isMoving) this.heading = dampAngle(this.heading, Math.atan2(this._dir.x, this._dir.z), 10, dt);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.speedNorm = clamp(speed / CONFIG.WALK_SPEED, 0, 1);
    this.runBlend = damp(this.runBlend, clamp((speed - CONFIG.WALK_SPEED) / (CONFIG.RUN_SPEED - CONFIG.WALK_SPEED), 0, 1), 6, dt);
    const cycle = lerp(2.5, 3.6, this.runBlend);
    this.phase += dt * (speed / cycle) * Math.PI * 2;
    const sign = Math.sin(this.phase) >= 0 ? 1 : -1;
    if (sign !== this.lastStepSign && speed > 0.6 && !this.isCrouching) g.audio.playFootstep(this.runBlend > 0.5);
    this.lastStepSign = sign;
  }

  // Se llama después de actualizar el caballo para colocar al jinete exactamente en la silla.
  lateUpdate(dt) {
    const g = this.game;
    if (this.riding) {
      const h = g.horse;
      this.position.copy(h.position);
      h.getSaddleWorld(_v);
      this.root.position.set(_v.x, _v.y - 0.98, _v.z);
      this.heading = (this.isAiming || this.aimBlend > 0.5) ? dampAngle(this.heading, this.yaw, 14, dt) : dampAngle(this.heading, h.heading, 14, dt);
      this.root.rotation.set(h.pitch * 0.7, this.heading, 0);
    } else {
      this.root.position.copy(this.position);
      this.root.rotation.set(0, this.heading, 0);
    }
    const H = CONFIG.HORSE;
    poseHumanoid(this.model, {
      phase: this.phase, speed: this.riding ? 0 : this.speedNorm, run: this.riding ? 0 : this.runBlend, aim: this.aimBlend,
      pitch: this.pitch, crouch: this.crouchBlend, t: g.elapsed, ride: this.rideBlend,
      rideLean: this.riding ? smoothstep(H.TROT, H.GALLOP, g.horse.speed) : 0,
    });
  }

  _move(dt) {
    const w = this.game.world, p = this.position;
    const oldX = p.x, oldZ = p.z, oldH = w.getHeightAt(oldX, oldZ);
    p.x += this.velocity.x * dt; p.z += this.velocity.z * dt;
    w.pushOut(p, 0.35);
    const npcs = this.game.npcs || [];
    for (const npc of npcs) {
      if (npc.active === false) continue;
      const dx = p.x - npc.position.x, dz = p.z - npc.position.z, d = Math.hypot(dx, dz), min = 0.75;
      if (d < min && d > 1e-4) { p.x += dx / d * (min - d); p.z += dz / d * (min - d); }
    }
    w.clampToWorld(p);
    const newH = w.getHeightAt(p.x, p.z), horiz = Math.hypot(p.x - oldX, p.z - oldZ);
    if (newH > oldH && newH - oldH > horiz * 1.05 + 0.01) { p.x = oldX; p.z = oldZ; this.velocity.multiplyScalar(0.5); }
    p.y = w.getHeightAt(p.x, p.z);
  }

  mountHorse() {
    const h = this.game.horse;
    this.riding = true; this.velocity.set(0, 0, 0); this.faceTarget = null;
    h.mount();
    this.heading = h.heading;
  }
  dismountHorse() {
    const g = this.game, h = g.horse;
    const lx = Math.cos(h.heading), lz = -Math.sin(h.heading);
    this.position.set(h.position.x + lx * 1.3, 0, h.position.z + lz * 1.3);
    g.world.pushOut(this.position, 0.35);
    g.world.clampToWorld(this.position);
    this.position.y = g.world.getHeightAt(this.position.x, this.position.z);
    this.riding = false;
    this.heading = h.heading;
    h.dismount();
  }
  respawnAt(x, z) {
    if (this.riding) this.dismountHorse();
    this.position.set(x, this.game.world.getHeightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.health = CONFIG.PLAYER_MAX_HEALTH; this.stamina = 100; this.lastHurt = 99; this.healPool = 0;
  }
  heal(amount) { this.healPool += amount; }
  // Dirección de mira actual de la cámara (reutiliza un vector; cópialo si lo guardas).
  aimDirection(out = _dir) { return this.game.camera.getWorldDirection(out); }

  takeDamage(amount, fromPos) {
    const g = this.game;
    if (g.mode === 'dead' || !g.started || this.invulnerable) return;
    this.health = Math.max(0, this.health - amount);
    this.lastHurt = 0; this.shake = 1;
    g.ui.damageFlash();
    if (fromPos) {   // indicador direccional del daño, relativo a la cámara
      const dx = fromPos.x - this.position.x, dz = fromPos.z - this.position.z, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      g.ui.hitDirection(Math.atan2(-dx * cy + dz * sy, dx * sy + dz * cy));
    }
    g.audio.playHurt();
    if (fromPos) g.fx.dust.burst(_v.set(this.position.x, this.position.y + 1.0, this.position.z), 6, { color: 0x8a1a12, size: 0.07, life: 0.5, speed: 1.4, up: 1, gravity: 8 });
    if (this.health <= 0) g.onPlayerDeath();
  }

  computeCamera(dt, outPos, outLook) {
    const c = this.cam, a = this.aimBlend, r = this.rideBlend, H = CONFIG.HORSE;
    const gallop = this.riding ? smoothstep(H.TROT, H.GALLOP, this.game.horse.speed) : 0;
    c.dist = damp(c.dist, lerp(lerp(4.3, 6.3, r), lerp(1.75, 2.6, r), a), 8, dt);
    c.side = damp(c.side, lerp(lerp(0.65, 0.45, r), 0.6, a), 8, dt);
    c.height = damp(c.height, lerp(lerp(1.62, 2.8, r), lerp(1.56, 2.45, r), a) - this.crouchBlend * 0.45, 8, dt);
    c.fov = damp(c.fov, lerp(lerp(62, 64, r), this.aimFov, a) + this.runBlend * 5 + gallop * 7, 8, dt);
    const pitch = this.pitch + this.recoil;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const f = this._tmp.set(sy * cp, sp, cy * cp);
    this._pivot.set(this.position.x - cy * c.side, this.position.y + c.height, this.position.z + sy * c.side);
    outPos.copy(this._pivot).addScaledVector(f, -c.dist);
    if (this.shake > 0.01) outPos.add(_v.set((Math.random() - 0.5) * this.shake * 0.25, (Math.random() - 0.5) * this.shake * 0.25, 0));
    const minY = this.game.world.getHeightAt(outPos.x, outPos.z) + 0.35;
    if (outPos.y < minY) outPos.y = minY;
    outLook.copy(this._pivot).addScaledVector(f, 10);
    return c.fov;
  }

  startReload() {
    if (this.reloadTimer > 0 || this.mag >= CONFIG.RIFLE_MAG) return;
    if (this.ammoReserve <= 0) { this.game.ui.notify('Sin munición', 'Compra cartuchos en el puesto de comercio'); return; }
    this.reloadTimer = CONFIG.RELOAD_TIME;
    this.game.audio.playReload(CONFIG.RELOAD_TIME, Math.min(CONFIG.RIFLE_MAG - this.mag, this.ammoReserve));
  }

  tryFire() {
    const g = this.game;
    if (this.cooldown > 0 || this.reloadTimer > 0) return;
    if (this.mag <= 0) { g.audio.playDryFire(); this.cooldown = 0.35; this.startReload(); return; }
    this.mag--; this.cooldown = CONFIG.RIFLE_COOLDOWN; this.readyTimer = 1.4;
    const cam = g.camera, dir = _dir;
    cam.getWorldDirection(dir);
    const minSpread = g.upgrades.has('barrel') ? 0.001 : 0.002;
    const spread = lerp(0.045, minSpread, this.aimBlend) + this.speedNorm * (this.riding ? 0.03 : 0.015);
    dir.x += (Math.random() - 0.5) * spread * 2; dir.y += (Math.random() - 0.5) * spread * 2; dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    const hit = this._resolveShot(_org.copy(cam.position), dir);
    this._muzzleFx(hit.point, null);
    this.recoil += 0.05;
    g.audio.playGunshot();
    g.bus.emit('gunshot', { position: this.position.clone() });
    this._applyHit(hit, dir, 1);
    if (this.mag === 0 && this.ammoReserve > 0) setTimeout(() => this.startReload(), 450);
  }

  // Fogonazo, luz del cañón, estela (pool) y humo. `tint`: color de la estela (Dead Eye = rojizo).
  _muzzleFx(point, tint) {
    const g = this.game;
    this.model.muzzle.getWorldPosition(this._muzzle);
    this.flash.visible = true; this.flashTimer = 0.055; this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    this.muzzleLight.position.copy(this._muzzle); this.muzzleLight.intensity = 14;
    g.fx.impact.tracer(this._muzzle, point, tint ? 0.16 : 0.09, tint);
    g.fx.dust.burst(this._muzzle, 5, { color: 0xb8b0a0, size: 0.25, life: 0.8, speed: 0.5, up: 1, alpha: 0.35, grow: 3, drag: 1.5 });
  }

  // Aplica el resultado de un disparo (daño + efectos + recarga de Dead Eye). Compartido por el disparo normal y la ráfaga de Dead Eye.
  _applyHit(hit, dir, dmgMul) {
    const g = this.game;
    let headshot = false, killed = false, kind = 'none';
    if (hit.animal) {
      const a = hit.animal; kind = 'animal';
      headshot = hit.point.y - a.position.y > (a.species === 'wolf' ? 0.85 : a.species === 'bear' ? 1.5 : 1.4);
      a.takeDamage(this.damage * dmgMul * (headshot ? 1.6 : 1), dir); killed = !a.alive;
      g.fx.impact.hit(hit.point, null, 'flesh'); g.ui.hitMarker(headshot);
    } else if (hit.actor) {
      const ac = hit.actor, was = ac.alive; kind = ac.faction === 'bandit' ? 'bandit' : 'actor';
      headshot = hit.point.y - ac.position.y > 1.52;
      ac.takeDamage(this.damage * dmgMul, dir, hit.point, 'player'); killed = was && !ac.alive;
      g.fx.impact.hit(hit.point, null, 'flesh'); g.ui.hitMarker(headshot);
    } else if (hit.type !== 'none') {
      const isRock = hit.object === g.world.chunks.veg.rock;
      if (hit.type === 'terrain') _nrm.copy(_up); else _nrm.copy(dir).negate();
      g.fx.impact.hit(hit.point, _nrm, isRock ? 'rock' : 'dirt');
    }
    g.deadEye.onShot({ kind, headshot, killed });
    g.bus.emit('player:shot', { kind, headshot, killed, animal: hit.animal, actor: hit.actor, object: hit.object, point: hit.point });
  }

  _resolveShot(origin, dir) {
    const g = this.game, maxDist = this.range, best = this._hit;
    best.dist = maxDist; best.point.copy(origin).addScaledVector(dir, maxDist); best.type = 'none'; best.animal = null; best.actor = null; best.object = null;
    const tT = g.world.raycastTerrain(origin, dir, maxDist);
    if (tT < best.dist) { best.dist = tT; best.point.copy(origin).addScaledVector(dir, tT); best.type = 'terrain'; }
    this.raycaster.set(origin, dir); this.raycaster.near = 0.5; this.raycaster.far = best.dist;
    const hits = this.raycaster.intersectObjects([...g.wildlife.getHitboxes(), ...g.bandits.getHitboxes(), ...g.townLife.getHitboxes(), ...g.world.solidTargets], false);
    if (hits.length) {
      const h = hits[0], animal = h.object.userData.animal || null, actor = h.object.userData.actor || null;
      best.dist = h.distance; best.point.copy(h.point); best.type = animal ? 'animal' : actor ? 'actor' : 'object'; best.animal = animal; best.actor = actor; best.object = h.object;
    }
    // Las balas también chocan con rocas/cajas/edificios analíticos (círculos y cajas AABB) que no tienen malla propia.
    const sd = g.world.segmentHit(origin.x, origin.y, origin.z, origin.x + dir.x * best.dist, origin.y + dir.y * best.dist, origin.z + dir.z * best.dist);
    if (sd >= 0 && sd * best.dist < best.dist - 0.01) { best.dist = sd * best.dist; best.point.copy(origin).addScaledVector(dir, best.dist); best.type = 'object'; best.animal = null; best.actor = null; best.object = null; }
    return best;
  }

  /* ---------------- Dead Eye ---------------- */
  // ¿Qué presa u hostil está bajo la mira? (para marcar con cruces rojas). Devuelve { kind, entity } o null.
  findMarkTarget() {
    const g = this.game, cam = g.camera;
    cam.getWorldDirection(_dir); _org.copy(cam.position);
    this.raycaster.set(_org, _dir); this.raycaster.near = 0.5; this.raycaster.far = this.range;
    const hits = this.raycaster.intersectObjects([...g.wildlife.getHitboxes(), ...g.bandits.getHitboxes()], false);
    for (const h of hits) {
      const animal = h.object.userData.animal, actor = h.object.userData.actor;
      if (animal && animal.alive) return { kind: 'animal', entity: animal };
      if (actor && actor.alive && actor.hostile && !UNMARKABLE.has(actor.state)) return { kind: 'actor', entity: actor };
    }
    return null;
  }
  // Punto del cuerpo al que apunta una marca (pecho/cabeza) y, de paso, su posición de pantalla se calcula fuera.
  markPoint(t, out) {
    if (t.kind === 'animal') return t.entity.getCenter(out);
    return out.set(t.entity.position.x, t.entity.position.y + 1.45, t.entity.position.z);
  }
  // Un disparo de la ráfaga: instantáneo, sin dispersión ni retroceso, daño letal. Devuelve false si no queda munición.
  fireDeadEye(t) {
    const g = this.game;
    if (this.mag <= 0) return false;
    this.mag--; this.readyTimer = 1.4;
    const point = this.markPoint(t, _v);
    this.model.muzzle.getWorldPosition(this._muzzle);
    const dir = _dir.copy(point).sub(this._muzzle).normalize();
    this._muzzleFx(point, DE_TINT);
    g.audio.playGunshot(0.8);
    g.bus.emit('gunshot', { position: this.position.clone() });
    const hit = this._hit; hit.point.copy(point); hit.type = t.kind; hit.object = null;
    hit.animal = t.kind === 'animal' ? t.entity : null; hit.actor = t.kind === 'actor' ? t.entity : null;
    this._applyHit(hit, dir, 5);
    return true;
  }

  // Disparo escenificado de un duelo: 'kill' | 'wound' | 'miss' | 'air'. No consume munición ni dispara balas reales.
  duelShot(entity, outcome) {
    const g = this.game;
    if (outcome === 'air') { this.model.muzzle.getWorldPosition(_v); _v.y += 30; }
    else {
      this.markPoint({ kind: 'actor', entity }, _v);
      if (outcome === 'miss') { _v.x += (Math.random() - 0.5) * 2.6; _v.y += (Math.random() - 0.3) * 1.2; }
    }
    this.readyTimer = 1.6; this.recoil += 0.05;
    this._muzzleFx(_v, null); g.audio.playGunshot();
    if (outcome === 'kill' || outcome === 'wound') g.fx.impact.hit(_v, null, 'flesh');
  }

  _updateWeaponFX(dt) {
    if (this.flashTimer > 0) { this.flashTimer -= dt; if (this.flashTimer <= 0) this.flash.visible = false; }
    this.muzzleLight.intensity = damp(this.muzzleLight.intensity, 0, 25, dt);
  }
}

export { PlayerController };
