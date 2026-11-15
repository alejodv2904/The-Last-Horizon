// Mapa mundial (tecla M): pergamino dibujado en un <canvas> 2D, con niebla de exploración.
//  - El terreno explorado vive en una rejilla de 100×100 celdas (20 m) pintada en un canvas de 100×100 px; al abrir el mapa se
//    escala con suavizado (acuarela). Cada celda se pinta UNA vez, al descubrirla, y solo cuando el jugador se mueve (cada 0,5 s).
//  - El pergamino (papel, manchas, bordes) se pre-renderiza una sola vez en otro canvas.
//  - Con la Tienda Mejorada del campamento, hacer clic en un lugar descubierto realiza un viaje rápido.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { clamp, smoothstep, distXZ } from '../core/MathUtils.js';

const CELL = CONFIG.MAP.CELL, HALF = CONFIG.WORLD_HALF, N = Math.round((2 * HALF) / CELL), S = 760, MARGIN = 44, K = (S - 2 * MARGIN) / (2 * HALF);
const px = (x) => MARGIN + (x + HALF) * K, py = (z) => MARGIN + (z + HALF) * K;

class MapSystem {
  constructor(game) {
    this.game = game; this.known = new Uint8Array(N * N); this.count = 0; this.timer = 0; this.hover = null; this.queue = [];
    this.terrain = document.createElement('canvas'); this.terrain.width = this.terrain.height = N;
    this.tctx = this.terrain.getContext('2d'); this.img = this.tctx.createImageData(N, N); this.dirty = false;
    this.root = document.getElementById('worldmap'); this.canvas = document.getElementById('map-canvas'); this.ctx = this.canvas.getContext('2d');
    this.hint = document.getElementById('map-hint'); this.isOpen = false;
    this.paper = this._makePaper();
    const w = game.world, town = w.town, post = w.post;
    const ahead = (a, b, d) => { const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return { x: a.x + dx / l * d, z: a.z + dz / l * d }; };
    const tp = ahead(post.traderPos, post.traderFace, 3.5);
    this.pois = [
      { id: 'camp', name: 'Cedar Hollow · campamento', kind: 'camp', x: CONFIG.CAMP.x, z: CONFIG.CAMP.z, travel: { x: CONFIG.PLAYER_SPAWN.x, z: CONFIG.PLAYER_SPAWN.z + 2 }, discovered: true },
      { id: 'town', name: 'Redwood Gulch', kind: 'town', x: town.center.x, z: town.center.z, travel: town.local(-25, 1.5), discovered: false },
      { id: 'post', name: 'Puesto de Jonás Pike', kind: 'post', x: CONFIG.TRADING_POST.x, z: CONFIG.TRADING_POST.z, travel: tp, discovered: false },
      ...w.banditCamps.map((c) => ({ id: c.def.id, name: `Campamento bandido · ${c.def.name}`, kind: 'banditCamp', x: c.center.x, z: c.center.z, travel: null, discovered: false })),
    ];
    this.board = { x: town.board.pos.x, z: town.board.pos.z };
    this.canvas.addEventListener('mousemove', (e) => { this.hover = this._hit(e); });
    this.canvas.addEventListener('click', (e) => { const p = this._hit(e); if (p) this._click(p); });
    this.discover(game.player.position, true);
  }

