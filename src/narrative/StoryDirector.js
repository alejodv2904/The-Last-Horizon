// Director de la historia: da vida al mundo que describe campaign.js.
//   · Personajes: miembros de la banda en el campamento (que se muda entre capítulos), dadores de misión y PNJ de escena.
//   · Enemigos y fauna de misión (nacen al acercarse el jugador y se retiran al terminar).
//   · Acompañantes (escoltas, aliados de combate) que siguen al jugador.
//   · Baliza luminosa y waypoints del radar para el objetivo actual.
// Todo se crea con "lazy spawn" y se libera al terminar, para no cargar el motor en partidas largas.
import * as THREE from 'three';
import { distXZ } from '../core/MathUtils.js';
import { paletteFor } from '../entities/CharacterFactory.js';
import { resolveLocation } from './LocationMap.js';

const CAMP_MEMBERS = ['silas', 'abner', 'josie', 'wren', 'marta', 'doc', 'isaiah', 'nate', 'toby'];
// Puestos de cada miembro respecto a la fogata (x, z). Silas conserva su sitio histórico junto al fuego.
const SPOTS = { silas: [-2.3, -2.1], abner: [2.9, -1.6], josie: [-3.4, 1.4], wren: [1.6, 2.7], marta: [-0.6, 3.6], doc: [-4.2, -0.6], isaiah: [4.3, 2.3], nate: [3.2, -3.4], toby: [-1.6, -3.8] };
// Dónde está cada personaje de escena cuando no es de la banda ni del pueblo (si no se indica, en el lugar de la misión).
const HOME = {
  pike: 'pike_post', ines: 'castellanos_hacienda', mateo: 'castellanos_hacienda', dunmore: 'dunmore_ranch', lena: 'dunmore_ranch', odwyer: 'railhead', wei: 'railhead',
  grady: 'dolorosa_mine', remedios: 'santa_aurelia', joaquin: 'santa_aurelia', cole: 'redwood_gulch', hattie: 'redwood_gulch', tomas: 'redwood_gulch', sal: 'redwood_gulch',
  jed: 'la_rueda', whitmore: 'white_ridge', garrity: 'rustler_hollow',
};
const NAMES = ['Cutter', 'Hank Moss', 'Ramón Vega', 'Dutch Colby', 'Sparrow', 'Jebediah', 'Lefty Rudd', 'Tuco', 'Mac Garrity', 'Pete Rawls', 'El Tuerto', 'Silas Boyd'];
const PALS = ['bandit1', 'bandit2', 'bandit3'];
const _v = new THREE.Vector3();

class StoryDirector {
  constructor(game) {
    this.game = game; this.spawned = new Map(); this.companions = []; this.waypoints = []; this.siteId = null; this._n = 0;
    const geo = new THREE.CylinderGeometry(0.45, 0.45, 70, 10, 1, true); geo.translate(0, 35, 0);
    this.beacon = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    this.beacon.visible = false; this.beacon.frustumCulled = false; game.scene.add(this.beacon);
  }

  /* ------------------------------ Lugares ------------------------------ */
  // Punto de aparición de un personaje/objeto en un lugar: círculo alrededor del centro, distinto por `salt`.
  anchor(locId, salt = 0, radius = 4) {
    const loc = resolveLocation(locId, this.game.world) || resolveLocation('cedar_hollow_camp', this.game.world);
    const a = salt * 2.1 + 0.6, r = radius + salt * 1.6;
    const p = { x: loc.x + Math.sin(a) * r, z: loc.z + Math.cos(a) * r };
    _v.set(p.x, 0, p.z); this.game.world.pushOut(_v, 0.5); p.x = _v.x; p.z = _v.z;
    return { ...p, y: this.game.world.getHeightAt(p.x, p.z), loc };
  }
  homeOf(id, fallback) { return HOME[id] || fallback; }

  /* ------------------------------ PNJ ------------------------------ */
  npc(id) { return this.game.npcs.find((n) => n.id === id) || null; }
  ensureNPC(id, locId, salt = 0) {
    let n = this.npc(id);
    if (n) { if (!n.active) n.setActive(true); return n; }
    if (!this.game.story.npcs[id]) return null;
    const p = this.anchor(locId, salt + 1, 3);
    const pl = this.game.player.position;
    n = this.game.addNPC({ id, palette: paletteFor(id), interaction: 'dialogue', x: p.x, z: p.z, faceX: pl.x, faceZ: pl.z, lite: true, viewDist: 160 });
    this.spawned.set(id, n);
    return n;
  }
  // Retira a un PNJ creado por el director (Silas, Pike y la gente del pueblo nunca se borran: solo Silas se oculta).
  removeNPC(id) {
    if (id === 'silas') { const n = this.npc('silas'); if (n) { n.setActive(false); n.root.visible = false; } return; }
    if (!this.spawned.has(id)) return;
    this.spawned.delete(id); this.game.removeNPC(id);
  }
  // Retira a los PNJ de escena creados por el director que ya no hacen falta (los de la banda los gestiona syncCamp).
  pruneSpawned() {
    for (const id of [...this.spawned.keys()]) if (!CAMP_MEMBERS.includes(id) && !this.companions.some((c) => c.id === id)) this.removeNPC(id);
  }
  // Los PNJ "fijados" (movidos a una escena concreta) no vuelven al campamento hasta que termina la misión.
  unpinAll() { for (const n of this.game.npcs) n.pinned = false; }
  // Coloca al PNJ de la historia en un punto (moviéndolo si ya existe).
  placeNPC(id, x, z, faceX, faceZ) {
    const n = this.npc(id); if (!n) return;
    n.moveTo(x, z, faceX, faceZ);
  }

