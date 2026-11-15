import * as THREE from 'three';


const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _sc = new THREE.Vector3();

function colorize(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function varyFaceColors(geo, rand, amount) {
  const col = geo.attributes.color;
  for (let i = 0; i < col.count; i += 3) {
    const k = 1 - amount + rand() * amount * 2;
    for (let j = 0; j < 3; j++) col.setXYZ(i + j, col.getX(i + j) * k, col.getY(i + j) * k, col.getZ(i + j) * k);
  }
  return geo;
}

function mergeGeos(list) {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o);
    nor.set(g.attributes.normal.array, o);
    col.set(g.attributes.color.array, o);
    o += g.attributes.position.count * 3;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

class GeoBuilder {
  constructor() { this.parts = []; }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = colorize(geo, color);
    _m4.compose(_v1.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _sc.set(sx, sy, sz));
    g.applyMatrix4(_m4);
    this.parts.push(g);
    return this;
  }
  addGeo(g) { this.parts.push(g); return this; }
  build() { return mergeGeos(this.parts); }
}

const MAT = {};
function createSharedMaterials() {
  MAT.vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  MAT.vcDouble = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  MAT.skinned = new THREE.MeshLambertMaterial({ color: 0x7a2e26 });
  MAT.hitbox = new THREE.MeshBasicMaterial({ visible: false });
  // Materiales del Instinto de Cazador: mismo color por vértice + brillo emisivo por especie.
  MAT.instinctDeer = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffa040, emissiveIntensity: 0.55 });
  MAT.instinctWolf = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xff2a1a, emissiveIntensity: 0.6 });
  MAT.instinctHorse = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xb8d0ff, emissiveIntensity: 0.4 });
  MAT.windUniforms = { uTime: { value: 0 } };
  MAT.pine = makeWindMaterial(2.2, 0.014, false);
  MAT.oak = makeWindMaterial(2.6, 0.02, false);
  MAT.grass = makeWindMaterial(0.0, 0.13, true);
}
function makeWindMaterial(base, strength, doubleSided) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = MAT.windUniforms.uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float sway = sin(uTime * 1.3 + ip.x * 0.21 + ip.z * 0.17) + 0.5 * sin(uTime * 2.7 + ip.x * 0.5);
      float bend = max(position.y - ${base.toFixed(2)}, 0.0) * ${strength.toFixed(4)};
      transformed.x += sway * bend;
      transformed.z += sway * bend * 0.6;`);
  };
  m.customProgramCacheKey = () => `wind_${base}_${strength}_${doubleSided}`;
  return m;
}

function makeGlowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner); grd.addColorStop(0.35, outer); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeMarkerTexture(symbol, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2);
  g.fillStyle = 'rgba(20,14,8,0.85)'; g.fill();
  g.lineWidth = 7; g.strokeStyle = color; g.stroke();
  g.fillStyle = color; g.font = 'bold 72px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(symbol, 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export { _m4, _q, _e, _v1, _sc, colorize, varyFaceColors, mergeGeos, GeoBuilder, MAT, createSharedMaterials, makeWindMaterial, makeGlowTexture, makeMarkerTexture };
