// Pistolero (bandidos y agentes de la ley). Máquina de estados finitos con combate a distancia:
//
//   IDLE → ALERT → TO_COVER → COVER ⇄ PEEK → (ADVANCE / OPEN / SEARCH / FLEE)  → DEAD
//   extras: SURRENDER → CAPTIVE → JAILED (cabecilla capturado vivo), ARREST (ley), HOLDUP (asalto a un viajero)
//
// Cobertura sin raycasts por frame:
//   - La IA toma decisiones a 4-5 Hz (escalonadas), nunca por frame.
//   - Un "punto de cobertura" no es fijo: se calcula como  centro_del_obstáculo + dirección(jugador→obstáculo) * (r + 0.85),
//     es decir, siempre el lado que queda a salvo respecto al jugador. Si el jugador se mueve y el obstáculo deja de
//     protegerlo, basta una comprobación geométrica (distancia punto-segmento) para rodear el obstáculo.
//   - Asomarse = subir (cobertura baja: caja/barril) o salirse de lado (cobertura alta: roca). Solo entonces se hace UNA
//     comprobación de línea de visión y se dispara.
//   - Justicia: "fichas de disparo" globales (máx. 2 tiradores a la vez), retardo de apuntado visible antes de cada tiro,
//     precisión que mejora con el tiempo que el pistolero lleva viendo al jugador y empeora si el jugador se mueve.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, easeInOut } from '../core/MathUtils.js';
import { PALETTES, buildHumanoid, poseHumanoid } from '../entities/CharacterFactory.js';
import { MAT } from '../render/GeometryKit.js';

const S = {
  IDLE: 'idle', ALERT: 'alert', TO_COVER: 'to_cover', COVER: 'cover', PEEK: 'peek', OPEN: 'open', ADVANCE: 'advance', SEARCH: 'search',
  FLEE: 'flee', SURRENDER: 'surrender', CAPTIVE: 'captive', JAILED: 'jailed', ARREST: 'arrest', HOLDUP: 'holdup', DEAD: 'dead',
};
const COMBAT = new Set([S.ALERT, S.TO_COVER, S.COVER, S.PEEK, S.OPEN, S.ADVANCE]);
const B = CONFIG.BANDIT;
const rr = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3(), _dir = new THREE.Vector3(), _rt = new THREE.Vector3(), _up2 = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);

