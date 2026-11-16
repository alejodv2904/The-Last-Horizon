// Menús: pantalla de inicio (3 ranuras, importar, calidad) y menú de pausa [Esc] (volúmenes independientes de Música / Efectos /
// Ambiente, calidad gráfica, ranuras con guardar/exportar/importar). Se genera con DOM para no hinchar index.html.
import { QUALITY } from '../core/Settings.js';

const QUALITY_NOTES = {
  low: 'Sin sombras, vegetación mínima, niebla cercana y resolución reducida. Para equipos modestos.',
  medium: 'Sombras 1024, vegetación media y resolución adaptativa. Equilibrio recomendado.',
  high: 'Sombras 2048, vegetación completa y la mejor resolución. Necesita una GPU decente.',
};
const fmtDate = (t) => (t ? new Date(t).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '');
const fmtTime = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };

class MenuManager {
  constructor(game) {
    this.game = game; this.settings = game.settings; this.$ = (id) => document.getElementById(id);
    this._importSlot = 1;
    this._buildQuality('start-quality'); this._buildQuality('pause-quality');
    this._bindSliders(); this._bindFile();
    this.$('opt-fps').checked = !!this.settings.get('showFps');
    this.$('opt-fps').addEventListener('change', (e) => { this.settings.set('showFps', e.target.checked); this.game.ui.el.fps.style.display = e.target.checked ? '' : 'none'; });
    this.game.ui.el.fps.style.display = this.settings.get('showFps') ? '' : 'none';
    this.$('btn-import').addEventListener('click', () => this._pickFile(this.game.save.slot));
    this.$('btn-import-2').addEventListener('click', () => this._pickFile(this.game.save.slot));
    this.$('btn-resume').addEventListener('click', () => this.game.input.requestLock());
    // Táctil: viaje rápido al campamento desde la pausa (equivale a la tecla B).
    this.$('btn-fasttravel').addEventListener('click', () => { this.game.input.requestLock(); setTimeout(() => this.game.campaign.fastTravelCamp(), 150); });
    // El clic en el fondo del menú de pausa reanuda; los clics dentro del panel no.
    // Se ignora el «clic» fantasma que el navegador genera al soltar el dedo del botón de pausa táctil (caería aquí y reanudaría al instante).
    this.$('overlay-pause').addEventListener('click', (e) => { if (!e.target.closest('#pause-panel') && !e.target.closest('.btn-row') && performance.now() - this.game._pausedAt > 500) this.game.input.requestLock(); });
    ['start-slots', 'pause-slots'].forEach((id) => this.$(id).addEventListener('click', (e) => this._slotClick(e)));
    this.refreshSlots();
  }

