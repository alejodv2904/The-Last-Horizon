// Parámetros globales del juego. Todo lo "ajustable" vive aquí.
const CONFIG = {
  // --- Mundo por chunks ---
  CHUNK_SIZE: 200,            // metros por lado de cada sector
  CHUNK_RES: 40,              // celdas por lado (5 m por celda, low-poly)
  WORLD_HALF: 1000,           // el mundo va de -1000 a +1000 (10x10 chunks = 2 km x 2 km)
  WORLD_LIMIT: 935,           // límite jugable (las montañas del borde empiezan antes)
  CHUNK_HYSTERESIS: 14,       // metros fuera del chunk central antes de recentrar (evita "parpadeo")
  CHUNK_BUILDS_PER_FRAME: 1,  // construcción diferida: 1 chunk por frame como máximo
  VEG_MAX_PER_CHUNK: { pine: 240, oak: 36, rock: 40, sage: 110, grass: 360 },

  // --- Puntos fijos ---
  CAMP: { x: 0, z: 0 },
  TRADING_POST: { x: -430, z: 390 },
  ROAD: [[0, -8], [-60, 70], [-200, 170], [-330, 300], [-424, 382]],
  PLAYER_SPAWN: { x: 0, z: -13 },
  HORSE_SPAWN: { x: 6.5, z: -12 },

  // --- Tiempo y render ---
  DAY_LENGTH_SECONDS: 600,
  START_HOUR: 16.6,
  SHADOW_MAP_SIZE: 1024,
  SHADOW_EXTENT: 50,
  MAX_PIXEL_RATIO: 1.25,
  MAX_PIXEL_RATIO_TOUCH: 1.0,
  MIN_PIXEL_RATIO: 0.6,

  // --- Jugador ---
  PLAYER_REGEN: 0.7,          // vida/seg tras salir de combate (regeneración lenta)
  PLAYER_REGEN_DELAY: 9,      // segundos sin recibir daño antes de regenerar
  WALK_SPEED: 3.3,
  RUN_SPEED: 7.0,
  AIM_SPEED: 1.9,
  MOUSE_SENS: 0.0022,
  PLAYER_MAX_HEALTH: 100,
  RIFLE_MAG: 8,
  RIFLE_COOLDOWN: 0.85,
  RELOAD_TIME: 1.7,
  START_AMMO: 24,
  RIFLE_BASE_DAMAGE: 70,
  RIFLE_BASE_RANGE: 350,

  // --- Caballo ---
  HORSE: {
    WALK: 2.2, TROT: 5.5, CANTER: 9.0, GALLOP: 14.0,
    STAMINA_DRAIN: 13, STAMINA_REGEN: 9, EXHAUSTED_UNTIL: 35,
    CALL_TELEPORT_DIST: 260, MOUNT_DIST: 3.0,
  },

  // --- Fauna ---
  HERDS: [
    { id: 'arroyo_ne', label: 'Arroyo del noreste', x: 64, z: 60, count: 3 },
    { id: 'praderas_o', label: 'Praderas del oeste', x: -72, z: 66, count: 3 },
    { id: 'llano_este', label: 'Llano del este', x: 280, z: -170, count: 3 },
    { id: 'valle_sur', label: 'Valle del sur', x: -260, z: -300, count: 3 },
    { id: 'colinas_norte', label: 'Colinas del norte', x: 120, z: 520, count: 3 },
  ],
  WOLF_PACKS: [
    { id: 'manada_pinar', x: 330, z: 250, count: 3 },
    { id: 'manada_sur', x: -140, z: -420, count: 2 },
    { id: 'manada_oeste', x: -560, z: 150, count: 3 },
  ],
  DEER_RESPAWN_SECONDS: 90,
  WOLF_RESPAWN_SECONDS: 180,
  AI_ACTIVE_RADIUS: 320,      // fuera de este radio la IA "duerme" (LOD de IA)

  // --- Sistemas ---
  INSTINCT_DURATION: 12,
  INSTINCT_COOLDOWN: 5,
  SAVE_KEY: 'thelasthorizon.save.v1',
  AUTOSAVE_SECONDS: 30,

  // --- Fase 3: pueblo fronterizo, bandidos y ley ---
  TOWN: { id: 'redwood_gulch', name: 'Redwood Gulch', x: 215, z: 335, radius: 46 },
  ROAD_TOWN: [[0, -8], [50, 70], [100, 170], [150, 262], [184, 335], [215, 335], [246, 335]],
  // Cañón Norte: una grieta con paredes empinadas, cerrada al fondo; la rampa de entrada es suave.
  CANYON: { path: [[-10, -400], [40, -470], [95, -530], [140, -575], [205, -600]], width: 30, depth: 9, rim: 5, ramp: 90 },
  BANDIT_CAMPS: [
    { id: 'canon_norte', name: 'Cañón Norte', x: 140, z: -575, flat: false, members: ['leader', 'bandit', 'bandit', 'bandit', 'bandit'] },
    { id: 'rocas_oeste', name: 'Rocas del Oeste', x: -350, z: -120, flat: true, members: ['bandit', 'bandit', 'bandit'] },
    { id: 'ruinas_este', name: 'Ruinas del Este', x: 520, z: 20, flat: true, members: ['bandit', 'bandit', 'bandit', 'bandit'] },
  ],
  BANDIT: {
    DETECT: 52, HP: 70, LEADER_HP: 130, SPEED_RUN: 5.4, SPEED_WALK: 1.5,
    BULLET_SPEED: 82, DAMAGE: [8, 13], FIRE_COOLDOWN: [2.0, 3.0], MAX_SHOOTERS: 2,
    RESPAWN_SECONDS: 480, ACTIVE_RADIUS: 240, VISIBLE_RADIUS: 150,
  },
  AMBUSH: { FIRST_DELAY: 110, MIN_GAP: 200, MAX_GAP: 380, SAFE_RADIUS: 95, RESCUE_CHANCE: 0.35 },
};