class Gunman {
  constructor(game, manager, def) {
    this.game = game; this.manager = manager; this.def = def;
    this.id = def.id; this.name = def.name; this.faction = def.faction; this.role = def.role || 'bandit';
    this.leader = !!def.leader; this.campId = def.camp || null; this.interaction = def.interaction || null;
    this.skill = def.skill ?? (0.45 + Math.random() * 0.3);
    this.model = buildHumanoid(PALETTES[def.palette], true, { shadow: 'body' });
    this.root = this.model.root; this.root.rotation.order = 'YXZ'; game.scene.add(this.root);
    this.hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.85, 0.5), MAT.hitbox);
    this.hitbox.visible = false; this.hitbox.position.y = 0.92; this.hitbox.userData.actor = this; this.root.add(this.hitbox);
    this.position = new THREE.Vector3(); this.home = new THREE.Vector3(); this.lastSeen = new THREE.Vector3(); this.coverPoint = new THREE.Vector3();
    this._muzzle = new THREE.Vector3(); this._eye = new THREE.Vector3(); this._tmp = new THREE.Vector3();
    this.maxHp = def.hp || (this.leader ? B.LEADER_HP : B.HP);
    this.phase = Math.random() * 10; this.seed = Math.random() * 100;
    this.talking = false; this.mode = def.faction === 'law' ? 'peace' : 'lethal';
    this.patrol = def.patrol || null; this.patrolIdx = 0; this.patrolPause = 0;
    this.spawn(def.x, def.z);
  }
  get alive() { return this.state !== S.DEAD; }
  get hostile() { return this.faction === 'bandit' || this.mode !== 'peace'; }
  get inCombat() { return COMBAT.has(this.state); }

  spawn(x, z) {
    const w = this.game.world;
    this.position.set(x, w.getHeightAt(x, z), z); this.home.copy(this.position);
    this.heading = Math.random() * 6.28; this.moveDir = this.heading; this.speed = 0;
    this.hp = this.maxHp; this.deadTime = 0; this.deathT = 0;
    this.state = S.IDLE; this.stateTime = 0; this.time = 0;
    this.cover = null; this.exposure = 0; this.hideTime = 1.5; this.shotsLeft = 0; this.aimT = 0; this.aimDelay = 0.9; this.lockT = 0;
    this.fireCd = rr(0.8, 2.0); this.react = 0.6; this.percept = Math.random() * 0.3; this.checkT = 0; this.strafeT = 0; this.strafeDir = 1;
    this.lastSeenT = -99; this.kick = 0; this.arrestT = 0; this.warnT = 0; this.flinch = 0; this.idleT = Math.random() * 4; this.idleTarget = null;
    this.aimBlend = 0; this.hunkerBlend = 0; this.handsBlend = 0; this.boundBlend = 0; this.crouchBlend = 0; this.side = 1;
    this.surrendered = false; this.tied = false; this.farT = 0; this.avoidT = 0; this.avoidOff = 0; this.stuck = 0; this.looted = false;
    this.root.rotation.set(0, this.heading, 0); this.root.visible = true; this.model.rifle.visible = true;
    this.hitbox.scale.y = 1; this.hitbox.position.y = 0.92;
    this._applyTransform();
  }
  setState(s) { this.state = s; this.stateTime = 0; }

  /* ------------------------------ Percepción ------------------------------ */
  get eyeY() { return this.position.y + lerp(1.0, 1.55, this.hunkerBlend > 0.5 ? this.exposure : 1); }
  _hasLOS(pp, standing = true) {
    const p = this.game.player, w = this.game.world;
    const ey = this.position.y + (standing ? 1.55 : this.eyeY - this.position.y), cy = pp.y + (p.riding ? 1.9 : 1.25);
    return !w.lineBlocked(this.position.x, ey, this.position.z, pp.x, cy, pp.z);
  }
  _detectRange(ctx) {
    const p = this.game.player;
    let r = B.DETECT * (ctx.night > 0.5 ? 0.78 : 1);
    if (p.riding) r += 8; if (p.isRunning) r += 8; if (p.isAiming) r *= 0.85;
    return r;
  }
  _perceive(ctx) {
    if (ctx.playerDead || ctx.dist > this._detectRange(ctx)) return false;
    if (ctx.dist > 24 && Math.abs(wrapAngle(Math.atan2(ctx.pp.x - this.position.x, ctx.pp.z - this.position.z) - this.heading)) > 1.2) return false;
    return this._hasLOS(ctx.pp);
  }
  // Un compañero o un disparo nos avisan: pasamos a ALERT sin ver aún al jugador.
  alertTo(pos, delay = 0.3 + Math.random() * 0.7) {
    if (!this.alive || this.state === S.SURRENDER || this.state === S.CAPTIVE || this.state === S.JAILED || this.inCombat || this.state === S.FLEE || !this.hostile) return;
    this.lastSeen.copy(pos); this.lastSeenT = this.time; this.react = delay; this.setState(S.ALERT);
  }

  /* ------------------------------- Cobertura ------------------------------- */
  _findCover(ctx) {
    const list = this.manager.coversFor(this), pp = ctx.pp, w = this.game.world;
    let best = null, bestScore = 1e9, bx = 0, bz = 0;
    for (const c of list) {
      const dxp = c.x - pp.x, dzp = c.z - pp.z, dp = Math.hypot(dxp, dzp);
      if (dp < 7 || dp > 75) continue;
      const px = c.x + dxp / dp * (c.r + 0.85), pz = c.z + dzp / dp * (c.r + 0.85);
      const dMe = Math.hypot(px - this.position.x, pz - this.position.z);
      if (dMe > 42) continue;
      const dpt = Math.hypot(px - pp.x, pz - pp.z);
      const score = dMe + Math.max(0, ctx.dist - dpt) * 0.9 + Math.abs(dpt - 30) * 0.25 + (c.owner && c.owner !== this && c.owner.alive ? 30 : 0);
      if (score >= bestScore || w.isBlocked(px, pz, 0.4)) continue;
      best = c; bestScore = score; bx = px; bz = pz;
    }
    if (!best) return false;
    if (this.cover && this.cover.owner === this) this.cover.owner = null;
    this.cover = best; best.owner = this; this.coverPoint.set(bx, 0, bz);
    return true;
  }
  // ¿El obstáculo sigue entre el pistolero y el jugador? (distancia centro-segmento)
  _covered(ctx) {
    const c = this.cover; if (!c) return false;
    const ax = this.position.x, az = this.position.z, vx = ctx.pp.x - ax, vz = ctx.pp.z - az, L2 = vx * vx + vz * vz || 1;
    const t = clamp(((c.x - ax) * vx + (c.z - az) * vz) / L2, 0, 1);
    if (t <= 0.02 || t >= 0.98) return false;
    return Math.hypot(c.x - (ax + vx * t), c.z - (az + vz * t)) < c.r * 0.92 + 0.3;
  }
  _dropCover() { if (this.cover && this.cover.owner === this) this.cover.owner = null; this.cover = null; }
  get lowCover() { return !!this.cover && this.cover.h < 1.45; }

  /* ------------------------------- Movimiento ------------------------------- */
  _goto(tx, tz, speed, dt, turn = 8) {
    const dx = tx - this.position.x, dz = tz - this.position.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { this.targetSpeed = 0; return d; }
    this.avoidT -= dt;
    if (this.avoidT <= 0) {   // sondeo escalonado: esquiva obstáculos delante
      this.avoidT = 0.25; const w = this.game.world, a0 = Math.atan2(dx, dz); this.avoidOff = 0;
      const probe = (a) => w.isBlocked(this.position.x + Math.sin(a0 + a) * 1.6, this.position.z + Math.cos(a0 + a) * 1.6, 0.45);
      if (probe(0)) for (const a of [0.7, -0.7, 1.4, -1.4]) if (!probe(a)) { this.avoidOff = a; break; }
    }
    this.moveDir = dampAngle(this.moveDir, Math.atan2(dx, dz) + this.avoidOff, turn, dt);
    this.targetSpeed = d < 0.8 ? speed * 0.5 : speed;
    return d;
  }
  _integrate(dt) {
    const w = this.game.world, p = this.position, ox = p.x, oz = p.z, oh = p.y;
    this.speed = damp(this.speed, this.targetSpeed, 7, dt);
    if (this.speed > 0.02) {
      p.x += Math.sin(this.moveDir) * this.speed * dt; p.z += Math.cos(this.moveDir) * this.speed * dt;
      w.pushOut(p, 0.4); w.clampToWorld(p);
      const nh = w.getHeightAt(p.x, p.z), horiz = Math.hypot(p.x - ox, p.z - oz);
      if (nh > oh && nh - oh > horiz * 1.1 + 0.02) { p.x = ox; p.z = oz; this.speed *= 0.3; this.stuck += dt; } else this.stuck = Math.max(0, this.stuck - dt);
    }
    p.y = w.getHeightAt(p.x, p.z);
  }
  _face(angle, rate, dt) { this.heading = dampAngle(this.heading, angle, rate, dt); }

  /* -------------------------------- Disparo -------------------------------- */
  _fire(ctx) {
    const g = this.game, p = g.player, pp = ctx.pp, m = this.model;
    m.muzzle.getWorldPosition(this._muzzle);
    let pvx = 0, pvz = 0, mov = 0;
    if (p.riding) { const h = g.horse; pvx = Math.sin(h.heading) * h.speed; pvz = Math.cos(h.heading) * h.speed; mov = clamp(h.speed / 9, 0, 1); }
    else { pvx = p.velocity.x; pvz = p.velocity.z; mov = p.speedNorm * 0.6; }
    const flight = ctx.dist / B.BULLET_SPEED, lead = flight * 0.5 * this.skill;
    _dir.set(pp.x + pvx * lead - this._muzzle.x, pp.y + (p.riding ? 1.85 : 1.25) - this._muzzle.y, pp.z + pvz * lead - this._muzzle.z).normalize();
    // Dispersión angular: peor al inicio (poco tiempo apuntando) y contra un blanco que se mueve; nunca perfecta.
    const sd = Math.max(0.025, lerp(0.09, 0.04, this.skill) * (1 + mov * 1.3) * lerp(1.7, 1.0, clamp(this.lockT / 2.5, 0, 1)) * (this.hunkerBlend > 0.3 ? 1.2 : 1));
    const r = sd * Math.sqrt(Math.random()), th = Math.random() * 6.2832;
    _rt.crossVectors(_Y, _dir).normalize(); _up2.crossVectors(_dir, _rt);
    _dir.addScaledVector(_rt, r * Math.cos(th)).addScaledVector(_up2, r * Math.sin(th)).normalize();
    const dmg = this.faction === 'law' ? rr(7, 11) : rr(B.DAMAGE[0], B.DAMAGE[1]);
    this.manager.projectiles.fire(this._muzzle, _dir, B.BULLET_SPEED, dmg, this);
    g.fx.glow.burst(this._muzzle, 4, { color: 0xffc070, size: 0.22, life: 0.1, speed: 0.4, up: 1 });
    g.fx.dust.burst(this._muzzle, 3, { color: 0xb8b0a0, size: 0.22, life: 0.7, speed: 0.4, up: 1, alpha: 0.3, grow: 3, drag: 1.5 });
    g.audio.playShotAt(ctx.dist);
    g.bus.emit('gunshot', { position: this.position.clone(), source: 'enemy' });
    this.kick = 1;
  }

  /* -------------------------------- Daño -------------------------------- */
  takeDamage(amount, dir, point, source = 'player') {
    if (!this.alive || this.state === S.JAILED) return;
    const sy = this.hitbox.scale.y, relY = point ? (point.y - this.position.y) / sy : 0;
    const head = point && relY > 1.52;
    const wasSurrendered = this.state === S.SURRENDER || this.state === S.CAPTIVE;
    this.hp -= head ? amount * 2.2 : amount;
    if (head) this.game.ui.hitMarker(true);
    this.manager.onGunmanHit(this, source, wasSurrendered);
    if (this.hp <= 0) { this.kill(dir, source, wasSurrendered); return; }
    this.flinch = 0.35;
    if (this.state === S.PEEK && Math.random() < 0.6) this._retreat();
    if (this.state === S.IDLE || this.state === S.SEARCH || this.state === S.HOLDUP) {
      this.lastSeen.copy(this.game.player.position); this.lastSeenT = this.time; this.react = 0.25; this.setState(S.ALERT);
      this.manager.alertGroup(this, this.game.player.position);
    }
    const frac = this.hp / this.maxHp;
    if (this.leader && frac < 0.22 && this.manager.canSurrender(this) && this.state !== S.SURRENDER) { this.surrender(); return; }
    if (!this.leader && this.faction === 'bandit' && frac < 0.28 && Math.random() < 0.55 && this.state !== S.FLEE) { this._dropCover(); this.manager.releaseToken(this); this.manager.bark(this, 'flee'); this.setState(S.FLEE); }
    else this.manager.bark(this, 'hurt');
  }
  kill(dir, source = 'player', wasSurrendered = false) {
    if (!this.alive) return;
    this._dropCover(); this.manager.releaseToken(this);
    this.setState(S.DEAD); this.speed = 0; this.targetSpeed = 0; this.deathT = 0; this.deadTime = 0; this.hp = 0; this.talking = false;
    this.model.rifle.visible = false;
    this.manager.onGunmanKilled(this, source, wasSurrendered);
  }
  surrender() {
    this._dropCover(); this.manager.releaseToken(this);
    this.surrendered = true; this.setState(S.SURRENDER); this.model.rifle.visible = false;
    this.manager.bark(this, 'surrender');
  }
  tie() { this.tied = true; this.surrendered = false; this.setState(S.CAPTIVE); }
  jail(pos, faceX, faceZ) {
    this.setState(S.JAILED); this.position.set(pos.x, pos.y, pos.z); this.heading = Math.atan2(faceX - pos.x, faceZ - pos.z); this.speed = 0; this.targetSpeed = 0;
  }
  _retreat() {
    this.manager.releaseToken(this);
    if (this.cover) { this.setState(S.COVER); this.hideTime = rr(1.4, 3.0) * (this.manager.aliveAllies(this) <= 1 ? 0.6 : 1); }
    else this.setState(S.ADVANCE);
  }

  /* ---------------------------------- FSM ---------------------------------- */
  update(dt, ctx) {
    this.time += dt; this.stateTime += dt; this.fireCd -= dt; this.flinch = Math.max(0, this.flinch - dt); this.kick = Math.max(0, this.kick - dt * 5);
    if (this.state === S.DEAD) { this._updateDead(dt); return; }
    const p = this.position, pp = ctx.pp;
    const toP = Math.atan2(pp.x - p.x, pp.z - p.z);
    this.targetSpeed = 0;
    this.percept -= dt;
    const tick = this.percept <= 0; if (tick) this.percept = 0.22 + Math.random() * 0.1;
    let aimT = 0, hunkT = 0, handsT = 0, boundT = 0, crouchT = 0;

    switch (this.state) {
      case S.IDLE: {
        if (this.faction === 'law') this._idleLaw(dt, ctx, toP); else this._idleBandit(dt, toP);
        if (tick && this.hostile && this._perceive(ctx)) this._spot(ctx);
        break;
      }
      case S.HOLDUP: {
        aimT = 1; const t = this.def.holdTarget; if (t) this._face(Math.atan2(t.x - p.x, t.z - p.z), 5, dt);
        if (tick && (ctx.dist < 42 && this._hasLOS(pp))) this._spot(ctx);
        break;
      }
      case S.ALERT: {
        aimT = 0.6; this._face(toP, 9, dt);
        if (this.stateTime > this.react) { this.manager.bark(this, 'alert'); this._chooseTactic(ctx); }
        break;
      }
      case S.TO_COVER: {
        aimT = 0.5; this._combatPerceive(tick, ctx);
        const d = this._goto(this.coverPoint.x, this.coverPoint.z, B.SPEED_RUN, dt);
        this._face(this.speed > 1 ? this.moveDir : toP, 9, dt);
        if (d < 0.45) { this.setState(S.COVER); this.hideTime = rr(0.8, 1.8); } else if (this.stateTime > 7 || this.stuck > 1.2) { this.stuck = 0; this._dropCover(); this.setState(S.ALERT); this.react = 0.2; }
        break;
      }
      case S.COVER: {
        hunkT = 1; aimT = 0.4; this.exposure = damp(this.exposure, 0, 7, dt); this._face(toP, 5, dt);
        this._combatPerceive(tick, ctx);
        this.checkT -= dt;
        if (this.checkT <= 0) {   // ¿sigue protegiéndome? si el jugador se movió, rodeo el obstáculo
          this.checkT = 0.8 + Math.random() * 0.4;
          if (!this._covered(ctx) && this._findCover(ctx)) { this.setState(S.TO_COVER); break; }
        }
        // mantener la posición exacta tras la cobertura
        if (this.speed < 0.3) { const k = 1 - Math.exp(-6 * dt); p.x += (this.coverPoint.x - p.x) * k; p.z += (this.coverPoint.z - p.z) * k; }
        if (this.stateTime > this.hideTime && this.fireCd <= 0 && ctx.dist < 80) {
          if (this.manager.requestToken(this, 3.4)) { this.setState(S.PEEK); this.shotsLeft = Math.random() < 0.35 ? 2 : 1; this.aimT = 0; this.side = Math.random() < 0.5 ? -1 : 1; this.aimDelay = lerp(0.95, 0.5, clamp(this.lockT / 3, 0, 1)); }
          else this.hideTime += 0.5;
        }
        if (this.time - this.lastSeenT > 12 || (ctx.dist > 100 && this.stateTime > 4)) { this._dropCover(); this.setState(S.SEARCH); }
        break;
      }
      case S.PEEK: {
        aimT = 1; this._face(toP, 12, dt); this._combatPerceive(tick, ctx);
        this.exposure = damp(this.exposure, 1, 6, dt);
        hunkT = (1 - this.exposure) * (this.lowCover ? 1 : 0.35);
        if (!this.lowCover && this.cover && this.exposure > 0.01) {   // cobertura alta: salirse de lado
          const off = (this.cover.r + 0.55) * this.exposure * this.side, rx = Math.cos(toP), rz = -Math.sin(toP);
          const k = 1 - Math.exp(-8 * dt);
          p.x += (this.coverPoint.x + rx * off - p.x) * k; p.z += (this.coverPoint.z + rz * off - p.z) * k;
        }
        if (this.exposure > 0.9) {
          this.aimT += dt;
          if (this.aimT >= this.aimDelay) {
            if (this._hasLOS(pp, false)) {
              this.lockT += this.aimDelay; this.lastSeenT = this.time; this.lastSeen.copy(pp);
              this._fire(ctx); this.shotsLeft--; this.aimT = -rr(0.35, 0.6); this.aimDelay = 0.5; this.fireCd = rr(B.FIRE_COOLDOWN[0], B.FIRE_COOLDOWN[1]);
              if (this.shotsLeft <= 0) this._retreat();
            } else if (this.stateTime > 1.8) { this._retreat(); if (!this._covered(ctx) && this._findCover(ctx)) this.setState(S.TO_COVER); }
          }
        }
        if (this.stateTime > 5) this._retreat();
        break;
      }
      case S.OPEN: {   // sin cobertura: se planta a media distancia, se desplaza de lado y dispara con menos frecuencia
        aimT = 1; this._face(toP, 10, dt); this._combatPerceive(tick, ctx);
        this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = rr(1.0, 2.2); this.strafeDir = Math.random() < 0.5 ? -1 : 1; }
        const want = 26;
        this.moveDir = toP + (ctx.dist > want + 6 ? 0.35 : ctx.dist < want - 8 ? Math.PI - 0.35 : Math.PI / 2) * this.strafeDir;
        this.targetSpeed = ctx.dist > want + 14 ? B.SPEED_RUN * 0.8 : 1.8;
        this.aimT += dt;
        if (this.aimT >= this.aimDelay && this.fireCd <= 0 && ctx.dist < 80 && this.manager.requestToken(this, 1.1)) {
          if (this._hasLOS(pp, true)) { this.lockT += this.aimDelay; this.lastSeenT = this.time; this.lastSeen.copy(pp); this._fire(ctx); this.aimT = -rr(0.2, 0.5); this.aimDelay = lerp(0.9, 0.55, clamp(this.lockT / 3, 0, 1)); this.fireCd = rr(B.FIRE_COOLDOWN[0] + 0.3, B.FIRE_COOLDOWN[1] + 0.9); }
          else this.fireCd = 0.6;
        }
        if (this.stateTime > 1.5 && Math.random() < dt * 0.6 && this._findCover(ctx)) this.setState(S.TO_COVER);
        if (this.time - this.lastSeenT > 12) this.setState(S.SEARCH);
        break;
      }
      case S.ADVANCE: {
        aimT = 0.55; this._combatPerceive(tick, ctx);
        const want = 24 + (this.seed % 8);
        if (this.faction === 'bandit' || this.hostile) {
          if (ctx.dist > want) { this._goto(pp.x, pp.z, B.SPEED_RUN * 0.85, dt); this._face(this.speed > 1 ? this.moveDir : toP, 8, dt); } else this._face(toP, 8, dt);
        }
        this.checkT -= dt;
        if (this.checkT <= 0) {
          this.checkT = 0.6 + Math.random() * 0.4;
          if (ctx.dist < 72 && this._findCover(ctx)) { this.setState(S.TO_COVER); break; }
          if (ctx.dist <= want + 2) { this.aimT = 0; this.aimDelay = 0.9; this.setState(S.OPEN); break; }
        }
        if (this.time - this.lastSeenT > 14 || ctx.dist > 110) { this.farT += dt; if (this.farT > 4) { this.farT = 0; this.setState(S.SEARCH); } } else this.farT = 0;
        break;
      }
      case S.SEARCH: {
        aimT = 0.3;
        if (this.stateTime < 9) {
          const d = this._goto(this.lastSeen.x, this.lastSeen.z, 2.6, dt);
          this._face(this.speed > 0.6 ? this.moveDir : this.heading + Math.sin(this.time * 0.8) * 0.01, 6, dt);
          if (d < 2) this.heading += dt * 0.9 * Math.sin(this.time);
        } else this._goto(this.home.x, this.home.z, 2.2, dt);
        if (tick && this.hostile && this._perceive(ctx)) { this._spot(ctx); break; }
        if (this.stateTime > 9 && Math.hypot(p.x - this.home.x, p.z - this.home.z) < 2.5) this.setState(S.IDLE);
        if (this.stateTime > 30) { this.setState(S.IDLE); this.hp = Math.max(this.hp, this.maxHp * 0.6); }
        if (ctx.playerDead) this.setState(S.IDLE);
        break;
      }
      case S.FLEE: {
        const away = Math.atan2(p.x - pp.x, p.z - pp.z);
        this._goto(p.x + Math.sin(away) * 20, p.z + Math.cos(away) * 20, B.SPEED_RUN * 1.15, dt, 5);
        this._face(this.moveDir, 8, dt);
        if (this.stateTime > 7 || ctx.dist > 90) { this.setState(S.SEARCH); this.lastSeen.copy(this.home); this.stateTime = 9; }
        break;
      }
      case S.SURRENDER: { handsT = 1; crouchT = 0.85; this._face(toP, 4, dt); break; }
      case S.CAPTIVE: {
        boundT = 1; this._face(toP, 3, dt);
        const d = ctx.dist;
        if (d > 3.5 && !this.talking) {
          this._goto(pp.x, pp.z, clamp(2.6 + (d - 3.5) * 0.9, 2.6, 8), dt, 6);
          this._face(this.moveDir, 6, dt);
        }
        this.manager.leashCaptive(this, ctx);
        break;
      }
      case S.JAILED: { boundT = 0; this._face(toP, 2, dt); break; }
      case S.ARREST: {
        aimT = 0; this._face(toP, 8, dt);
        const d = ctx.dist;
        if (d > 3.4) { this._goto(pp.x, pp.z, d > 12 ? B.SPEED_RUN : 3.6, dt); this._face(this.speed > 1 ? this.moveDir : toP, 8, dt); }
        this.warnT -= dt; if (this.warnT <= 0 && d < 40) { this.warnT = 6; this.manager.bark(this, 'arrest'); }
        if (d < 6 && !this.game.player.isAiming) this.arrestT += dt; else this.arrestT = Math.max(0, this.arrestT - dt * 0.6);
        if (this.arrestT > 2.4) { this.arrestT = 0; this.manager.law.arrest(this); }
        if (this.mode === 'peace' || ctx.playerDead) { this.setState(S.IDLE); }
        else if (d > 150) { this.setState(S.IDLE); }
        break;
      }
      default: break;
    }

    this._integrate(dt);
    this._applyTransform();

    // --- pose ---
    this.aimBlend = damp(this.aimBlend, aimT, 9, dt);
    this.hunkerBlend = damp(this.hunkerBlend, hunkT, 10, dt);
    this.handsBlend = damp(this.handsBlend, handsT, 8, dt);
    this.boundBlend = damp(this.boundBlend, boundT, 8, dt);
    this.crouchBlend = damp(this.crouchBlend, crouchT, 6, dt);
    this.hitbox.scale.y = lerp(1, 0.55, this.hunkerBlend); this.hitbox.position.y = 0.92 * this.hitbox.scale.y;
    if (ctx.animate) {
      const sp = this.speed, cyc = lerp(2.5, 3.6, clamp((sp - 3.3) / 3.7, 0, 1));
      this.phase += dt * (sp / cyc) * Math.PI * 2;
      const pitch = Math.atan2((pp.y + 1.3) - (p.y + 1.45), Math.max(ctx.dist, 1)) + this.kick * 0.12;
      poseHumanoid(this.model, {
        phase: this.phase, speed: clamp(sp / CONFIG.WALK_SPEED, 0, 1), run: clamp((sp - CONFIG.WALK_SPEED) / (CONFIG.RUN_SPEED - CONFIG.WALK_SPEED), 0, 1),
        aim: this.aimBlend, rifleAim: Math.max(this.aimBlend, this.hunkerBlend * 0.8), pitch, crouch: this.crouchBlend, hunker: this.hunkerBlend,
        hands: this.handsBlend, bound: this.boundBlend, t: this.game.elapsed + this.seed, gesture: this.talking ? 1 : 0,
      });
    }
  }

  _applyTransform() {
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.heading, 0);
  }
  _updateDead(dt) {
    this.deadTime += dt;
    if (this.deathT < 1) {
      this.deathT = Math.min(1, this.deathT + dt * 2.2);
      const e = easeInOut(this.deathT);
      this.root.rotation.set(-e * 1.5, this.heading, 0); this.root.position.set(this.position.x, this.position.y + e * 0.14, this.position.z);
      poseHumanoid(this.model, { t: this.game.elapsed, aim: 0, hands: 0 });
    }
    if (this.deadTime > 40) this.root.visible = false;
  }

  _combatPerceive(tick, ctx) {
    if (!tick) return;
    if (ctx.playerDead) { this._dropCover(); this.setState(S.SEARCH); return; }
    if (ctx.dist < 90 && this._hasLOS(ctx.pp)) { this.lastSeenT = this.time; this.lastSeen.copy(ctx.pp); }
  }
  _spot(ctx) {
    this.lastSeen.copy(ctx.pp); this.lastSeenT = this.time; this.react = 0.35 + Math.random() * 0.4; this.lockT = 0;
    this.setState(this.mode === 'arrest' ? S.ARREST : S.ALERT);
    if (this.state === S.ALERT) this.manager.alertGroup(this, ctx.pp);
  }
  _chooseTactic(ctx) {
    if (this.mode === 'arrest') { this.setState(S.ARREST); return; }
    if (ctx.dist > 85) { this.setState(S.ADVANCE); return; }
    if (this._findCover(ctx)) { this.setState(S.TO_COVER); return; }
    this.aimT = 0; this.aimDelay = 0.95; this.setState(ctx.dist < 20 ? S.OPEN : S.ADVANCE);
  }

  /* --------------------------- Estados pasivos --------------------------- */
  _idleBandit(dt, toP) {
    this.idleT -= dt;
    const spot = this.def.spot || this.home;
    if (this.idleT <= 0 && !this.idleTarget) {
      this.idleT = rr(4, 9);
      if (Math.random() < 0.55) { const a = Math.random() * 6.28, r = rr(1, 3.2); this.idleTarget = { x: spot.x + Math.sin(a) * r, z: spot.z + Math.cos(a) * r }; }
    }
    if (this.idleTarget) {
      const d = this._goto(this.idleTarget.x, this.idleTarget.z, B.SPEED_WALK, dt, 5);
      this._face(this.moveDir, 5, dt);
      if (d < 0.5) this.idleTarget = null;
    } else {
      const cx = this.def.look ? this.def.look.x : spot.x, cz = this.def.look ? this.def.look.z : spot.z;
      this._face(Math.atan2(cx - this.position.x, cz - this.position.z), 2, dt);
    }
  }
  _idleLaw(dt, ctx, toP) {
    if (this.talking) { this._face(toP, 6, dt); return; }
    if (!this.patrol || this.patrol.length < 2) {
      const sp = this.def.spot || this.home;
      const d = Math.hypot(sp.x - this.position.x, sp.z - this.position.z);
      if (d > 0.8) { this._goto(sp.x, sp.z, 1.6, dt, 5); this._face(this.moveDir, 5, dt); }
      else this._face(ctx.dist < 12 ? toP : this.def.facing ?? this.heading, 2.5, dt);
      return;
    }
    if (this.patrolPause > 0) { this.patrolPause -= dt; this._face(ctx.dist < 9 ? toP : this.heading, 2, dt); return; }
    const t = this.patrol[this.patrolIdx];
    const d = this._goto(t.x, t.z, 1.7, dt, 5);
    this._face(this.moveDir, 5, dt);
    if (d < 0.8) { this.patrolIdx = (this.patrolIdx + 1) % this.patrol.length; this.patrolPause = rr(2, 6); }
  }
}

export { Gunman, S as GUNMAN_STATE };