  /* ---------- Calidad gráfica ---------- */
  _buildQuality(id) {
    const box = this.$(id); box.innerHTML = '';
    Object.values(QUALITY).forEach((q) => {
      const b = document.createElement('button'); b.textContent = q.label; b.dataset.q = q.id;
      b.addEventListener('click', () => { this.game.applyQuality(q.id); this._syncQuality(); });
      box.appendChild(b);
    });
    this._syncQuality();
  }
  _syncQuality() {
    const cur = this.settings.get('quality');
    ['start-quality', 'pause-quality'].forEach((id) => this.$(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.q === cur)));
    this.$('quality-note').textContent = QUALITY_NOTES[cur];
  }

  /* ---------- Volúmenes ---------- */
  _bindSliders() {
    ['music', 'sfx', 'ambient'].forEach((k) => {
      const input = this.$(`vol-${k}`), out = this.$(`out-${k}`), v = Math.round(this.settings.get(k) * 100);
      input.value = v; out.textContent = `${v}%`;
      input.addEventListener('input', () => {
        const val = Number(input.value) / 100; out.textContent = `${input.value}%`;
        this.settings.set(k, val); this.game.audio.setVolume(k, val);
        if (k === 'sfx') this.game.audio.playUI(); if (k === 'music') this.game.audio.init();
      });
    });
  }

  /* ---------- Ranuras ---------- */
  _slotHTML(info, ctx) {
    const cur = info.slot === this.game.save.slot;
    const body = info.empty
      ? '<div class="si"><div class="sh">RANURA ' + info.slot + '</div><div class="sd">Vacía</div></div>'
      : `<div class="si"><div class="sh">RANURA ${info.slot}${cur ? ' · activa' : ''}</div><div class="sd">${info.chapter}<br>Misión: ${info.mission}<br>$${Number(info.money).toFixed(2)} · Honor: ${info.honorTier} (${info.honorValue > 0 ? '+' : ''}${info.honorValue}) · ${info.percent}% · ${fmtTime(info.playTime)}<br><small>${fmtDate(info.savedAt)}</small></div></div>`;
    const btn = (act, label, cls = '', off = false) => `<button class="mbtn ${cls}" data-act="${act}" data-slot="${info.slot}" ${off ? 'disabled' : ''}>${label}</button>`;
    let btns;
    if (ctx === 'start') btns = (info.empty ? btn('new', 'Nueva partida') : btn('play', 'Continuar') + btn('new', 'Nueva', 'danger')) + btn('export', 'Exportar', '', info.empty) + btn('delete', 'Borrar', 'danger', info.empty) + btn('import', 'Importar');
    else btns = btn('save', 'Guardar aquí') + btn('select', 'Cargar…', '', info.empty) + btn('export', 'Exportar', '', info.empty) + btn('delete', 'Borrar', 'danger', info.empty);
    return `<div class="slot${cur ? ' current' : ''}" data-slot="${info.slot}">${body}<div class="sb">${btns}</div></div>`;
  }
  refreshSlots() {
    const info = this.game.save.slotsInfo();
    this.$('start-slots').innerHTML = info.map((i) => this._slotHTML(i, 'start')).join('');
    this.$('pause-slots').innerHTML = info.map((i) => this._slotHTML(i, 'pause')).join('');
    const has = info.some((i) => !i.empty);
    this.$('loading-note').textContent = has ? 'Elige una ranura para continuar. «Nueva» sobrescribe esa ranura.' : 'Recomendado: Chrome o Edge. El juego ajusta la resolución automáticamente para mantener 60 FPS.';
  }
  _slotClick(e) {
    const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
    const n = Number(b.dataset.slot), g = this.game, save = g.save;
    switch (b.dataset.act) {
      case 'play': save.slot = n; g.start(true); break;
      case 'new':
        if (save.hasSave(n) && !confirm(`La ranura ${n} ya tiene una partida. ¿Sobrescribirla con una nueva?`)) break;
        save.clear(n); save.slot = n; g.start(false); break;
      case 'save': save.slot = n; if (save.save(n)) g.ui.notify('Partida guardada', `Ranura ${n}`); this.refreshSlots(); break;
      case 'select':   // cargar otra ranura en mitad de la partida = recargar la página con esa ranura activa (estado limpio garantizado)
        save.save(); save.slot = n; location.reload(); break;
      case 'export': if (!save.exportSlot(n)) g.ui.notify('Exportar', 'Esa ranura está vacía.'); break;
      case 'delete': if (confirm(`¿Borrar la ranura ${n}? No se puede deshacer.`)) { save.clear(n); this.refreshSlots(); } break;
      case 'import': this._pickFile(n); break;
      default: break;
    }
  }

  /* ---------- Importar ---------- */
  _bindFile() {
    const f = this.$('file-import');
    f.addEventListener('change', () => {
      const file = f.files[0]; f.value = ''; if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        const res = this.game.save.importSlot(this._importSlot, String(rd.result));
        if (res.ok) { this.game.ui.notify('Partida importada', `Ranura ${this._importSlot}`); this.refreshSlots(); } else alert(res.error);
      };
      rd.onerror = () => alert('No se pudo leer el archivo.');
      rd.readAsText(file);
    });
  }
  _pickFile(slot) { this._importSlot = slot; this.$('file-import').click(); }
}

export { MenuManager };