  /* ---------------- descubrimiento ---------------- */
  _paint(ix, iz) {
    const g = this.game.world.gen, x = -HALF + (ix + 0.5) * CELL, z = -HALF + (iz + 0.5) * CELL;
    const h = g.getHeightAt(x, z), hE = g.getHeightAt(x + CELL, z), hW = g.getHeightAt(x - CELL, z), hS = g.getHeightAt(x, z + CELL), hN = g.getHeightAt(x, z - CELL);
    const shade = clamp(0.64 + ((hW - hE) + (hN - hS)) * 0.02, 0.28, 0.96);
    const hn = clamp((h + 6) / 60, 0, 1), forest = g.forestWeight(x, z);
    let r = 218 - hn * 52, gr = 190 - hn * 62, b = 138 - hn * 52;
    r = r * (1 - forest * 0.35) + 118 * forest * 0.35; gr = gr * (1 - forest * 0.3) + 126 * forest * 0.3; b = b * (1 - forest * 0.3) + 74 * forest * 0.3;
    if (h > 34) { const t = smoothstep(34, 60, h); r = r * (1 - t) + 150 * t; gr = gr * (1 - t) + 136 * t; b = b * (1 - t) + 118 * t; }
    if (g.creekDepth(x, z) > 0.9) { r = 112; gr = 146; b = 158; }
    const B = g.canyonBox;
    if (x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1 && g.canyonSample(x, z).d < 16 && g.canyonSample(x, z).u > 60) { r = 118; gr = 88; b = 62; }
    const o = (iz * N + ix) * 4, d = this.img.data;
    d[o] = r * shade; d[o + 1] = gr * shade; d[o + 2] = b * shade; d[o + 3] = 238;
  }
  discover(pos, instant = false) {
    const R = CONFIG.MAP.REVEAL_RADIUS, c = Math.ceil(R / CELL), cx = Math.floor((pos.x + HALF) / CELL), cz = Math.floor((pos.z + HALF) / CELL);
    for (let iz = Math.max(0, cz - c); iz <= Math.min(N - 1, cz + c); iz++) for (let ix = Math.max(0, cx - c); ix <= Math.min(N - 1, cx + c); ix++) {
      const i = iz * N + ix; if (this.known[i]) continue;
      const dx = -HALF + (ix + 0.5) * CELL - pos.x, dz = -HALF + (iz + 0.5) * CELL - pos.z;
      if (dx * dx + dz * dz > R * R) continue;
      this.known[i] = 1; this.count++; this._paint(ix, iz); this.dirty = true;
    }
    for (const p of this.pois) if (!p.discovered && distXZ(p, pos) < 110) { p.discovered = true; if (!instant) this.game.ui.notify('Lugar descubierto', p.name); }
  }
  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.5; this.discover(this.game.player.position); }
    // repintado diferido tras cargar una partida (400 celdas por frame)
    for (let k = 0; k < 400 && this.queue.length; k++) { const i = this.queue.pop(); this._paint(i % N, (i / N) | 0); this.dirty = true; }
    if (this.dirty) { this.tctx.putImageData(this.img, 0, 0); this.dirty = false; }
  }

  /* ---------------- abrir / cerrar / viaje ---------------- */
  open() {
    const g = this.game;
    this.isOpen = true; g.setMode('map'); g.input.exitLock(); this.root.classList.remove('hidden'); g.audio.playUI();
    this.hint.textContent = g.camp.fastTravel ? 'Clic en un lugar descubierto para viajar rápido · [M] / [Esc] cerrar' : 'Viaje rápido bloqueado: compra la Tienda Mejorada en el Libro de Contabilidad del campamento · [M] / [Esc] cerrar';
    this.render();
  }
  close() {
    if (!this.isOpen) return;
    const g = this.game; this.isOpen = false; this.root.classList.add('hidden'); g.setMode('explore'); g.input.requestLock();
  }
  _hit(e) {
    const r = this.canvas.getBoundingClientRect(), mx = (e.clientX - r.left) * (S / r.width), my = (e.clientY - r.top) * (S / r.height);
    let best = null, bd = 20;
    for (const p of this.pois) { if (!p.discovered) continue; const d = Math.hypot(px(p.x) - mx, py(p.z) - my); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  _click(p) {
    const g = this.game;
    if (!p.travel) { g.ui.notify(p.name, 'No hay camino seguro hasta allí: lo tuyo es ir con cuidado.'); return; }
    if (!g.camp.fastTravel) { g.ui.notify('Viaje rápido bloqueado', 'Compra la Tienda Mejorada en el Libro de Contabilidad.'); return; }
    if (g.bandits.hostileNear(g.player.position, 110)) { g.ui.notify('No puedes viajar ahora', 'Hay enemigos cerca.'); return; }
    if (distXZ(g.player.position, p.travel) < 30) { g.ui.notify('Ya estás aquí', p.name); return; }
    this.close(); g.fastTravel(p);
  }

  /* ---------------- dibujo ---------------- */
  _makePaper() {
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, S, S); bg.addColorStop(0, '#ead8aa'); bg.addColorStop(0.5, '#dcc690'); bg.addColorStop(1, '#c9ad76');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${90 + Math.random() * 40},${60 + Math.random() * 30},30,${Math.random() * 0.07})`; g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 1 + Math.random() * 3); }
    for (let i = 0; i < 16; i++) { const x = Math.random() * S, y = Math.random() * S, r = 30 + Math.random() * 80, st = g.createRadialGradient(x, y, 0, x, y, r); st.addColorStop(0, 'rgba(120,80,30,0.10)'); st.addColorStop(1, 'rgba(120,80,30,0)'); g.fillStyle = st; g.fillRect(x - r, y - r, r * 2, r * 2); }
    const ed = g.createRadialGradient(S / 2, S / 2, S * 0.38, S / 2, S / 2, S * 0.72); ed.addColorStop(0, 'rgba(60,30,8,0)'); ed.addColorStop(1, 'rgba(60,30,8,0.55)');
    g.fillStyle = ed; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(70,40,15,.75)'; g.lineWidth = 3; g.strokeRect(MARGIN - 8, MARGIN - 8, S - 2 * MARGIN + 16, S - 2 * MARGIN + 16);
    g.lineWidth = 1; g.strokeRect(MARGIN - 14, MARGIN - 14, S - 2 * MARGIN + 28, S - 2 * MARGIN + 28);
    return c;
  }
  _icon(ctx, kind, x, y) {
    ctx.save(); ctx.translate(x, y); ctx.lineWidth = 1.6; ctx.strokeStyle = '#2b1a0c'; ctx.fillStyle = '#7a1f14';
    if (kind === 'camp') { ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(10, 7); ctx.lineTo(-10, 7); ctx.closePath(); ctx.fillStyle = '#e8d8a8'; ctx.fill(); ctx.stroke(); ctx.fillStyle = '#2b1a0c'; ctx.fillRect(-2, 1, 4, 6); }
    else if (kind === 'town') { ctx.beginPath(); ctx.moveTo(-10, 8); ctx.lineTo(-10, -2); ctx.lineTo(0, -10); ctx.lineTo(10, -2); ctx.lineTo(10, 8); ctx.closePath(); ctx.fillStyle = '#d8a850'; ctx.fill(); ctx.stroke(); ctx.fillStyle = '#2b1a0c'; ctx.fillRect(-2, 1, 4, 7); }
    else if (kind === 'post') { ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.3); ctx.fillStyle = '#9fb88a'; ctx.fill(); ctx.stroke(); ctx.fillStyle = '#1a1209'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 1); }
    else if (kind === 'banditCamp') { ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(9, 7); ctx.lineTo(-9, 7); ctx.closePath(); ctx.fillStyle = '#9a2a1c'; ctx.fill(); ctx.stroke(); ctx.fillStyle = '#f0e8d0'; ctx.font = 'bold 9px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('☠', 0, 2); }
    else if (kind === 'board') { ctx.fillStyle = '#e8d8a8'; ctx.fillRect(-6, -6, 12, 12); ctx.strokeRect(-6, -6, 12, 12); ctx.fillStyle = '#7a1810'; ctx.font = 'bold 9px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 1); }
    else if (kind === 'treasure') { ctx.strokeStyle = '#8a1a10'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.moveTo(7, -7); ctx.lineTo(-7, 7); ctx.stroke(); }
    ctx.restore();
  }
  render() {
    const g = this.game, ctx = this.ctx, w = g.world, pp = g.player.position;
    ctx.clearRect(0, 0, S, S); ctx.drawImage(this.paper, 0, 0);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.terrain, MARGIN, MARGIN, S - 2 * MARGIN, S - 2 * MARGIN); ctx.restore();
    // caminos (solo los tramos ya vistos) y arroyo
    const known = (x, z) => { const ix = Math.floor((x + HALF) / CELL), iz = Math.floor((z + HALF) / CELL); return ix >= 0 && iz >= 0 && ix < N && iz < N && this.known[iz * N + ix]; };
    ctx.save(); ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2.4; ctx.setLineDash([7, 4]);
    for (const road of [CONFIG.ROAD, CONFIG.ROAD_TOWN]) {
      ctx.beginPath(); let pen = false;
      for (let i = 0; i < road.length - 1; i++) {
        const [ax, az] = road[i], [bx, bz] = road[i + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / 12));
        for (let k = 0; k <= n; k++) { const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n, kn = known(x, z); if (kn) { if (pen) ctx.lineTo(px(x), py(z)); else ctx.moveTo(px(x), py(z)); pen = true; } else pen = false; }
      }
      ctx.stroke();
    }
    ctx.restore();
    // elementos
    const board = this.pois[1].discovered; if (board) this._icon(ctx, 'board', px(this.board.x) + 14, py(this.board.z) - 12);
    for (const p of this.pois) if (p.discovered) this._icon(ctx, p.kind, px(p.x), py(p.z));
    for (const t of g.treasure.items) if (t.revealed && !t.collected) this._icon(ctx, 'treasure', px(t.x), py(t.z));
    const ev = g.encounters.radarPos; if (ev) { ctx.fillStyle = '#e0a020'; ctx.strokeStyle = '#2b1a0c'; ctx.beginPath(); ctx.arc(px(ev.x), py(ev.z), 6, 0, 6.3); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#2b1a0c'; ctx.font = 'bold 10px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', px(ev.x), py(ev.z) + 0.5); }
    // etiquetas
    ctx.font = 'italic 15px Georgia'; ctx.textAlign = 'center'; ctx.fillStyle = '#2b1a0c';
    for (const p of this.pois) if (p.discovered && p.kind !== 'banditCamp') ctx.fillText(p.name, px(p.x), py(p.z) + 26);
    if (this.hover) {
      const p = this.hover, tx = px(p.x), ty = py(p.z);
      ctx.strokeStyle = '#7a1f14'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, 17, 0, 6.3); ctx.stroke();
      ctx.font = 'bold 14px Georgia'; const label = p.travel ? (g.camp.fastTravel ? `Viajar a ${p.name}` : `${p.name} (viaje bloqueado)`) : p.name, tw = ctx.measureText(label).width + 16;
      const bx = clamp(tx - tw / 2, 6, S - tw - 6), by = Math.max(6, ty - 46);
      ctx.fillStyle = 'rgba(30,18,8,.88)'; ctx.fillRect(bx, by, tw, 24); ctx.fillStyle = '#f0e2b8'; ctx.textAlign = 'left'; ctx.fillText(label, bx + 8, by + 17);
    }
    // jugador: flecha orientada
    ctx.save(); ctx.translate(px(pp.x), py(pp.z)); ctx.rotate(Math.PI - g.player.heading);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2b1a0c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    // rosa de los vientos, título y estado
    ctx.save(); ctx.translate(S - 92, S - 92); ctx.strokeStyle = '#3a2410'; ctx.fillStyle = '#3a2410'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, 6.3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(6, 0); ctx.lineTo(0, 38); ctx.lineTo(-6, 0); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-38, 0); ctx.lineTo(0, 5); ctx.lineTo(38, 0); ctx.lineTo(0, -5); ctx.closePath(); ctx.stroke();
    ctx.font = 'bold 14px Georgia'; ctx.textAlign = 'center'; ctx.fillText('N', 0, -44); ctx.restore();
    ctx.font = '26px Rye, Georgia, serif'; ctx.fillStyle = '#3a2410'; ctx.textAlign = 'left'; ctx.fillText('Valle de Cedar Hollow', MARGIN + 6, MARGIN - 14 + 2);
    ctx.font = 'italic 14px Georgia'; ctx.textAlign = 'right'; ctx.fillText(`Explorado ${Math.round(this.count / (N * N) * 100)} % · ${g.world.weather.state.name}`, S - MARGIN - 6, MARGIN - 14 + 2);
  }
  frame() { if (this.isOpen) this.render(); }

  /* ---------------- guardado ---------------- */
  toJSON() {
    const bytes = new Uint8Array(Math.ceil(this.known.length / 8));
    for (let i = 0; i < this.known.length; i++) if (this.known[i]) bytes[i >> 3] |= 1 << (i & 7);
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return { known: btoa(s), pois: this.pois.filter((p) => p.discovered).map((p) => p.id) };
  }
  fromJSON(d) {
    if (!d || !d.known) return;
    try {
      const s = atob(d.known); this.known.fill(0); this.count = 0; this.queue.length = 0;
      for (let i = 0; i < this.known.length; i++) if ((s.charCodeAt(i >> 3) >> (i & 7)) & 1) { this.known[i] = 1; this.count++; this.queue.push(i); }
      this.pois.forEach((p) => { if (p.id === 'camp' || (d.pois || []).includes(p.id)) p.discovered = true; });
    } catch (e) { /* mapa corrupto: se vuelve a descubrir */ }
  }
}

export { MapSystem };