// --- Fase 5B: campamentos reubicables (la campaña mueve a la banda de sitio entre capítulos) ---
CONFIG.CAMP_SITES = {
  cedar: { x: 0, z: 0, style: 'tents', name: 'Cedar Hollow' },
  cedar_ruins: { x: 0, z: 0, style: 'ruins', name: 'Cedar Hollow (en ruinas)' },
  swamp: { x: -560, z: -560, style: 'swamp', name: 'Sauces Negros' },
  mesa: { x: 640, z: -520, style: 'mesa', name: 'Mesa Quebrada' },
  ranch: { x: 500, z: 560, style: 'ranch', name: 'Rancho La Rueda' },
};
// Biomas nuevos: zonas circulares con suelo, vegetación y niebla propios (se mezclan suavemente con la pradera).
// veg = multiplicador de densidad por tipo de vegetación; fogMul = multiplicador de la niebla dentro del bioma.
CONFIG.BIOMES = [
  { id: 'swamp', x: -560, z: -560, r: 220, ground: [0x3c4a2c, 0x4b5636], veg: { pine: 0.5, oak: 2.2, rock: 0.3, sage: 0.15, grass: 0.9 }, fog: 0x667a5c, fogMul: 2.0, flatten: 0.8 },
  { id: 'desert', x: 620, z: -560, r: 280, ground: [0xc79a62, 0xb5824c], veg: { pine: 0, oak: 0, rock: 1.9, sage: 1.3, grass: 0.12 }, fog: 0xe8c99c, fogMul: 0.75, flatten: 0 },
  { id: 'snow', x: -700, z: 700, r: 260, ground: [0xe9eff3, 0xd2dce3], veg: { pine: 1.5, oak: 0, rock: 1.3, sage: 0, grass: 0 }, fog: 0xdbe6ee, fogMul: 1.5, flatten: 0 },
];
// Montañas (aditivas sobre el relieve): la cima del Pico Halcón Blanco se puede escalar a pie.
CONFIG.MOUNTAINS = [{ id: 'halcon', x: -700, z: 700, r: 120, h: 62 }];

// Zonas sin vegetación y con suelo de tierra alrededor del pueblo y los campamentos.
CONFIG.CLEAR_ZONES = [
  ...Object.entries(CONFIG.CAMP_SITES).filter(([id]) => !id.startsWith('cedar')).map(([, c]) => ({ x: c.x, z: c.z, r: 24, dirt0: 8, dirt1: 16 })),
  { x: CONFIG.TOWN.x, z: CONFIG.TOWN.z, r: 50, dirt0: 34, dirt1: 56 },
  ...CONFIG.BANDIT_CAMPS.map((c) => ({ x: c.x, z: c.z, r: 26, dirt0: 8, dirt1: 17 })),
];

export { CONFIG };
