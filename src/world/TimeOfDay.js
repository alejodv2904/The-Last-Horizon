import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { lerp, smoothstep } from '../core/MathUtils.js';

const SKY_KEYS_RAW = [
  { h: 0.0,  top: 0x060a16, fog: 0x121a2b, sun: 0x9fb4e0, sunI: 0.35, hs: 0x2a3a5c, hg: 0x0d0c10, hI: 0.6,  fd: 0.0105 },
  { h: 4.8,  top: 0x0a1026, fog: 0x1d2236, sun: 0x9fb4e0, sunI: 0.3,  hs: 0x2e3a58, hg: 0x110e10, hI: 0.6,  fd: 0.0105 },
  { h: 6.2,  top: 0x34507e, fog: 0xd99a76, sun: 0xffa060, sunI: 1.0,  hs: 0x8a90b0, hg: 0x4a3a2c, hI: 0.95, fd: 0.0085 },
  { h: 8.0,  top: 0x4c7fc0, fog: 0xc9d4d8, sun: 0xffe6c4, sunI: 2.4,  hs: 0xa9c2dc, hg: 0x5c4a34, hI: 1.25, fd: 0.0068 },
  { h: 12.5, top: 0x3d74c2, fog: 0xc8d8e4, sun: 0xfff6e6, sunI: 3.0,  hs: 0xb4cce6, hg: 0x63513a, hI: 1.35, fd: 0.0064 },
  { h: 16.0, top: 0x4a76b4, fog: 0xe2cfa8, sun: 0xffd9a0, sunI: 2.7,  hs: 0xb9c0cc, hg: 0x6a5232, hI: 1.25, fd: 0.0066 },
  { h: 18.3, top: 0x404c84, fog: 0xf0a060, sun: 0xff8a40, sunI: 2.1,  hs: 0x9a8aa0, hg: 0x5a3c26, hI: 1.05, fd: 0.0068 },
  { h: 19.4, top: 0x262a5a, fog: 0xb05a48, sun: 0xff5a30, sunI: 0.8,  hs: 0x5a4a6a, hg: 0x2a1c18, hI: 0.8,  fd: 0.0080 },
  { h: 20.6, top: 0x0e1230, fog: 0x2c2440, sun: 0x9fb4e0, sunI: 0.3,  hs: 0x2e3456, hg: 0x110e10, hI: 0.6,  fd: 0.0098 },
  { h: 24.0, top: 0x060a16, fog: 0x121a2b, sun: 0x9fb4e0, sunI: 0.35, hs: 0x2a3a5c, hg: 0x0d0c10, hI: 0.6,  fd: 0.0105 },
];
const SUNRISE = 6.2, SUNSET = 19.3;

class TimeOfDay {
  constructor(startHour) {
    this.hour = startHour; this.timeScale = 1;
    this.keys = SKY_KEYS_RAW.map((k) => ({
      h: k.h, sunI: k.sunI, hI: k.hI, fd: k.fd,
      top: new THREE.Color(k.top), fog: new THREE.Color(k.fog), sun: new THREE.Color(k.sun),
      hs: new THREE.Color(k.hs), hg: new THREE.Color(k.hg),
    }));
    this.state = {
      top: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color(),
      sunI: 1, hI: 1, fd: 0.006, sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), lightDir: new THREE.Vector3(),
      lightIntensityScale: 1, night: 0, isDay: true,
    };
  }
  update(dt) {
    this.hour = (this.hour + dt * this.timeScale * 24 / CONFIG.DAY_LENGTH_SECONDS) % 24;
    const s = this.state, h = this.hour;
    let i = 0;
    while (i < this.keys.length - 2 && this.keys[i + 1].h <= h) i++;
    const a = this.keys[i], b = this.keys[i + 1];
    const t = smoothstep(0, 1, (h - a.h) / (b.h - a.h));
    s.top.lerpColors(a.top, b.top, t); s.fog.lerpColors(a.fog, b.fog, t); s.sun.lerpColors(a.sun, b.sun, t);
    s.hs.lerpColors(a.hs, b.hs, t); s.hg.lerpColors(a.hg, b.hg, t);
    s.sunI = lerp(a.sunI, b.sunI, t); s.hI = lerp(a.hI, b.hI, t); s.fd = lerp(a.fd, b.fd, t);

    const isDay = h >= SUNRISE && h <= SUNSET;
    let elev;
    if (isDay) {
      const ang = (h - SUNRISE) / (SUNSET - SUNRISE) * Math.PI;
      s.sunDir.set(Math.cos(ang), Math.sin(ang) * 0.82, -0.42).normalize();
      s.moonDir.copy(s.sunDir).negate();
      elev = Math.sin(ang);
      s.lightDir.copy(s.sunDir);
    } else {
      const nightLen = 24 - (SUNSET - SUNRISE);
      const ang = (((h - SUNSET) + 24) % 24) / nightLen * Math.PI;
      s.moonDir.set(Math.cos(ang), Math.sin(ang) * 0.82, 0.35).normalize();
      s.sunDir.copy(s.moonDir).negate();
      elev = Math.sin(ang);
      s.lightDir.copy(s.moonDir);
    }
    s.isDay = isDay;
    s.lightIntensityScale = smoothstep(0.0, 0.12, elev);
    s.lightDir.y = Math.max(s.lightDir.y, 0.2); s.lightDir.normalize();
    s.night = 1 - smoothstep(-0.1, 0.16, s.sunDir.y);
    return s;
  }
  formatClock() {
    const hh = Math.floor(this.hour), mm = Math.floor((this.hour - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}

export { SKY_KEYS_RAW, SUNRISE, SUNSET, TimeOfDay };
