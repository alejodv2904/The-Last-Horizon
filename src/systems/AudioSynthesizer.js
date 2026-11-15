import { clamp } from '../core/MathUtils.js';

class AudioSynthesizer {
  constructor() { this.ctx = null; this.ready = false; this._paramTimer = 0; this._music = null; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.75;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.whiteBuffer = this._noiseBuffer(2, 'white');
    this.brownBuffer = this._noiseBuffer(4, 'brown');
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this._impulse(3.0, 2.6);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(this.reverb); this.reverb.connect(this.master);
    this._startWind(); this._startFire(); this._startCrickets();
    this.ready = true;
  }
  _noiseBuffer(seconds, type) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }
  _impulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  _src(buffer, loop = false) { const s = this.ctx.createBufferSource(); s.buffer = buffer; s.loop = loop; return s; }
  _filter(type, freq, q = 1) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
  _gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  _lfo(freq, depth, target) {
    const o = this.ctx.createOscillator(); o.frequency.value = freq;
    const g = this._gain(depth); o.connect(g); g.connect(target); o.start(); return o;
  }

  _startWind() {
    const src = this._src(this.brownBuffer, true);
    const bp = this._filter('bandpass', 380, 0.7);
    const g = this._gain(0.22);
    this._lfo(0.07, 0.12, g.gain);
    this._lfo(0.045, 220, bp.frequency);
    const src2 = this._src(this.whiteBuffer, true);
    const bp2 = this._filter('bandpass', 1400, 9);
    const g2 = this._gain(0.012);
    this._lfo(0.11, 0.011, g2.gain);
    this._lfo(0.06, 300, bp2.frequency);
    this.windBus = this._gain(1);
    src.connect(bp); bp.connect(g); g.connect(this.windBus);
    src2.connect(bp2); bp2.connect(g2); g2.connect(this.windBus);
    this.windBus.connect(this.master);
    src.start(); src2.start(Math.random());
  }
  _startFire() {
    this.fireBus = this._gain(0);
    const src = this._src(this.brownBuffer, true);
    const lp = this._filter('lowpass', 700, 0.5);
    const g = this._gain(0.35);
    src.connect(lp); lp.connect(g); g.connect(this.fireBus);
    this.fireBus.connect(this.master);
    src.start(0, 1.3);
  }
  _pop(vol) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this._src(this.whiteBuffer);
    const hp = this._filter('highpass', 1200 + Math.random() * 2500, 0.8);
    const g = this._gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol * (0.15 + Math.random() * 0.35), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + Math.random() * 0.05);
    s.connect(hp); hp.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 1.5); s.stop(t + 0.1);
  }
  _startCrickets() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 4300;
    const am = this._gain(0.5);
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 28;
    const lfoG = this._gain(0.5); lfo.connect(lfoG); lfoG.connect(am.gain);
    const pulse = this._gain(0.5);
    const lfo2 = ctx.createOscillator(); lfo2.type = 'square'; lfo2.frequency.value = 0.9;
    const lfo2G = this._gain(0.5); lfo2.connect(lfo2G); lfo2G.connect(pulse.gain);
    this.cricketBus = this._gain(0);
    osc.connect(am); am.connect(pulse); pulse.connect(this.cricketBus); this.cricketBus.connect(this.master);
    const osc2 = ctx.createOscillator(); osc2.frequency.value = 4720;
    const am2 = this._gain(0.3); this._lfo(19, 0.3, am2.gain);
    osc2.connect(am2); am2.connect(this.cricketBus);
    osc.start(); lfo.start(); lfo2.start(); osc2.start();
  }

  update(dt, p) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const fireVol = Math.pow(clamp(1 - p.fireDistance / 28, 0, 1), 1.5);
    if (fireVol > 0.02 && Math.random() < dt * 10) this._pop(fireVol);
    if (p.night > 0.65 && Math.random() < dt / 35) this.playHowl();
    this._updateSaloon(p.saloonDistance ?? 999);
    this._paramTimer -= dt;
    if (this._paramTimer > 0) return;
    this._paramTimer = 0.25;
    this.fireBus.gain.setTargetAtTime(fireVol * 0.9, t, 0.3);
    this.cricketBus.gain.setTargetAtTime(p.night * 0.035, t, 1.2);
    this.windBus.gain.setTargetAtTime(0.65 + (1 - p.night) * 0.45, t, 1.5);
  }

  /* ---------- Fase 3 ---------- */
  // Piano de saloon sintetizado: un ragtime de 16 pasos, programado con el reloj del AudioContext (sin timers de JS).
  // Solo suena cuando el jugador está a menos de 46 m del saloon; el volumen baja con la distancia.
  _updateSaloon(dist) {
    const vol = Math.pow(clamp(1 - dist / 46, 0, 1), 1.6);
    if (vol < 0.02) { this._music = null; return; }
    const ctx = this.ctx, now = ctx.currentTime;
    if (!this._music || this._music.next < now - 0.5) this._music = { next: now + 0.05, step: 0 };
    const m = this._music, STEP = 0.2;
    const MEL = [76, 0, 74, 76, 79, 0, 76, 0, 72, 74, 76, 0, 74, 72, 71, 0], BASS = [48, 0, 55, 0, 48, 0, 55, 0, 53, 0, 60, 0, 55, 0, 43, 0];
    const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
    while (m.next < now + 0.35) {
      const i = m.step % 16;
      if (MEL[i]) this._pluck(m.next, mtof(MEL[i]), 0.07 * vol, 0.7);
      if (BASS[i]) { this._pluck(m.next, mtof(BASS[i]), 0.1 * vol, 0.5); this._pluck(m.next + STEP * 0.5, mtof(BASS[i] + 12 + 4), 0.045 * vol, 0.3); }
      m.next += STEP; m.step++;
    }
  }
  // Disparo lejano/ajeno: mismo timbre, volumen y brillo según la distancia
  playShotAt(distance) {
    if (!this.ready) return;
    const vol = this._vol(0.7, distance, 260); if (vol < 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._gain(vol); out.connect(this.master); if (distance > 25) out.connect(this.reverbSend);
    const n1 = this._src(this.whiteBuffer), lp = this._filter('lowpass', Math.max(500, 5000 - distance * 22), 0.7), g1 = this._gain(0);
    g1.gain.setValueAtTime(1.0, t); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.28 + Math.min(distance / 400, 0.5));
    n1.connect(lp); lp.connect(g1); g1.connect(out); n1.start(t, Math.random()); n1.stop(t + 0.9);
    const o = ctx.createOscillator(); o.type = 'sine'; const g3 = this._gain(0);
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    g3.gain.setValueAtTime(0.7, t); g3.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g3); g3.connect(out); o.start(t); o.stop(t + 0.35);
    setTimeout(() => { try { out.disconnect(); } catch (e) { /* ya liberado */ } }, 2500);
  }
  // Bala que pasa silbando cerca de la cabeza
  playWhiz() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; const bp = this._filter('bandpass', 2200, 4), g = this._gain(0);
    o.frequency.setValueAtTime(3200, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.22);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(bp); bp.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.3);
  }
  playDrink() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const s = this._src(this.whiteBuffer), bp = this._filter('bandpass', 420 + i * 120, 4), g = this._gain(0), tt = t + i * 0.2;
      g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.16, tt + 0.04); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.17);
      s.connect(bp); bp.connect(g); g.connect(this.master); s.start(tt, Math.random()); s.stop(tt + 0.2);
    }
    this._pluck(t + 0.7, 523.3, 0.05, 0.5);
  }
  playHonor(up) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (up) { this._pluck(t, 523.3, 0.08, 0.9); this._pluck(t + 0.1, 659.3, 0.08, 1.0); this._pluck(t + 0.2, 784, 0.08, 1.4); }
    else { this._pluck(t, 196, 0.12, 1.0); this._pluck(t + 0.14, 155.6, 0.12, 1.4); }
  }
  playWanted() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [0, 0.22].forEach((d) => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(330, t + d); o.frequency.exponentialRampToValueAtTime(247, t + d + 0.2);
      const lp = this._filter('lowpass', 900, 1), g = this._gain(0);
      g.gain.setValueAtTime(0.0001, t + d); g.gain.linearRampToValueAtTime(0.09, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.26);
      o.connect(lp); lp.connect(g); g.connect(this.master); g.connect(this.reverbSend); o.start(t + d); o.stop(t + d + 0.3);
    });
  }

  playGunshot() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._gain(1); out.connect(this.master); out.connect(this.reverbSend);
    const n1 = this._src(this.whiteBuffer); const hp = this._filter('highpass', 1000, 0.7); const g1 = this._gain(0);
    g1.gain.setValueAtTime(1.1, t); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n1.connect(hp); hp.connect(g1); g1.connect(out); n1.start(t, Math.random()); n1.stop(t + 0.25);
    const n2 = this._src(this.whiteBuffer); const lp = this._filter('lowpass', 2600, 0.8); const g2 = this._gain(0);
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.6);
    g2.gain.setValueAtTime(1.0, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
    n2.connect(lp); lp.connect(g2); g2.connect(out); n2.start(t, Math.random()); n2.stop(t + 0.8);
    const o = ctx.createOscillator(); o.type = 'sine'; const g3 = this._gain(0);
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.25);
    g3.gain.setValueAtTime(1.0, t); g3.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g3); g3.connect(out); o.start(t); o.stop(t + 0.4);
    const delay = ctx.createDelay(2); delay.delayTime.value = 0.62;
    const fb = this._gain(0.33); const elp = this._filter('lowpass', 900, 0.5); const echo = this._gain(0.45);
    out.connect(delay); delay.connect(elp); elp.connect(fb); fb.connect(delay); elp.connect(echo); echo.connect(this.master);
    setTimeout(() => { try { out.disconnect(); delay.disconnect(); elp.disconnect(); fb.disconnect(); echo.disconnect(); } catch (e) { /* nodos ya liberados */ } }, 4500);
    this.playLever(0.38);
  }
  _click(time, freq, vol) {
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const hp = this._filter('highpass', 1500, 1); const g = this._gain(0);
    g.gain.setValueAtTime(vol, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
    o.connect(hp); hp.connect(g); g.connect(this.master); o.start(time); o.stop(time + 0.05);
    const n = this._src(this.whiteBuffer); const bp = this._filter('bandpass', 3500, 2); const gn = this._gain(0);
    gn.gain.setValueAtTime(vol * 1.2, time); gn.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    n.connect(bp); bp.connect(gn); gn.connect(this.master); n.start(time, Math.random()); n.stop(time + 0.05);
  }
  playLever(delay = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    this._click(t, 1900, 0.12); this._click(t + 0.17, 2400, 0.14);
  }
  playDryFire() { if (this.ready) this._click(this.ctx.currentTime, 2800, 0.1); }
  playReload(duration, shells) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = Math.max(1, shells);
    for (let i = 0; i < n; i++) this._click(t + 0.15 + (i / n) * (duration - 0.5), 1300 + Math.random() * 300, 0.09);
    this.playLever(duration - 0.25);
  }
  playFootstep(running) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const s = this._src(this.whiteBuffer); const bp = this._filter('bandpass', 260 + Math.random() * 260, 1.1); const g = this._gain(0);
    const vol = (running ? 0.32 : 0.2) * (0.8 + Math.random() * 0.3);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    s.connect(bp); bp.connect(g); g.connect(this.master); s.start(t, Math.random() * 1.5); s.stop(t + 0.16);
  }
  playSkin(duration) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const t = t0 + 0.2 + i * (duration / 5.5);
      const s = this._src(this.whiteBuffer); const bp = this._filter('bandpass', 600, 3); const g = this._gain(0);
      bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.25);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      s.connect(bp); bp.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.35);
    }
  }
  playDeerDeath(distance) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    const vol = 0.14 * clamp(1 - distance / 160, 0.15, 1);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(430, t); o.frequency.exponentialRampToValueAtTime(240, t + 0.5);
    const vib = ctx.createOscillator(); vib.frequency.value = 8; const vg = this._gain(14); vib.connect(vg); vg.connect(o.frequency);
    const lp = this._filter('lowpass', 1300, 1); const g = this._gain(0);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(lp); lp.connect(g); g.connect(this.master); g.connect(this.reverbSend);
    o.start(t); vib.start(t); o.stop(t + 0.65); vib.stop(t + 0.65);
  }
  playSnort(distance) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const vol = 0.2 * clamp(1 - distance / 70, 0, 1);
    if (vol <= 0.01) return;
    const s = this._src(this.whiteBuffer); const bp = this._filter('bandpass', 850, 2.5); const g = this._gain(0);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    s.connect(bp); bp.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.25);
  }
  playHowl() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(420, t); o.frequency.linearRampToValueAtTime(760, t + 0.8);
    o.frequency.linearRampToValueAtTime(700, t + 2.2); o.frequency.linearRampToValueAtTime(480, t + 3.0);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = this._gain(9); vib.connect(vg); vg.connect(o.frequency);
    const g = this._gain(0);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03, t + 0.6); g.gain.linearRampToValueAtTime(0.025, t + 2.2); g.gain.exponentialRampToValueAtTime(0.0005, t + 3.1);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.connect(g);
    if (pan) { pan.pan.value = Math.random() * 2 - 1; g.connect(pan); pan.connect(this.reverbSend); pan.connect(this.master); }
    else { g.connect(this.reverbSend); g.connect(this.master); }
    o.start(t); vib.start(t); o.stop(t + 3.2); vib.stop(t + 3.2);
  }
  _vol(base, distance, range) { return base * clamp(1 - distance / range, 0, 1); }
  playWhistle() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [[0, 1700, 2350, 0.22], [0.32, 2250, 1650, 0.38]].forEach(([dt0, f0, f1, dur]) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, t + dt0); o.frequency.exponentialRampToValueAtTime(f1, t + dt0 + dur);
      const vib = ctx.createOscillator(); vib.frequency.value = 9; const vg = this._gain(25); vib.connect(vg); vg.connect(o.frequency);
      const g = this._gain(0);
      g.gain.setValueAtTime(0.0001, t + dt0); g.gain.linearRampToValueAtTime(0.11, t + dt0 + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + dt0 + dur);
      o.connect(g); g.connect(this.master); g.connect(this.reverbSend);
      o.start(t + dt0); vib.start(t + dt0); o.stop(t + dt0 + dur + 0.05); vib.stop(t + dt0 + dur + 0.05);
    });
  }
  playNeigh(distance) {
    if (!this.ready) return;
    const vol = this._vol(0.13, distance, 220); if (vol < 0.005) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(880, t + 0.25);
    o.frequency.linearRampToValueAtTime(640, t + 0.8); o.frequency.linearRampToValueAtTime(380, t + 1.15);
    const vib = ctx.createOscillator(); vib.frequency.value = 17; const vg = this._gain(45); vib.connect(vg); vg.connect(o.frequency);
    const bp = this._filter('bandpass', 1300, 1.4); const g = this._gain(0);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.08); g.gain.linearRampToValueAtTime(vol * 0.8, t + 0.9); g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    o.connect(bp); bp.connect(g); g.connect(this.master); g.connect(this.reverbSend);
    o.start(t); vib.start(t); o.stop(t + 1.25); vib.stop(t + 1.25);
    const n = this._src(this.whiteBuffer); const lp = this._filter('bandpass', 700, 1.2); const gn = this._gain(0);
    gn.gain.setValueAtTime(0.0001, t + 1.15); gn.gain.linearRampToValueAtTime(vol * 1.2, t + 1.2); gn.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    n.connect(lp); lp.connect(gn); gn.connect(this.master); n.start(t + 1.15, Math.random()); n.stop(t + 1.55);
  }
  playHoof(intensity, distance) {
    if (!this.ready) return;
    const vol = this._vol(0.1 + intensity * 0.12, distance, 70); if (vol < 0.004) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140 + Math.random() * 30, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.07);
    const g = this._gain(0); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.1);
    const n = this._src(this.whiteBuffer); const bp = this._filter('bandpass', 700 + Math.random() * 500, 1.5); const gn = this._gain(0);
    gn.gain.setValueAtTime(vol * 0.8, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(bp); bp.connect(gn); gn.connect(this.master); n.start(t, Math.random() * 1.5); n.stop(t + 0.06);
  }
  playGrowl(distance) {
    if (!this.ready) return;
    const vol = this._vol(0.16, distance, 60); if (vol < 0.005) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.1 + Math.random() * 0.5;
    const lp = this._filter('lowpass', 520, 2); const am = this._gain(0.6);
    const rough = ctx.createOscillator(); rough.frequency.value = 23 + Math.random() * 6;
    const roughG = this._gain(0.4); rough.connect(roughG); roughG.connect(am.gain); rough.start(t); rough.stop(t + dur + 0.05);
    const g = this._gain(0);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    [82, 87.5].forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.25, t + dur * 0.4); o.frequency.linearRampToValueAtTime(f * 0.9, t + dur);
      o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
    });
    lp.connect(am); am.connect(g); g.connect(this.master);
  }
  playBite() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = this._src(this.whiteBuffer); const hp = this._filter('highpass', 1800, 0.8); const g = this._gain(0);
    g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    n.connect(hp); hp.connect(g); g.connect(this.master); n.start(t, Math.random()); n.stop(t + 0.08);
    this._click(t + 0.02, 600, 0.12);
  }
  playHurt() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.25);
    const lp = this._filter('lowpass', 900, 1); const g = this._gain(0);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(lp); lp.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.32);
  }
  playInstinct(on) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(on ? 180 : 700, t); o.frequency.exponentialRampToValueAtTime(on ? 720 : 160, t + 0.6);
    const g = this._gain(0); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g); g.connect(this.master); g.connect(this.reverbSend); o.start(t); o.stop(t + 0.75);
    if (on) for (let i = 0; i < 2; i++) {
      const h = ctx.createOscillator(); h.frequency.setValueAtTime(70, t + 0.15 + i * 0.28); h.frequency.exponentialRampToValueAtTime(40, t + 0.3 + i * 0.28);
      const hg = this._gain(0); hg.gain.setValueAtTime(0.25, t + 0.15 + i * 0.28); hg.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + i * 0.28);
      h.connect(hg); hg.connect(this.master); h.start(t + 0.15 + i * 0.28); h.stop(t + 0.4 + i * 0.28);
    }
  }
  playCash() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [1318.5, 1760, 2637].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this._gain(0); g.gain.setValueAtTime(0.0001, t + i * 0.06); g.gain.linearRampToValueAtTime(0.07, t + i * 0.06 + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.5);
      o.connect(g); g.connect(this.master); o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.55);
    });
    for (let i = 0; i < 3; i++) this._click(t + 0.02 + i * 0.05, 3200 + i * 400, 0.05);
  }
  playUI() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 660;
    const g = this._gain(0); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.2);
  }
  _pluck(time, freq, vol, decay) {
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = this.ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freq * 1.003;
    const lp = this._filter('lowpass', 2400, 0.7);
    lp.frequency.setValueAtTime(3200, time); lp.frequency.exponentialRampToValueAtTime(500, time + decay);
    const g = this._gain(0); const g2 = this._gain(0.25);
    g.gain.setValueAtTime(0.0001, time); g.gain.linearRampToValueAtTime(vol, time + 0.005); g.gain.exponentialRampToValueAtTime(0.0005, time + decay);
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(this.master); g.connect(this.reverbSend);
    o.start(time); o2.start(time); o.stop(time + decay + 0.05); o2.stop(time + decay + 0.05);
  }
  playItem() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._pluck(t, 392, 0.09, 0.6); this._pluck(t + 0.09, 587.3, 0.08, 0.8);
  }
  playMissionComplete() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const notes = [82.41, 123.47, 164.81, 196.0, 246.94, 329.63, 392.0, 493.88];
    notes.forEach((f, i) => this._pluck(t + i * 0.13, f, 0.1, 2.2));
    this._pluck(t + 1.25, 329.63, 0.1, 2.8); this._pluck(t + 1.25, 415.3, 0.08, 2.8); this._pluck(t + 1.25, 493.88, 0.08, 2.8);
  }
}

export { AudioSynthesizer };
