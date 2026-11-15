// Variantes de fauna para las cacerías de la campaña (alce, oso pardo, puma, caimán, jabalí, liebre, antílope, mustang, lobo blanco).
// Reutilizan la IA y los modelos de Deer (presas que huyen) y Wolf (depredadores que atacan): cambian escala, color,
// vida, mordisco y velocidad. Son animales "temporales": nacen cuando el jugador se acerca a la zona y se retiran al terminar el objetivo.
import * as THREE from 'three';
import { Deer } from './Deer.js';
import { Wolf } from './Wolf.js';
import { MAT } from '../render/GeometryKit.js';

const SPECIES = {
  // presas (base Deer)
  elk: { base: 'deer', label: 'alce', scale: 1.4, tint: 0xb89878, hp: 120, yields: ['elk_meat', 'elk_antlers'] },
  hare: { base: 'deer', label: 'liebre', scale: 0.32, tint: 0xc8b090, hp: 10, yields: ['venison'], speed: 1.15 },
  pronghorn: { base: 'deer', label: 'antílope', scale: 0.85, tint: 0xd8a870, hp: 55, yields: ['venison', 'deer_pelt'], speed: 1.2 },
  mustang: { base: 'deer', label: 'mustang', scale: 1.1, tint: 0xa8a8a8, hp: 90, yields: [], speed: 1.15 },
  // depredadores (base Wolf)
  bear: { base: 'wolf', label: 'oso pardo', scale: 1.75, tint: 0x8a5a3a, hp: 260, bite: 2.6, speed: 0.75, yields: ['grizzly_pelt'] },
  cougar: { base: 'wolf', label: 'puma', scale: 0.95, tint: 0xd8b078, hp: 85, bite: 1.3, speed: 1.15, yields: ['cougar_pelt'] },
  boar: { base: 'wolf', label: 'jabalí', scale: 0.8, tint: 0x6a4a38, hp: 75, bite: 1.1, speed: 0.85, yields: ['boar_meat'] },
  gator: { base: 'wolf', label: 'caimán', scale: 1.15, tint: 0x4a6a3a, hp: 200, bite: 2.2, speed: 0.55, yields: ['gator_hide'], squash: 0.5 },
  whitewolf: { base: 'wolf', label: 'lobo blanco', scale: 1.2, tint: 0xf2f4f6, hp: 150, bite: 1.5, speed: 1.1, yields: ['white_wolf_pelt'] },
};
// Nombres de especie que usa campaign.js (español) → id interno.
const ALIAS = {
  ciervo: 'deer', alce: 'elk', lobo: 'wolf', 'oso pardo': 'bear', oso: 'bear', puma: 'cougar', caimán: 'gator', jabalí: 'boar',
  liebre: 'hare', antílope: 'pronghorn', mustang: 'mustang', 'lobo blanco': 'whitewolf', res: 'cattle',
};

function makeAnimal(game, speciesId, x, z, rand) {
  const def = SPECIES[speciesId], idx = makeAnimal.n = (makeAnimal.n || 0) + 1;
  if (!def) { return speciesId === 'deer' ? new Deer(game, { id: `tmp${idx}`, x, z }, rand) : new Wolf(game, { id: `tmp${idx}`, x, z, count: 1 }, 0, rand); }
  const a = def.base === 'deer' ? new Deer(game, { id: `tmp${idx}`, x, z }, rand) : new Wolf(game, { id: `tmp${idx}`, x, z, count: 1 }, 0, rand);
  a.species = speciesId; a.radarKind = def.base === 'deer' ? 'deer' : 'wolf'; a.label = def.label; a.skinYields = def.yields; a.temp = true; a.isBuck = speciesId === 'elk';
  a.maxHp = a.hp = def.hp; a.biteMul = def.bite || 1; a.speedMul = def.speed || 1;
  const root = a.model.root; root.scale.set(def.scale, def.scale * (def.squash || 1), def.scale);
  const base = new THREE.MeshLambertMaterial({ vertexColors: true, color: def.tint });
  a._tintMat = base;
  a._applyMaterials = function applyTinted() {   // el color de la especie reemplaza al material compartido (sin perder Instinto ni "despellejado")
    this.model.meshes.forEach((mesh) => { mesh.material = (this.skinned && mesh !== this.model.headMesh) ? MAT.skinned : this.highlighted ? this.instinctMat : base; });
  };
  a._applyMaterials();
  a._canRespawn = () => false;   // los animales de misión no reaparecen solos
  if (def.base === 'deer' && def.speed) a.fleeMul = def.speed;
  return a;
}

export { SPECIES, ALIAS, makeAnimal };
