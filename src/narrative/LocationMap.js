// Mapa de lugares de la campaña: traduce cada id de LOCATIONS (campaign.js) a coordenadas del mundo.
// `kind` indica qué hito visual construye Landmarks.js (null = ya existe en el mapa o es un campamento).
// Los biomas (pantano, desierto, nieve) viven en CONFIG.BIOMES; aquí solo se colocan los destinos.
import { CONFIG } from '../core/Config.js';

const T = CONFIG.TOWN;
const L = (x, z, r = 30, kind = null) => ({ x, z, r, kind });

const LOCATION_COORDS = {
  // Acto I
  silver_ridge: L(-260, -740, 34, 'town'), blizzard_pass: L(-420, -600, 30, 'rocks'),
  cedar_hollow_camp: L(CONFIG.CAMP.x, CONFIG.CAMP.z, 26), elk_meadows: L(180, -60, 42), bear_den: L(-330, -340, 24, 'cave'),
  north_canyon: L(140, -575, 32),
  // Acto II
  redwood_gulch: L(T.x, T.z, 46), fairgrounds: L(285, 365, 26, 'fair'), vulture_gorge: L(60, 260, 30, 'rocks'), whitfield_farm: L(335, 445, 28, 'farm'),
  // Acto III
  redwater_river: L(-720, 30, 46, 'river'), dunmore_ranch: L(-770, 215, 30, 'ranchBig'), castellanos_hacienda: L(-770, -135, 30, 'hacienda'),
  salto_weir: L(-700, 62, 26, 'dam'), redwood_plaza: L(T.x, T.z, 24),
  // Acto IV
  railhead: L(700, 215, 40, 'tracks'), black_willow: L(-560, -560, 70), swamp_camp: L(CONFIG.CAMP_SITES.swamp.x, CONFIG.CAMP_SITES.swamp.z, 26), pacific_rail: L(700, 95, 40, 'tracks'),
  // Acto V
  skull_canyon: L(600, -610, 42, 'rocks'), salt_flats: L(705, -440, 60), dolorosa_mine: L(735, -655, 30, 'mine'),
  santa_aurelia: L(560, -470, 32, 'pueblo'), mesa_quebrada: L(CONFIG.CAMP_SITES.mesa.x, CONFIG.CAMP_SITES.mesa.z, 28),
  // Acto VI
  ruined_camp: L(CONFIG.CAMP.x, CONFIG.CAMP.z, 26), pike_post: L(CONFIG.TRADING_POST.x, CONFIG.TRADING_POST.z, 26), redwood_bank: L(T.x + 6, T.z - 8, 14),
  raven_pass: L(330, -300, 36, 'rocks'), gold_cave: L(300, -338, 20, 'cave'),
  // Epílogos
  la_rueda: L(CONFIG.CAMP_SITES.ranch.x, CONFIG.CAMP_SITES.ranch.z, 36), mustang_mesa: L(760, 640, 60), rustler_hollow: L(360, 705, 34, 'rocks'),
  white_ridge: L(-560, 640, 60), territorial_prison: L(-760, 540, 30, 'prison'), halcon_peak: L(-700, 700, 22, 'peak'),
};

// Calendario de campamentos: tras completar la misión indicada, la banda se muda a ese sitio (CONFIG.CAMP_SITES).
const CAMP_SCHEDULE = [
  { after: null, site: 'cedar' },
  { after: 'c4_01', site: 'swamp' },        // Cap. IV: huida al pantano de los Sauces Negros
  { after: 'c4_06', site: 'none' },        // el pantano arde: sin campamento
  { after: 'c5_06', site: 'mesa' },        // Cap. V: refugio en Mesa Quebrada
  { after: 'c5_06+', site: 'cedar_ruins' }, // Cap. VI: vuelven a un Cedar Hollow en ruinas (al empezar c6_01)
  { after: 'c6_06', site: 'ranch' },       // Epílogos: Rancho La Rueda
];

function resolveLocation(id, world = null) {
  const p = LOCATION_COORDS[id];
  if (!p) return null;
  return { id, x: p.x, z: p.z, r: p.r, kind: p.kind, y: world ? world.getHeightAt(p.x, p.z) : 0 };
}

export { LOCATION_COORDS, CAMP_SCHEDULE, resolveLocation };
