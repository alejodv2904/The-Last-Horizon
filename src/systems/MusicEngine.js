// Banda sonora Western procedural y dinámica (cero archivos de audio: todo se sintetiza con Web Audio).
//
// Capas:  GUITARRA (acordes graves + arpegios, sintetizada con osciladores filtrados)
//         ARMÓNICA / SILBIDO (melodía con vibrato y soplido)
//         PAD / BAJO (drone persistente con glissando entre acordes)
//         PERCUSIÓN (bombo, toms, caja, escobillas y latido; tensa)
//
// Estados:  calm (exploración tranquila) · stealth (sigilo) · combat (tiroteo) · duel (duelo) · emotional (escenas emotivas)
//
// El secuenciador usa el reloj del AudioContext con "lookahead" (sin setInterval): programa notas ~0.4 s por delante.
// Los cambios de estado se aplican en el siguiente pulso, así la música cambia a tempo sin cortes bruscos.
// Las capas activas dependen de la calidad gráfica (menos capas = menos nodos de audio en equipos modestos).
import { clamp } from '../core/MathUtils.js';

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CH = {   // acordes (MIDI): fundamental, quinta, octava, tercera, quinta, ...
  Em: [40, 47, 52, 55, 59, 64], C: [36, 43, 48, 52, 55, 60], D: [38, 45, 50, 54, 57, 62], Am: [45, 52, 57, 60, 64, 69],
  G: [43, 50, 55, 59, 62, 67], F: [41, 48, 53, 57, 60, 65], B7: [47, 51, 54, 57, 59, 63],
};

// Melodías por compás: [paso(0-15), nota MIDI, duración en pasos]
const MEL = {
  calm: [[[2, 71, 5], [8, 69, 3], [12, 67, 4]], [[0, 64, 8], [10, 67, 3]], [[0, 66, 4], [6, 69, 4], [12, 74, 4]], [[0, 71, 12]]],
  emotional: [[[0, 76, 8], [8, 74, 4], [12, 71, 4]], [[0, 72, 8], [8, 71, 4], [12, 67, 4]], [[0, 71, 6], [6, 74, 6], [12, 71, 4]], [[0, 69, 8], [8, 66, 4], [12, 64, 4]]],
  combat: [[[0, 64, 2], [3, 67, 1], [4, 71, 2], [8, 64, 2], [11, 67, 1], [12, 69, 2]], [[0, 64, 2], [3, 67, 1], [4, 71, 2], [8, 72, 2], [12, 71, 2]],
    [[0, 67, 2], [3, 64, 1], [4, 72, 2], [8, 67, 2], [12, 71, 2]], [[0, 66, 2], [3, 69, 1], [4, 74, 2], [8, 69, 2], [12, 66, 3]]],
  duel: [[[0, 76, 12]], [[0, 74, 6], [8, 71, 6]], [[0, 69, 8], [8, 72, 6]], [[0, 71, 16]]],
  stealth: [[], [[6, 65, 6]], [], [[4, 64, 8]]],
};

const STATES = {
  calm: { bpm: 76, prog: ['Em', 'C', 'D', 'Em'], guitar: 'arp', perc: 'soft', mel: 'harmonica', gains: { guitar: 0.5, pad: 0.35, perc: 0.3, mel: 0.5 }, padCut: 700 },
  stealth: { bpm: 60, prog: ['Em', 'Em', 'F', 'Em'], guitar: 'harm', perc: 'heart2', mel: 'harmonica', gains: { guitar: 0.32, pad: 0.6, perc: 0.5, mel: 0.12 }, padCut: 420 },
  combat: { bpm: 138, prog: ['Em', 'Em', 'C', 'D'], guitar: 'chug', perc: 'drive', mel: 'harmonica', gains: { guitar: 0.7, pad: 0.35, perc: 0.9, mel: 0.55 }, padCut: 1100 },
  duel: { bpm: 66, prog: ['Em', 'Em', 'Am', 'B7'], guitar: 'twang', perc: 'heart', mel: 'whistle', gains: { guitar: 0.55, pad: 0.45, perc: 0.6, mel: 0.6 }, padCut: 560 },
  emotional: { bpm: 58, prog: ['Em', 'C', 'G', 'D'], guitar: 'finger', perc: 'none', mel: 'harmonica', gains: { guitar: 0.5, pad: 0.55, perc: 0, mel: 0.65 }, padCut: 800 },
};
const LAYER_ORDER = ['guitar', 'pad', 'perc', 'mel'];   // prioridad cuando la calidad limita el número de capas