  /* ------------------------------ Campamento ------------------------------ */
  // Aplica el sitio de campamento (muda el mundo) y reparte a los miembros presentes alrededor de la fogata.
  // present: Set de ids de la banda que deben estar en el campamento.
  syncCamp(siteId, present) {
    const w = this.game.world;
    if (siteId && siteId !== this.siteId) { w.setCampSite(siteId); this.siteId = siteId; }
    const fire = w.firePos;
    for (const id of CAMP_MEMBERS) {
      const want = !!present && present.has(id);
      if (id === this.game.campaign?.protagonist) { this.removeNPC(id); continue; }
      let n = this.npc(id);
      if (want) {
        const sp = SPOTS[id], x = fire.x + sp[0], z = fire.z + sp[1];
        if (!n) { n = this.game.addNPC({ id, palette: paletteFor(id), interaction: 'dialogue', x, z, faceX: fire.x, faceZ: fire.z, lite: true, viewDist: 150 }); this.spawned.set(id, n); }
        else { n.setActive(true); if (!n.pinned && !n.follow && distXZ(n.position, { x, z }) > 3) n.moveTo(x, z, fire.x, fire.z); }
      } else if (n && !n.pinned && !n.follow) this.removeNPC(id);
    }
  }

  /* ------------------------------ Enemigos ------------------------------ */
  // n pistoleros en un anillo (minR..maxR) alrededor de (cx, cz). mode: 'ambush' (atacan ya) | 'guard' (vigilan, miran al centro).
  spawnGunmen(n, cx, cz, { tag = 'story', minR = 14, maxR = 26, mode = 'ambush', names = null, hp = 0, peaceful = false } = {}) {
    const g = this.game, out = [], pl = g.player.position;
    for (let i = 0; i < n; i++) {
      let x, z, tries = 0;
      do { const a = Math.random() * 6.283, r = minR + Math.random() * (maxR - minR); x = cx + Math.sin(a) * r; z = cz + Math.cos(a) * r; tries++; }
      while (tries < 8 && (g.world.isBlocked(x, z, 0.6) || Math.hypot(x - pl.x, z - pl.z) < 8));
      const nm = names && names[i] ? names[i] : NAMES[(this._n++) % NAMES.length];
      // peaceful = figurantes de una escena (topógrafos, detectives, vaqueros): agentes de "ley" en paz que nunca atacan ni detectan.
      const man = g.bandits.addGunman({ id: `${tag}_${this._n}`, name: nm, faction: peaceful ? 'law' : 'bandit', role: peaceful ? 'deputy' : 'bandit', palette: peaceful ? ['deputy', 'townA', 'townB'][i % 3] : PALS[i % 3], x, z, camp: tag, look: { x: cx, z: cz }, spot: { x, z }, hp: hp || undefined });
      man.storyTag = tag; man.active = true;
      if (mode === 'ambush' && !peaceful) man.alertTo(pl, 0.2 + i * 0.28);
      out.push(man);
    }
    return out;
  }
  // Retira a los pistoleros de una escena (tras `delay` ms, para que los cuerpos se vean un rato). La lista original se vacía al instante.
  despawnGunmen(list, delay = 0) {
    const items = list.slice(); list.length = 0;
    const run = () => items.forEach((m) => this.game.bandits.removeGunman(m));
    if (delay > 0) setTimeout(run, delay); else run();
  }

  /* ------------------------------ Acompañantes ------------------------------ */
  // Escoltas / aliados: PNJ que siguen al jugador. Si ya están en el campamento, se "sacan" de él mientras dure la tarea.
  setCompanions(ids) {
    this.clearCompanions();
    const g = this.game, pl = g.player.position, h = g.player.heading;
    ids.forEach((id, i) => {
      if (!g.story.npcs[id] || id === g.campaign?.protagonist) return;
      let n = this.npc(id), created = false;
      const x = pl.x - Math.sin(h) * (4 + i) + Math.cos(h) * (i % 2 ? 2 : -2), z = pl.z - Math.cos(h) * (4 + i);
      if (!n) { n = g.addNPC({ id, palette: paletteFor(id), interaction: 'dialogue', x, z, faceX: pl.x, faceZ: pl.z, lite: true, viewDist: 160 }); created = true; this.spawned.set(id, n); } else { n.setActive(true); n.moveTo(x, z, pl.x, pl.z); }
      n.setFollow(true); n.index = i; n.escort = true; n.pinned = true;
      this.companions.push({ id, npc: n, created });
    });
  }
  clearCompanions() {
    for (const c of this.companions) { c.npc.setFollow(false); c.npc.escort = false; c.npc.pinned = false; if (c.created && !CAMP_MEMBERS.includes(c.id)) this.removeNPC(c.id); }
    this.companions.length = 0;
    this.game.campaign && this.game.campaign.refreshWorld();
  }

  /* ------------------------------ Baliza y radar ------------------------------ */
  // pts: [{ x, z, kind }] — el primero lleva la baliza luminosa.
  setWaypoints(pts) { this.waypoints = pts || []; }
  update(dt) {
    const p = this.game.player.position, w = this.waypoints[0];
    if (!w) { this.beacon.visible = false; return; }
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    this.beacon.visible = d > 18 && d < 900 && this.game.mode !== 'dialogue' && this.game.mode !== 'duel';
    if (this.beacon.visible) {
      this.beacon.position.set(w.x, this.game.world.getHeightAt(w.x, w.z), w.z);
      this.beacon.material.opacity = 0.14 + Math.min(0.2, d / 2000) + Math.sin(this.game.elapsed * 2.2) * 0.04;
    }
  }
  clearAll() {
    this.clearCompanions(); this.waypoints = []; this.beacon.visible = false;
  }
}

export { StoryDirector, CAMP_MEMBERS, HOME };