class MusicEngine {
  constructor(audio) {
    this.a = audio; this.ctx = audio.ctx; this.state = 'calm'; this.pending = null; this.next = 0; this.step = 0; this.bar = 0;
    this.layers = 4; this.running = false; this.intensity = 0.5; this.slowmo = false; this.silent = false;
    const ctx = this.ctx, mk = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    this.bus = { guitar: mk(), pad: mk(), perc: mk(), mel: mk() };
    this.bus.guitar.connect(audio.musicBus); this.bus.pad.connect(audio.musicBus); this.bus.perc.connect(audio.musicBus); this.bus.mel.connect(audio.musicBus);
    this.revSend = mk(0.5); this.revSend.connect(audio.reverbMusic);
    this.bus.guitar.connect(this.revSend); this.bus.mel.connect(this.revSend);
    this._buildPad();
  }

  /* ---------------- Pad persistente: 3 sierras desafinadas + sub, con glissando entre acordes ---------------- */
  _buildPad() {
    const ctx = this.ctx;
    this.padLP = this.a._filter('lowpass', 700, 0.7);
    this.padLP.connect(this.bus.pad);
    this.padVoices = [];
    [-9, 0, 8].forEach((det) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; o.frequency.value = 110;
      const g = this.a._gain(0.12); o.connect(g); g.connect(this.padLP); o.start(); this.padVoices.push(o);
    });
    this.sub = ctx.createOscillator(); this.sub.type = 'sine'; this.sub.frequency.value = 55;
    const sg = this.a._gain(0.5); this.sub.connect(sg); sg.connect(this.bus.pad); this.sub.start();
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 0.09; const lg = this.a._gain(180); this.lfo.connect(lg); lg.connect(this.padLP.frequency); this.lfo.start();
  }
  _setPadChord(chord, t, cut) {
    const m = [chord[2], chord[3], chord[4]];
    this.padVoices.forEach((o, i) => o.frequency.setTargetAtTime(mtof(m[i]), t, 0.35));
    this.sub.frequency.setTargetAtTime(mtof(chord[0]), t, 0.25);
    this.padLP.frequency.setTargetAtTime(cut, t, 0.8);
  }

  /* ---------------- Estado y capas ---------------- */
  setState(name) { if (STATES[name] && (name !== this.state || this.pending)) this.pending = name === this.state ? null : name; }
  setLayers(n) { this.layers = n; this._applyGains(); }
  setIntensity(v) { this.intensity = clamp(v, 0, 1); }
  setSlowmo(on) { this.slowmo = on; }
  setSilent(on) { this.silent = on; this._applyGains(); }
  _layerOn(name) { return LAYER_ORDER.indexOf(name) < this.layers; }
  _applyGains() {
    const t = this.ctx.currentTime, s = STATES[this.state];
    for (const k of LAYER_ORDER) this.bus[k].gain.setTargetAtTime(this.silent || !this._layerOn(k) ? 0 : s.gains[k], t, 0.5);
  }
  start() {
    if (this.running) return;
    this.running = true; this.next = this.ctx.currentTime + 0.1; this.step = 0; this.bar = 0;
    this._enter(this.state, this.next);
  }
  _enter(name, t) {
    this.state = name; this.pending = null; this.bar = 0; this.step = 0; this._applyGains();
    const s = STATES[name]; this._setPadChord(CH[s.prog[0]], t, s.padCut);
  }
  stepDur() { return 60 / STATES[this.state].bpm / 4; }

  update() {
    if (!this.running || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.next < now - 0.4) this.next = now + 0.05;   // la pestaña estuvo en segundo plano: reenganchar
    let guard = 64;
    while (this.next < now + 0.4 && guard-- > 0) {
      if (this.pending && this.step % 4 === 0) this._enter(this.pending, this.next);
      this._scheduleStep(this.next, this.step);
      this.next += this.stepDur(); this.step++;
      if (this.step % 16 === 0) { this.bar++; const s = STATES[this.state]; this._setPadChord(CH[s.prog[this.bar % 4]], this.next, s.padCut); }
    }
  }

  _scheduleStep(t, step) {
    const s = STATES[this.state], i = step % 16, bar = this.bar % 4, chord = CH[s.prog[bar]], mul = this.slowmo ? 0.6 : 1;
    if (this._layerOn('guitar') && s.gains.guitar > 0.02) this._guitar(s.guitar, t, i, chord, mul);
    if (this._layerOn('perc') && s.gains.perc > 0.02) this._perc(s.perc, t, i, bar, mul);
    if (this._layerOn('mel') && s.gains.mel > 0.02 && !this.silent) {
      const phrase = MEL[this.state === 'stealth' ? 'stealth' : this.state][bar];
      for (const [st, note, dur] of phrase) if (st === i) this._melody(s.mel, t, note, dur * this.stepDur());
    }
  }

  /* ---------------- Guitarra ---------------- */
  _guitar(style, t, i, chord, mul) {
    switch (style) {
      case 'arp':
        if (i === 0) this._strum(t, [chord[0], chord[1], chord[2], chord[3]], 0.16 * mul, 0.03, 1.6, 2600);
        else if ([4, 6, 8, 10, 12, 14].includes(i)) { const idx = { 4: 3, 6: 4, 8: 5, 10: 4, 12: 3, 14: 2 }[i]; this._pluck(t, chord[idx], 0.08 * mul, 1.1, 2200); }
        break;
      case 'finger':
        if ([0, 3, 6, 8, 11, 14].includes(i)) { const idx = { 0: 0, 3: 2, 6: 3, 8: 4, 11: 3, 14: 2 }[i]; this._pluck(t, chord[idx] + (idx === 0 ? 0 : 0), i === 0 ? 0.13 * mul : 0.07 * mul, 1.8, 1900); }
        break;
      case 'harm':
        if (i === 0 || i === 8) { if (Math.random() < 0.7) this._pluck(t, chord[2] + 24, 0.05 * mul, 2.4, 3800); }
        if (i === 0) this._pluck(t, chord[0], 0.1 * mul, 2.0, 700);
        break;
      case 'chug':
        if (i % 2 === 0) { const acc = [0, 6, 10].includes(i) ? 1 : 0.62; this._chord(t, [chord[0], chord[1], chord[2]], 0.17 * acc * mul, 0.11, 950 + acc * 700); }
        break;
      case 'twang':
        if (i === 0) this._pluck(t, chord[0], 0.14 * mul, 2.6, 900);
        else if (i === 8) this._pluck(t, chord[2] + 12, 0.1 * mul, 3.2, 3400, true);
        else if (i === 12 && Math.random() < 0.6) this._pluck(t, chord[3] + 12, 0.07 * mul, 2.6, 3000, true);
        break;
      default: break;
    }
  }
  // Una nota de guitarra: triangular + sierra desafinada, filtro paso bajo con barrido, ruido de púa al inicio.
  _pluck(time, midi, vol, decay, cutoff = 2400, twang = false) {
    const a = this.a, ctx = this.ctx, f = mtof(midi);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.004;
    const lp = a._filter('lowpass', cutoff, twang ? 3.5 : 0.8);
    lp.frequency.setValueAtTime(cutoff * 1.6, time); lp.frequency.exponentialRampToValueAtTime(Math.max(280, cutoff * 0.18), time + decay);
    const g = a._gain(0), g2 = a._gain(twang ? 0.45 : 0.25);
    g.gain.setValueAtTime(0.0001, time); g.gain.linearRampToValueAtTime(vol, time + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, time + decay);
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(this.bus.guitar);
    o.start(time); o2.start(time); o.stop(time + decay + 0.05); o2.stop(time + decay + 0.05);
    if (vol > 0.1) {
      const n = a._src(a.whiteBuffer), nf = a._filter('bandpass', 2400, 1.2), ng = a._gain(0);
      ng.gain.setValueAtTime(vol * 0.5, time); ng.gain.exponentialRampToValueAtTime(0.0005, time + 0.025);
      n.connect(nf); nf.connect(ng); ng.connect(this.bus.guitar); n.start(time, Math.random()); n.stop(time + 0.04);
    }
  }
  // Rasgueo hacia abajo: las cuerdas entran con `spread` segundos de diferencia.
  _strum(time, midis, vol, spread, decay, cutoff) { midis.forEach((m, k) => this._pluck(time + k * spread, m, vol * (1 - k * 0.06), decay, cutoff)); }
  // Golpe de acorde cortado (palm mute): un solo filtro y una sola envolvente para todas las notas.
  _chord(time, midis, vol, dur, cutoff) {
    const a = this.a, ctx = this.ctx;
    const lp = a._filter('lowpass', cutoff, 1.1), g = a._gain(0);
    g.gain.setValueAtTime(0.0001, time); g.gain.linearRampToValueAtTime(vol, time + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, time + dur);
    lp.connect(g); g.connect(this.bus.guitar);
    for (const m of midis) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m);
      const og = a._gain(0.5); o.connect(og); og.connect(lp); o.start(time); o.stop(time + dur + 0.04);
    }
  }

  /* ---------------- Melodía: armónica o silbido ---------------- */
  _melody(kind, time, midi, dur) {
    const a = this.a, ctx = this.ctx, f = mtof(midi), d = Math.max(0.2, dur);
    if (kind === 'whistle') {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const vib = ctx.createOscillator(); vib.frequency.value = 5.6; const vg = a._gain(0); vib.connect(vg); vg.connect(o.frequency);
      vg.gain.setValueAtTime(0, time); vg.gain.linearRampToValueAtTime(f * 0.012, time + d * 0.6);
      const g = a._gain(0); g.gain.setValueAtTime(0.0001, time); g.gain.linearRampToValueAtTime(0.1, time + 0.12); g.gain.setValueAtTime(0.09, time + d - 0.2); g.gain.exponentialRampToValueAtTime(0.0005, time + d + 0.25);
      const n = a._src(a.whiteBuffer, true), nf = a._filter('bandpass', f * 2, 6), ng = a._gain(0.02); n.connect(nf); nf.connect(ng); ng.connect(g);
      o.connect(g); g.connect(this.bus.mel);
      o.start(time); vib.start(time); n.start(time, Math.random()); o.stop(time + d + 0.3); vib.stop(time + d + 0.3); n.stop(time + d + 0.3);
      return;
    }
    // armónica: dos osciladores cuadrados/sierra con formante nasal, vibrato que crece y soplido
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.006;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2; const vg = a._gain(0);
    vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    vg.gain.setValueAtTime(0, time); vg.gain.linearRampToValueAtTime(f * 0.009, time + Math.min(d, 0.9));
    const bp = a._filter('bandpass', Math.min(2200, f * 2.2), 1.6), lp = a._filter('lowpass', 3200, 0.5);
    const g = a._gain(0), og = a._gain(0.5), og2 = a._gain(0.35);
    g.gain.setValueAtTime(0.0001, time); g.gain.linearRampToValueAtTime(0.12, time + 0.07); g.gain.setValueAtTime(0.1, Math.max(time + 0.1, time + d - 0.12)); g.gain.exponentialRampToValueAtTime(0.0005, time + d + 0.2);
    o.connect(og); o2.connect(og2); og.connect(bp); og2.connect(bp); bp.connect(lp); lp.connect(g); g.connect(this.bus.mel);
    const n = a._src(a.whiteBuffer, true), nf = a._filter('bandpass', 3200, 1.5), ng = a._gain(0.045); n.connect(nf); nf.connect(ng); ng.connect(g);
    o.start(time); o2.start(time); vib.start(time); n.start(time, Math.random()); const end = time + d + 0.25;
    o.stop(end); o2.stop(end); vib.stop(end); n.stop(end);
  }

  /* ---------------- Percusión ---------------- */
  _perc(style, t, i, bar, mul) {
    switch (style) {
      case 'soft': if (i === 0) this._kick(t, 0.32 * mul, 95); if (i === 4 || i === 12) this._brush(t, 0.07 * mul); if (i === 8) this._kick(t, 0.14 * mul, 80); break;
      case 'heart': if (i === 0) this._kick(t, 0.5 * mul, 70); if (i === 3) this._kick(t, 0.32 * mul, 62); break;
      case 'heart2': if (i === 0 || i === 8) this._kick(t, 0.45 * mul, 62); if (i === 3 || i === 11) this._kick(t, 0.28 * mul, 55); break;
      case 'drive':
        if (i === 0 || i === 6 || i === 8) this._kick(t, 0.6 * mul, 105);
        if (i === 4 || i === 12) this._snare(t, 0.34 * mul);
        if (i % 2 === 0) this._hat(t, 0.06 * mul, i % 4 === 2);
        if (bar === 3 && i >= 12) this._tom(t, 0.4 * mul, 150 - (i - 12) * 22);
        else if (i === 10 || i === 14) this._tom(t, 0.22 * mul, 120);
        break;
      default: break;
    }
  }
  _kick(time, vol, f0) {
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, time); o.frequency.exponentialRampToValueAtTime(38, time + 0.22);
    const g = this.a._gain(0); g.gain.setValueAtTime(vol, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    o.connect(g); g.connect(this.bus.perc); o.start(time); o.stop(time + 0.34);
  }
  _tom(time, vol, f0) {
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f0, time); o.frequency.exponentialRampToValueAtTime(f0 * 0.5, time + 0.2);
    const g = this.a._gain(0); g.gain.setValueAtTime(vol, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.26);
    o.connect(g); g.connect(this.bus.perc); o.start(time); o.stop(time + 0.3);
  }
  _snare(time, vol) {
    const a = this.a, n = a._src(a.whiteBuffer), bp = a._filter('bandpass', 1900, 0.9), g = a._gain(0);
    g.gain.setValueAtTime(vol, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.17);
    n.connect(bp); bp.connect(g); g.connect(this.bus.perc); n.start(time, Math.random()); n.stop(time + 0.2);
    this._tom(time, vol * 0.5, 190);
  }
  _hat(time, vol, open) {
    const a = this.a, n = a._src(a.whiteBuffer), hp = a._filter('highpass', 7000, 0.7), g = a._gain(0);
    g.gain.setValueAtTime(vol, time); g.gain.exponentialRampToValueAtTime(0.001, time + (open ? 0.12 : 0.04));
    n.connect(hp); hp.connect(g); g.connect(this.bus.perc); n.start(time, Math.random()); n.stop(time + 0.14);
  }
  _brush(time, vol) {
    const a = this.a, n = a._src(a.whiteBuffer), bp = a._filter('bandpass', 5200, 0.6), g = a._gain(0);
    g.gain.setValueAtTime(0.0001, time); g.gain.linearRampToValueAtTime(vol, time + 0.03); g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    n.connect(bp); bp.connect(g); g.connect(this.bus.perc); n.start(time, Math.random()); n.stop(time + 0.2);
  }

  /* ---------------- Stingers (efectos musicales puntuales) ---------------- */
  stinger(kind) {
    if (!this.running) return;
    const t = this.ctx.currentTime + 0.02, a = this.a;
    if (kind === 'draw') {   // ¡Fuego!: golpe seco, platillo y un instante de silencio
      this._kick(t, 0.9, 120); this._tom(t, 0.5, 90);
      const n = a._src(a.whiteBuffer), hp = a._filter('highpass', 3000, 0.6), g = a._gain(0);
      g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      n.connect(hp); hp.connect(g); g.connect(this.bus.perc); n.start(t, Math.random()); n.stop(t + 1.2);
    } else if (kind === 'victory') {
      [64, 67, 71, 76, 79].forEach((m, k) => this._pluck(t + k * 0.11, m, 0.12, 2.6, 3000));
      this._melody('harmonica', t + 0.2, 83, 1.6);
    } else if (kind === 'defeat') {
      [52, 49, 45, 40].forEach((m, k) => this._pluck(t + k * 0.22, m, 0.14, 3.2, 700));
    } else if (kind === 'chapter') {
      this._strum(t, [40, 47, 52, 55, 59, 64], 0.16, 0.06, 4.0, 2400);
      this._melody('harmonica', t + 0.6, 71, 2.6);
    }
  }
}

export { MusicEngine, STATES as MUSIC_STATES };
